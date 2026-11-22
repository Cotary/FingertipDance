package leaderboard

import (
	"context"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/tupss/f-game/server/internal/core"
)

// 排行榜 Redis key。
const (
	KeyGlobal = "rank:global"
	KeyWeekly = "rank:weekly"
)

// scoreUnit 分数换算单位：把「最高关卡 + 总用时」压成一个整数，避免浮点误差。
// 分数越大排名越靠前。
const scoreUnit = 1000000

// ComputeScore 计算排行榜分数。
// 主指标是最高关卡数，同关卡比总用时（用时少者靠前）。
func ComputeScore(maxLevel int, totalTimeMs int64) int64 {
	seconds := totalTimeMs / 1000
	if seconds > 999999 {
		seconds = 999999
	}
	return int64(maxLevel)*scoreUnit - seconds
}

// UpdateScore 更新某个用户的排行榜分数（只增不减）。
func UpdateScore(ctx context.Context, rdb *core.Redis, uid int64, maxLevel int, totalTimeMs int64) error {
	score := ComputeScore(maxLevel, totalTimeMs)
	member := strconv.FormatInt(uid, 10)
	// ZAddArgs GT：只有更高分才更新
	return rdb.ZAddArgs(ctx, KeyGlobal, redis.ZAddArgs{
		GT:      true,
		Members: []redis.Z{{Score: float64(score), Member: member}},
	}).Err()
}

// entry 榜单条目。
type entry struct {
	Rank        int    `json:"rank"`
	UID         int64  `json:"uid"`
	Nickname    string `json:"nickname"`
	Avatar      string `json:"avatar"`
	MaxLevel    int    `json:"maxLevel"`
	TotalTimeMs int64  `json:"totalTimeMs"`
}

// 排行榜分页的默认值与上限。
//
// ## 为什么要上限
//
// `limit` 直接进 Redis 的 `ZREVRANGE`。不设上限的话，一个
// `?limit=1000000` 就能把整个 Redis 的有序集合拉出来、再逐条查用户表 ——
// 一次请求打满内存和数据库连接池。100 条一页对榜单 UI 已经绰绰有余。
const (
	DefaultPageSize = 50
	MaxPageSize     = 100
)

// clampRankWindow 把请求里的 offset / limit 收进合法范围。
//
// 负 offset、0 或负数 limit、超大 limit 都在这里归一 —— 让处理函数里
// 只剩一条"按窗口取"的路径，不用在每个调用点重复防御。
func clampRankWindow(offset, limit int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = DefaultPageSize
	}
	if limit > MaxPageSize {
		limit = MaxPageSize
	}
	return offset, limit
}

// GetHandler 返回总榜（支持 offset / limit 翻页）。
//
// ## 为什么必须能翻页
//
// 以前写死 `ZREVRANGE 0 99`：1000 关的游戏，第 100 名之外的人
// **永远看不到自己**。榜单页会给他画一条「我的名次 第 4213 名」，
// 但上面那 100 个人和他毫无关系 —— 那是"别人的榜单"，不是"我的"。
func GetHandler(db *core.DB, rdb *core.Redis) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		uid := core.UIDFromContext(c)

		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", strconv.Itoa(DefaultPageSize)))
		offset, limit = clampRankWindow(offset, limit)

		zs, err := rdb.ZRevRangeWithScores(ctx, KeyGlobal, int64(offset), int64(offset+limit-1)).Result()
		if err != nil {
			core.Fail(c, core.CodeInternal, "读取榜单失败: "+err.Error())
			return
		}

		list := make([]entry, 0, len(zs))
		uids := make([]int64, 0, len(zs))
		for _, z := range zs {
			member, ok := z.Member.(string)
			if !ok {
				continue
			}
			parsed, err := strconv.ParseInt(member, 10, 64)
			if err != nil {
				continue
			}
			uids = append(uids, parsed)
		}

		infoMap := loadUserInfo(db, uids)
		for i, z := range zs {
			member, _ := z.Member.(string)
			parsed, _ := strconv.ParseInt(member, 10, 64)
			// 名次是**全局**名次：第二页第一条是第 offset+1 名，
			// 不是第 1 名（那会让每一页都从 1 开始编号）
			e := entry{Rank: offset + i + 1, UID: parsed}
			if info, ok := infoMap[parsed]; ok {
				e.Nickname = info.nickname
				e.Avatar = info.avatar
				e.MaxLevel = info.maxLevel
				e.TotalTimeMs = info.totalTimeMs
			}
			list = append(list, e)
		}

		// 我的排名
		myRank := int64(0)
		if r, err := rdb.ZRevRank(ctx, KeyGlobal, strconv.FormatInt(uid, 10)).Result(); err == nil {
			myRank = r + 1
		}

		total, _ := rdb.ZCard(ctx, KeyGlobal).Result()

		core.OK(c, gin.H{
			"list":   list,
			"myRank": myRank,
			"total":  total,
			"offset": offset,
			"limit":  limit,
		})
	}
}

// userInfo 是榜单需要的用户信息子集。
type userInfo struct {
	nickname    string
	avatar      string
	maxLevel    int
	totalTimeMs int64
}

// loadUserInfo 批量查询用户信息。
func loadUserInfo(db *core.DB, uids []int64) map[int64]userInfo {
	out := make(map[int64]userInfo, len(uids))
	if len(uids) == 0 {
		return out
	}
	// 构造 IN 查询
	placeholders := ""
	args := make([]interface{}, 0, len(uids))
	for i, id := range uids {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, id)
	}
	q := "SELECT id, nickname, avatar, max_level, total_time_ms FROM users WHERE id IN (" + placeholders + ")"
	rows, err := db.Query(q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var u userInfo
		if err := rows.Scan(&id, &u.nickname, &u.avatar, &u.maxLevel, &u.totalTimeMs); err != nil {
			continue
		}
		out[id] = u
	}
	return out
}

// RefreshAll 重建整个榜单（定时任务用）。
func RefreshAll(ctx context.Context, db *core.DB, rdb *core.Redis) error {
	rows, err := db.Query("SELECT id, max_level, total_time_ms FROM users WHERE max_level > 0")
	if err != nil {
		return fmt.Errorf("查询用户: %w", err)
	}
	defer rows.Close()

	members := make([]redis.Z, 0, 256)
	for rows.Next() {
		var id int64
		var maxLevel int
		var totalTime int64
		if err := rows.Scan(&id, &maxLevel, &totalTime); err != nil {
			continue
		}
		members = append(members, redis.Z{
			Score:  float64(ComputeScore(maxLevel, totalTime)),
			Member: strconv.FormatInt(id, 10),
		})
	}
	if len(members) == 0 {
		return nil
	}
	// 分批写入
	for i := 0; i < len(members); i += 500 {
		end := i + 500
		if end > len(members) {
			end = len(members)
		}
		if err := rdb.ZAdd(ctx, KeyGlobal, members[i:end]...).Err(); err != nil {
			return fmt.Errorf("写入榜单: %w", err)
		}
	}
	return nil
}

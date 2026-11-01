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

// GetHandler 返回总榜。
func GetHandler(db *core.DB, rdb *core.Redis) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		uid := core.UIDFromContext(c)

		// 取 Top 100
		zs, err := rdb.ZRevRangeWithScores(ctx, KeyGlobal, 0, 99).Result()
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
			e := entry{Rank: i + 1, UID: parsed}
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

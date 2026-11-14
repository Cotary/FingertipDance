package line

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/modules/leaderboard"
)

// coverLevelReq 是 cover 模式的上报请求。
type coverLevelReq struct {
	LevelIdx int   `json:"levelIdx"`
	Steps    int   `json:"steps"`
	TimeMs   int   `json:"timeMs"`
	Undos    int   `json:"undos"`
	Path     []int `json:"path"`
	Skipped  bool  `json:"skipped"`
}

// CoverLevelsHandler 分批下发 cover 关卡表（**不含解**）。
//
// 与 `/api/levels`（经典模式）分开：
// 两套关卡的数据模型完全不同（cover 是「铺满全盘」，经典是「起终点连线」），
// 混在一个接口里会让客户端每关都要判断走哪套逻辑。
func CoverLevelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		from, err := strconv.Atoi(c.DefaultQuery("from", "1"))
		if err != nil || from < 1 {
			core.Fail(c, core.CodeBadRequest, "from 参数非法")
			return
		}
		count, err := strconv.Atoi(c.DefaultQuery("count", "50"))
		if err != nil || count < 1 || count > 100 {
			core.Fail(c, core.CodeBadRequest, "count 参数需在 1..100 之间")
			return
		}
		levels := CoverLevels.Range(from, count)
		// **剥离解**：解绝不下发 —— 客户端持有解就能回放通关，
		// 提示功能也就形同虚设。
		for i := range levels {
			levels[i].Solution = ""
		}
		core.OK(c, gin.H{
			"version": CoverLevels.Version(),
			"from":    from,
			"levels":  levels,
		})
	}
}

// CoverProgressHandler 上报 cover 模式通关成绩。
//
// 校验链（与经典模式一致的严格度）：
//  1. 关卡存在
//  2. 路径长度 == 可走格数（cover 模式必须**铺满**）
//  3. 按完整规则回放（冰块滑行 / 单向门 / 钥匙门 / 传送门 / 星星顺序）
//  4. 起终点约束
//  5. 星级由 **undo 次数**决定（cover 模式没有「步数」概念 ——
//     步数恒为 required−1，铺满就一定是这个数）
func CoverProgressHandler(db *core.DB, rdb *core.Redis) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req coverLevelReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		uid := core.UIDFromContext(c)

		lv := CoverLevels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}

		grid, err := CoverLevels.Grid(req.LevelIdx)
		if err != nil {
			core.Fail(c, core.CodeInternal, "解码关卡失败: "+err.Error())
			return
		}
		cells := grid.Walkable()

		// ── 通用下界校验（**在任何分支之前**）──
		//
		// 这些字段会直接影响星级与纪录判定，负数/零会让「纪录」被永久锁死：
		// - `undos` 负数 → `StarOfCover` 返回 3 星；且 `isNewBest` 判定
		//   `req.Undos < oldUndos` 对任意正常值都成立 → 之后每次正常提交
		//   都拿不到「刷新纪录」。
		// - `steps` 负数 → `total_steps` 被减，排行榜分数失真。
		// - `timeMs` 负数 → 同上，且总用时变负。
		if req.Undos < 0 {
			core.Fail(c, core.CodeBadRequest, "重来次数不能为负")
			return
		}
		if req.Steps < 0 {
			core.Fail(c, core.CodeBadRequest, "步数不能为负")
			return
		}
		if req.TimeMs < 0 {
			core.Fail(c, core.CodeBadRequest, "用时不能为负")
			return
		}

		// cover 模式支持跳过：跳过就是没铺满，所以**不校验路径**，
		// 但也不发皮肤（跳过不算真通关）。
		//
		// 早期版本直接拒绝跳过（`cover 模式不支持跳过`），
		// 结果客户端的「跳过」按钮在 cover 模式下**完全不可用** ——
		// 玩家卡在一关上就只能一直卡着，没有退路。
		if !req.Skipped {
			// 路径必须铺满全部可走格
			if len(req.Path) != len(cells) {
				core.Fail(c, core.CodePathIllegal, fmt.Sprintf("路径长度 %d != 可走格数 %d", len(req.Path), len(cells)))
				return
			}
			if err := ValidateCoverPath(cells, grid, req.Path, lv.StartAt, lv.EndAt); err != nil {
				core.Fail(c, core.CodePathIllegal, "路径非法: "+err.Error())
				return
			}
			// 步数必须是 required−1（铺满一条路就是这么多步）。
			// 不校验的话，客户端可以随便报个步数骗「总步数」统计。
			if req.Steps != len(cells)-1 {
				core.Fail(c, core.CodeStepsTooLow, fmt.Sprintf("步数 %d != 理论步数 %d", req.Steps, len(cells)-1))
				return
			}
			if req.TimeMs < len(req.Path)*20 {
				core.Fail(c, core.CodeTimeInvalid, "用时异常")
				return
			}
		}

		// 写入进度
		res, err := applyCoverProgress(db, uid, lv, req, DefaultSkins())
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入进度失败: "+err.Error())
			return
		}

		// 更新 Redis 榜单（失败不影响主流程）
		if rdb != nil {
			if err := leaderboard.UpdateScore(c.Request.Context(), rdb, uid, res.MaxLevel, res.TotalTimeMs); err != nil {
				c.Error(err)
			}
		}

		core.OK(c, res)
	}
}

// coverProgressResult 是 cover 模式的进度写入结果。
type coverProgressResult struct {
	Passed       bool              `json:"passed"`
	IsNewBest    bool              `json:"isNewBest"`
	MaxLevel     int               `json:"maxLevel"`
	TotalTimeMs  int64             `json:"totalTimeMs"`
	TotalSteps   int               `json:"totalSteps"`
	UnlockedSkin *unlockedSkinInfo `json:"unlockedSkin"`
	// UnlockedSkins 是玩家**全部**已解锁皮肤 id 列表。
	//
	// 客户端 `progress.sync({unlockedSkins: res.unlockedSkins})` 会用它整体覆盖本地数组 ——
	// 少返回这个字段就会把本地数组覆盖成 `undefined`，
	// 下一帧 `progress.current.unlockedSkins.length` 直接抛异常、渲染循环死掉，
	// 表现就是「通关后卡在结算动画、点不了下一关」。
	UnlockedSkins []string `json:"unlockedSkins"`
	Stars         int      `json:"stars"`
}

// applyCoverProgress 在事务内更新 cover 模式的关卡记录与用户进度。
func applyCoverProgress(db *core.DB, uid int64, lv *CoverLevelEntry, req coverLevelReq, skins []SkinConfig) (*coverProgressResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback()

	// ── 用户行锁：把「读-改-写」串行化 ──
	//
	// ## 为什么必须锁
	//
	// 这个函数里有三处「读出来 → 算一下 → 写回去」：
	//
	//  1. `level_records` 的 `firstPass` 判定 → `INSERT`
	//  2. `users.total_steps = total_steps + $1`（累加）
	//  3. `users.unlocked_skins` 的整体读-改-写（`grantSkinForLevel`）
	//
	// 并发提交同一关时（玩家双击「下一关」+ 网络重试）会出事：
	//  - ①两个事务都判定 `firstPass = true` → 都 INSERT → 后一个撞主键 → **500**；
	//  - ②`total_steps` 累加丢一次；
	//  - ③两个事务都读到 `["wood","mint"]` → 都追加同一个皮肤 → 互相覆盖。
	//
	// `SELECT ... FOR UPDATE` 拿行锁后，同一 uid 的并发请求排队执行，
	// 上面三种情况全部消失。锁的是 `users` 那一行 —— 同一玩家串行，
	// 不同玩家互不影响。
	if err := lockUserRow(tx, uid); err != nil {
		return nil, err
	}

	now := nowFunc()

	var oldSteps, oldTime, oldUndos int
	err = tx.QueryRow(
		"SELECT steps, time_ms, undos FROM level_records WHERE uid=$1 AND mode=$2 AND level_idx=$3",
		uid, ModeCover, lv.Idx,
	).Scan(&oldSteps, &oldTime, &oldUndos)
	firstPass := isNoRows(err)
	if err != nil && !firstPass {
		return nil, fmt.Errorf("查询关卡记录: %w", err)
	}

	// 新纪录：**undo 次数优先**（cover 模式的星级只看 undo），其次用时
	isNewBest := firstPass ||
		req.Undos < oldUndos ||
		(req.Undos == oldUndos && req.TimeMs < oldTime)

	pathJSON := marshalIntSlice(req.Path)
	stars := StarOfCover(req.Undos)

	if firstPass {
		_, err = tx.Exec(
			"INSERT INTO level_records (uid, mode, level_idx, steps, time_ms, undos, path, skipped, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
			uid, ModeCover, lv.Idx, req.Steps, req.TimeMs, req.Undos, pathJSON, boolToSmallint(req.Skipped), now,
		)
	} else if isNewBest {
		_, err = tx.Exec(
			"UPDATE level_records SET steps=$1, time_ms=$2, undos=$3, path=$4, skipped=$5 WHERE uid=$6 AND mode=$7 AND level_idx=$8",
			req.Steps, req.TimeMs, req.Undos, pathJSON, boolToSmallint(req.Skipped), uid, ModeCover, lv.Idx,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("写入关卡记录: %w", err)
	}

	if firstPass {
		_, err = tx.Exec(
			"UPDATE users SET total_steps = total_steps + $1, total_time_ms = total_time_ms + $2 WHERE id=$3",
			req.Steps, req.TimeMs, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("累计总步数: %w", err)
		}
	}

	if lv.Idx > 0 {
		_, err = tx.Exec(
			"UPDATE users SET max_level = GREATEST(max_level, $1) WHERE id=$2",
			lv.Idx, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("推进最高关卡: %w", err)
		}
	}

	// 皮肤解锁：与经典模式同一套规则 —— 该关关联了皮肤且**真通关**（未跳过）才发。
	//
	// cover 关卡表带 `unlockSkin` 字段（由生成工具写入），
	// 否则 premium 三款（黄金/星尘/星河）在 cover 模式下**永远拿不到** ——
	// 经典模式的关卡表有 unlockSkin，cover 表没有。
	unlocked, err := grantSkinForLevel(tx, uid, lv.UnlockSkin, skins)
	if err != nil {
		return nil, err
	}

	// 成绩流水
	//
	// 必须带上 `mode` 与 `undos` ——
	//   - `mode`：两种模式共用关号空间（1..1000），不分则挑战的「历史最佳」会串
	//   - `undos`：cover 模式唯一的区分维度（步数恒为 required−1）
	_, err = tx.Exec(
		"INSERT INTO scores (uid, mode, level_idx, steps, time_ms, undos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
		uid, ModeCover, lv.Idx, req.Steps, req.TimeMs, req.Undos, now,
	)
	if err != nil {
		return nil, fmt.Errorf("写入成绩流水: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}

	var maxLevel, totalSteps int
	var totalTimeMs int64
	var unlockedJSON string
	if err := db.QueryRow(
		"SELECT max_level, total_time_ms, total_steps, unlocked_skins FROM users WHERE id=$1", uid,
	).Scan(&maxLevel, &totalTimeMs, &totalSteps, &unlockedJSON); err != nil {
		return nil, fmt.Errorf("读取进度: %w", err)
	}

var skinList []string
	_ = json.Unmarshal([]byte(unlockedJSON), &skinList)
	if skinList == nil {
		skinList = []string{}
	}

	return &coverProgressResult{
		Passed:        true,
		IsNewBest:     isNewBest,
		MaxLevel:      maxLevel,
		TotalTimeMs:   totalTimeMs,
		TotalSteps:    totalSteps,
		Stars:         stars,
		UnlockedSkin:  unlocked,
		UnlockedSkins: skinList,
	}, nil
}

// StarOfCover 按 **undo 次数**算 cover 模式的星级。
//
// ## 为什么不是「步数」
//
// cover 模式的步数恒为 `required − 1`（铺满就一定是这个数），
// 用步数算星级会让所有关卡都是 3 星。真正的区分度在**悔棋次数**：
// 一次都不悔棋说明玩家一次就想通了全程。
//
// 阈值必须与客户端 `ui/hud.ts` 的 `starOfCover` 保持一致。
func StarOfCover(undos int) int {
	switch {
	case undos <= 0:
		return 3
	case undos <= 2:
		return 2
	default:
		return 1
	}
}

// marshalIntSlice 把整数切片序列化为 JSON。
func marshalIntSlice(v []int) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// boolToSmallint 把 bool 转成数据库的 SMALLINT。
func boolToSmallint(b bool) int {
	if b {
		return 1
	}
	return 0
}

// CoverChallengeHandler 提交 cover 模式的挑战成绩。不推进主线进度。
//
// **必须独立于经典模式的 `ChallengeHandler`** ——
// 经典模式用 `ValidatePath`（起终点连线 + 单向块），
// cover 模式必须用 `ValidateCoverPath`（铺满全盘 + 冰块滑行 / 钥匙门 / 传送门 / 星星顺序）。
// 用错校验器的话，cover 的路径**必然**被拒（长度都对不上）。
func CoverChallengeHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req coverLevelReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		uid := core.UIDFromContext(c)

		lv := CoverLevels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}

		grid, err := CoverLevels.Grid(req.LevelIdx)
		if err != nil {
			core.Fail(c, core.CodeInternal, "解码关卡失败: "+err.Error())
			return
		}
		cells := grid.Walkable()
		if len(req.Path) != len(cells) {
			core.Fail(c, core.CodePathIllegal, fmt.Sprintf("路径长度 %d != 可走格数 %d", len(req.Path), len(cells)))
			return
		}
		if err := ValidateCoverPath(cells, grid, req.Path, lv.StartAt, lv.EndAt); err != nil {
			core.Fail(c, core.CodePathIllegal, "路径非法: "+err.Error())
			return
		}

		// ── 数值下界校验 ──
		//
		// 经典接口 `ChallengeHandler` 有这些校验，cover 接口以前**一个都没有** ——
		// 后果：
		// - `undos = -1` → `StarOfCover` 给 3 星；`isNewBest` 判定
		//   `req.Undos < histUndos` 恒真 → 之后每次正常提交都拿不到「刷新纪录」。
		// - `timeMs = 0` → 配合 `undos` 相同就能伪造「刷新纪录 + 极速」。
		// - `steps` 与路径长度不符 → `total_steps` 统计失真。
		if req.Undos < 0 {
			core.Fail(c, core.CodeBadRequest, "重来次数不能为负")
			return
		}
		if req.Steps != len(cells)-1 {
			core.Fail(c, core.CodeStepsTooLow, fmt.Sprintf("步数 %d != 理论步数 %d", req.Steps, len(cells)-1))
			return
		}
		if req.TimeMs < 0 {
			core.Fail(c, core.CodeTimeInvalid, "用时不能为负")
			return
		}
		if req.TimeMs < len(req.Path)*20 {
			core.Fail(c, core.CodeTimeInvalid, "用时异常")
			return
		}

		// ── 查历史最佳（必须在写入**之前**查）──
		//
		// ## 为什么先查再写
		//
		// 如果先写再查，本次提交的这一行**也在**「历史最佳」里 ——
		// 于是 `req.Undos < bestUndos` 永远为 false，
		// `isNewBest` 恒为 false，玩家永远看不到「刷新纪录」。
		//
		// （2026-11-06 联调发现：连续提交 undos=5 / 2 / 4，
		//  三次的 isNewBest 全是 false，而 undos=2 那次本该刷新纪录。）
		//
		// ## 为什么按 uid 过滤
		//
		// 「刷新最佳纪录」说的是**自己**的纪录。
		// 不按 uid 过滤的话查出来的是**全服**最佳 ——
		// 第一个玩家清了这关之后，后面所有人都是 false，
		// 「刷新纪录」这个功能对所有人永久失效。
		//
		// 必须同时按 `mode` 过滤 —— 经典模式与 cover 模式共用关号空间（1..1000），
		// 不过滤的话经典的 steps 记录会混进来。
		var histUndos, histTime int
		hasHistory := true
		err = db.QueryRow(
			"SELECT undos, time_ms FROM scores WHERE uid=$1 AND level_idx=$2 AND mode=$3 ORDER BY undos ASC, time_ms ASC LIMIT 1",
			uid, req.LevelIdx, ModeCover,
		).Scan(&histUndos, &histTime)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				// 该关还没有任何成绩 —— 本次就是首个纪录
				hasHistory = false
			} else {
				core.Fail(c, core.CodeInternal, "查询最佳成绩失败: "+err.Error())
				return
			}
		}

		// 只写流水，不动进度
		_, err = db.Exec(
			"INSERT INTO scores (uid, mode, level_idx, steps, time_ms, undos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
			uid, ModeCover, lv.Idx, req.Steps, req.TimeMs, req.Undos, nowFunc(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入成绩失败: "+err.Error())
			return
		}

		// 本次是否刷新纪录（与**写入前**的历史最佳比）
		isNewBest := !hasHistory ||
			req.Undos < histUndos ||
			(req.Undos == histUndos && req.TimeMs < histTime)

		// 返回的「最佳」= 历史最佳与本次的较小者
		bestUndos, bestTime := histUndos, histTime
		if isNewBest {
			bestUndos, bestTime = req.Undos, req.TimeMs
		}

		core.OK(c, gin.H{
			"passed": true,
			"best": gin.H{
				"undos": bestUndos,
				"timeMs": bestTime,
			},
			"isNewBest": isNewBest,
		})
	}
}

// coverSkipDay 保留给将来「每日跳过次数上限」用。
var coverSkipDay = func() string { return time.Now().Format("2006-01-02") }

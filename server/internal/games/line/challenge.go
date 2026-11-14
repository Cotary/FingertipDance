package line

import (
	"database/sql"
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// ChallengeHandler 提交挑战成绩。不推进主线进度。
//
// Deprecated: **经典模式已下线** —— 客户端现在只用 cover 模式
// （`/api/cover/challenge`）。这个接口保留是为了兼容老客户端，
// 新的客户端代码不要调用它。
func ChallengeHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req progressReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		uid := core.UIDFromContext(c)

		lv := Levels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}

		cells, err := decodeGridBase64(lv.Grid)
		if err != nil {
			core.Fail(c, core.CodeInternal, "解码关卡失败: "+err.Error())
			return
		}
		if len(req.Path) != req.Steps+1 {
			core.Fail(c, core.CodePathIllegal, "路径长度与步数不匹配")
			return
		}
		if err := ValidatePath(cells, lv.W, req.Path); err != nil {
			core.Fail(c, core.CodePathIllegal, "路径非法: "+err.Error())
			return
		}
		if req.Steps < lv.Shortest {
			core.Fail(c, core.CodeStepsTooLow, "步数低于理论最短")
			return
		}
		if req.TimeMs < req.Steps*50 {
			core.Fail(c, core.CodeTimeInvalid, "用时异常")
			return
		}

		// ── 查历史最佳（必须在写入**之前**查）──
		//
		// ## 为什么先查再写
		//
		// 如果先写再查，本次提交的这一行**也在**「历史最佳」里 ——
		// 于是 `req.Steps < bestSteps` 永远为 false，
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
		var histSteps, histTime int
		hasHistory := true
		err = db.QueryRow(
			"SELECT steps, time_ms FROM scores WHERE uid=$1 AND level_idx=$2 AND mode=$3 ORDER BY steps ASC, time_ms ASC LIMIT 1",
			uid, req.LevelIdx, ModeClassic,
		).Scan(&histSteps, &histTime)
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
		//
		// 必须带 `mode`（=经典）与 `undos`（=0）——
		// 两种模式共用关号空间（1..1000），查历史最佳时按 `mode` 过滤。
		_, err = db.Exec(
			"INSERT INTO scores (uid, mode, level_idx, steps, time_ms, undos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
			uid, ModeClassic, lv.Idx, req.Steps, req.TimeMs, 0, nowFunc(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入成绩失败: "+err.Error())
			return
		}

		// 本次是否刷新纪录（与**写入前**的历史最佳比）
		isNewBest := !hasHistory ||
			req.Steps < histSteps ||
			(req.Steps == histSteps && req.TimeMs < histTime)

		// 返回的「最佳」= 历史最佳与本次的较小者
		bestSteps, bestTime := histSteps, histTime
		if isNewBest {
			bestSteps, bestTime = req.Steps, req.TimeMs
		}

		core.OK(c, gin.H{
			"passed": true,
			"best": gin.H{
				"steps":  bestSteps,
				"timeMs": bestTime,
			},
			"isNewBest": isNewBest,
		})
	}
}

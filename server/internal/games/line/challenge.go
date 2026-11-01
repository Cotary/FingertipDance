package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// ChallengeHandler 提交挑战成绩。不推进主线进度。
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

		// 只写流水，不动进度
		_, err = db.Exec(
			"INSERT INTO scores (uid, level_idx, steps, time_ms, created_at) VALUES (?,?,?,?,?)",
			uid, lv.Idx, req.Steps, req.TimeMs, nowFunc(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入成绩失败: "+err.Error())
			return
		}

		// 查询该关的历史最佳
		var bestSteps, bestTime int
		err = db.QueryRow(
			"SELECT steps, time_ms FROM scores WHERE level_idx=? ORDER BY steps ASC, time_ms ASC LIMIT 1",
			req.LevelIdx,
		).Scan(&bestSteps, &bestTime)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询最佳成绩失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"passed": true,
			"best": gin.H{
				"steps":  bestSteps,
				"timeMs": bestTime,
			},
			"isNewBest": req.Steps < bestSteps || (req.Steps == bestSteps && req.TimeMs < bestTime),
		})
	}
}

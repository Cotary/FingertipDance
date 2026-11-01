package line

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// SkipHandler 处理看广告跳过关卡。
func SkipHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			LevelIdx int `json:"levelIdx"`
		}
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

		day := time.Now().Format("2006-01-02")
		// 幂等插入：已存在则跳过
		res, err := db.Exec(
			"INSERT IGNORE INTO skips (uid, level_idx, day) VALUES (?,?,?)",
			uid, lv.Idx, day,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入跳过记录失败: "+err.Error())
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			core.Fail(c, core.CodeSkipLimit, "本关今日已跳过")
			return
		}

		// 写关卡记录（标记为跳过）
		pathJSON := "[]"
		_, err = db.Exec(
			"INSERT INTO level_records (uid, level_idx, steps, time_ms, path, skipped, created_at) VALUES (?,?,?,?,?,1,?) "+
				"ON DUPLICATE KEY UPDATE skipped=1",
			uid, lv.Idx, lv.Shortest, 0, pathJSON, time.Now(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入关卡记录失败: "+err.Error())
			return
		}

		// 推进最高关卡（否则玩家卡死），但不发皮肤
		_, err = db.Exec("UPDATE users SET max_level = GREATEST(max_level, ?) WHERE id=?", lv.Idx, uid)
		if err != nil {
			core.Fail(c, core.CodeInternal, "推进进度失败: "+err.Error())
			return
		}

		var maxLevel int
		_ = db.QueryRow("SELECT max_level FROM users WHERE id=?", uid).Scan(&maxLevel)

		core.OK(c, gin.H{
			"ok":       true,
			"maxLevel": maxLevel,
			"skipped":  true,
		})
	}
}

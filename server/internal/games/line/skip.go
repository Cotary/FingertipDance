package line

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// SkipHandler 处理看广告跳过关卡（经典模式）。
//
// cover 模式有自己的入口 `CoverSkipHandler` ——
// cover 的关卡表是另一套，记录必须按 `mode` 隔离。
// SkipHandler 跳过关卡（经典模式）。
//
// Deprecated: **经典模式已下线** —— 客户端现在只用 cover 模式
// （`/api/cover/skip`）。这个接口保留是为了兼容老客户端，
// 新的客户端代码不要调用它。
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
			"INSERT INTO skips (uid, mode, level_idx, day) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
			uid, ModeClassic, lv.Idx, day,
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
			"INSERT INTO level_records (uid, mode, level_idx, steps, time_ms, path, skipped, created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7) "+
				"ON CONFLICT (uid, mode, level_idx) DO UPDATE SET skipped=1",
			uid, ModeClassic, lv.Idx, lv.Shortest, 0, pathJSON, time.Now(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入关卡记录失败: "+err.Error())
			return
		}

		// 推进最高关卡（否则玩家卡死），但不发皮肤
		_, err = db.Exec("UPDATE users SET max_level = GREATEST(max_level, $1) WHERE id=$2", lv.Idx, uid)
		if err != nil {
			core.Fail(c, core.CodeInternal, "推进进度失败: "+err.Error())
			return
		}

		var maxLevel int
		_ = db.QueryRow("SELECT max_level FROM users WHERE id=$1", uid).Scan(&maxLevel)

		core.OK(c, gin.H{
			"ok":       true,
			"maxLevel": maxLevel,
			"skipped":  true,
		})
	}
}

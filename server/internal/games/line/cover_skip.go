package line

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverSkipHandler 处理 cover 模式的看广告跳过关卡。
//
// ## 为什么必须有独立的入口
//
// cover 模式的关卡在 `CoverLevels` 表里，步数是 `required − 1`（不是经典的 `shortest`），
// 记录也要按 `mode=1` 隔离。走经典 `SkipHandler` 的话：
//   - 用经典的 `shortest` 写步数 → 与 cover 的实际步数不符
//   - 写进 `mode=0` → 与经典模式的记录撞
//
// ## 跳过的语义
//
// 跳过 = 认输换进度，所以：
//   - **推进最高关卡**（否则玩家会卡死在这一关）
//   - **不发皮肤**（跳过不算真通关）
//   - **不给星**（跳过的关卡星级为 0，地图上不点亮）
func CoverSkipHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			LevelIdx int `json:"levelIdx"`
		}
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

		day := time.Now().Format("2006-01-02")

		// ── 事务 + 用户行锁 ──
		//
		// 跳过会做三件事：写 `skips`、写 `level_records`、推进 `max_level`。
		// 它们必须原子 —— 否则并发跳过时可能出现
		// 「`skips` 写了但 `max_level` 没推进」（玩家卡在这一关）。
		//
		// 锁 `users` 行把同一玩家的并发请求串行化
		// （详见 `lockUserRow` 的说明）。
		tx, err := db.Begin()
		if err != nil {
			core.Fail(c, core.CodeInternal, "开启事务失败: "+err.Error())
			return
		}
		defer tx.Rollback()

		if err := lockUserRow(tx, uid); err != nil {
			core.Fail(c, core.CodeInternal, "锁定用户失败: "+err.Error())
			return
		}

		// 幂等插入：已存在则跳过
		res, err := tx.Exec(
			"INSERT INTO skips (uid, mode, level_idx, day) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
			uid, ModeCover, lv.Idx, day,
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
		_, err = tx.Exec(
			"INSERT INTO level_records (uid, mode, level_idx, steps, time_ms, undos, path, skipped, created_at) "+
				"VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8) "+
				"ON CONFLICT (uid, mode, level_idx) DO UPDATE SET skipped=1",
			uid, ModeCover, lv.Idx, lv.Required-1, 0, 0, "[]", time.Now(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入关卡记录失败: "+err.Error())
			return
		}

		// 推进最高关卡（否则玩家卡死），但不发皮肤
		if _, err := tx.Exec(
			"UPDATE users SET max_level = GREATEST(max_level, $1) WHERE id=$2", lv.Idx, uid,
		); err != nil {
			core.Fail(c, core.CodeInternal, "推进进度失败: "+err.Error())
			return
		}

		var maxLevel int
		if err := tx.QueryRow("SELECT max_level FROM users WHERE id=$1", uid).Scan(&maxLevel); err != nil {
			core.Fail(c, core.CodeInternal, "读取进度失败: "+err.Error())
			return
		}

		if err := tx.Commit(); err != nil {
			core.Fail(c, core.CodeInternal, "提交事务失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"ok":       true,
			"maxLevel": maxLevel,
			"skipped":  true,
			"steps":    lv.Required - 1,
		})
	}
}

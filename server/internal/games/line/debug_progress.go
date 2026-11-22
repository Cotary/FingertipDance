package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// DebugRepairProgressHandler 把 `users.max_level` 重算回「真打过的最高关」
// （**仅调试模式**）。
//
// ## 为什么需要它
//
// 2026-11-21 之前的调试跳关会写 `users.max_level`（`GREATEST(max_level, N-1)`），
// 于是「点开第 405 关看一眼」的调试，会把玩家真实的第 153 关永久顶成 404。
// 客户端地图因此把 1..404 画成已通关、当前关变成 405 ——
// 而分享选关按星级判定，405 又「还没通过」，两条规则当场打架。
//
// 跳关本身已经不再写库了（见 `DebugJumpHandler`），但**已经被写坏的账号**
// 需要一个能退回真实值的口子。这个接口就是那个口子。
//
// ## 重算口径
//
// `max_level = MAX(level_idx)`，条件是 `uid` 匹配且 `skipped = 0`：
//
//   - 只认真打过的关（`skipped = 0`）—— 看广告跳过的关没有星，也不算「通过」，
//     和分享选关的判据（星级 > 0）保持同一口径；
//   - **不区分 mode**：`users.max_level` 只有一列，经典和 cover 共用，
//     取两者更高的那个才不会被另一种模式的进度「倒退」。
//
// 一条记录都没有 → 0（新玩家）。
//
// ## 会不会把正常账号改坏
//
// 正常账号的 `max_level` 本来就等于这个值（由 `applyCoverProgress` /
// `applyCoverProgressSkip` 用 `GREATEST` 推上去），重算是不动。
// 只有被调试跳关顶高的账号才会被**降回来** —— 这正是本接口唯一的作用。
//
// 调试开关关着时直接 403，和 `/api/debug/jump` 同一道门。
func DebugRepairProgressHandler(db *core.DB, debugEnabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !debugEnabled {
			core.Fail(c, core.CodeForbidden, "调试功能未开启")
			return
		}
		uid := core.UIDFromContext(c)

		var real int
		if err := db.QueryRow(
			"SELECT COALESCE(MAX(level_idx), 0) FROM level_records WHERE uid=$1 AND skipped=0",
			uid,
		).Scan(&real); err != nil {
			core.Fail(c, core.CodeInternal, "读取成绩表失败: "+err.Error())
			return
		}

		if _, err := db.Exec("UPDATE users SET max_level=$1 WHERE id=$2", real, uid); err != nil {
			core.Fail(c, core.CodeInternal, "修正最高关卡失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{"ok": true, "maxLevel": real})
	}
}

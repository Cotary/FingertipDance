package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// DebugJumpHandler 跳到指定关卡（**仅调试模式**）。
//
// ## 用途
//
// 测试时需要直接进入某一关 —— 1000 关手动打过来不现实，
// 想复现某个具体关卡的 bug 也几乎不可能。
//
// ## 安全边界（关键）
//
// 这个接口**只在服务端配置了 `debug.enabled: true` 时才可用**。
//
// 客户端**也**有自己的调试开关（构建期常量 `__DEBUG__`），
// 但那只管界面（要不要允许点锁着的关）。**客户端绕过不算数** ——
// 服务端必须自己判断，所以这里的开关是独立的、且默认关闭。
//
// 生产环境不配 `debug.enabled`（默认 `false`）→ 直接 403，数据一点不动。
//
// ## 跳关做了什么
//
// 把 `users.max_level` 推到 `levelIdx - 1`（目标关的前一关），
// 于是 `currentLevel = maxLevel + 1 = levelIdx` —— 目标关成为「当前关」。
//
// ## 为什么**不**补写 `level_records`
//
// 补记录看起来更「完整」（前 N 关都有已通关记录），但有副作用：
//
// `applyCoverProgress` 用 `level_records` 有无来判定 `firstPass`，
// 而 `firstPass` 决定了：
//   - `total_steps` / `total_time_ms` 是否累加
//   - 是否允许刷新纪录（`isNewBest`）
//
// 如果跳关时给 1..N-1 都塞一条 `skipped=1` 的记录（undos=0、time_ms=0），
// 玩家之后真去打第 300 关时：
//
//   `isNewBest = undos < oldUndos || (undos == oldUndos && timeMs < oldTime)`
//              = 0 < 0 || (0 == 0 && timeMs < 0) = **false**
//
// → 真实成绩被丢弃，玩家永远拿不到那颗星。
//
// 所以跳关**只动 `max_level`**，不动成绩表。
// 副作用是：那些关在地图上显示为「已通关但没有星星」——
// 对调试来说完全可以接受。
func DebugJumpHandler(db *core.DB, debugEnabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		// ── 开关检查放在最前面 ──
		//
		// 必须在读参数之前 —— 生产环境下这个接口要表现得**根本不存在**。
		if !debugEnabled {
			core.Fail(c, core.CodeForbidden, "调试功能未开启")
			return
		}

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

		// 目标关的前一关 = 新的「最高已通关关号」。
		// 少 1 是刻意的：目标关本身还没打过，不该算已通关。
		target := req.LevelIdx - 1
		if target > 0 {
			if _, err := db.Exec(
				"UPDATE users SET max_level = GREATEST(max_level, $1) WHERE id=$2",
				target, uid,
			); err != nil {
				core.Fail(c, core.CodeInternal, "推进最高关卡失败: "+err.Error())
				return
			}
		}

		var maxLevel int
		if err := db.QueryRow("SELECT max_level FROM users WHERE id=$1", uid).Scan(&maxLevel); err != nil {
			core.Fail(c, core.CodeInternal, "读取进度失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"ok":       true,
			"maxLevel": maxLevel,
			"jumpedTo": req.LevelIdx,
		})
	}
}

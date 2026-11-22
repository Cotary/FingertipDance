package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// DebugJumpHandler 调试跳关的**登记接口**（仅调试模式）。
//
// ## 2026-11-21 改：不再写 `users.max_level`
//
// 旧实现把 `max_level` 推到 `levelIdx - 1`，为的是让目标关成为「当前关」。
// 数据上就出了两个互相矛盾的真相：
//
//	`users.max_level = 404`  → 地图：1..404 全是「已通关」，405 是「你在这里」
//	`level_records` 只有 2/153 → 分享：405「你还没通过」
//
// 两边各自都没算错，放在一起就是玩家看到的那句「明明显示 405，却不让我分享」。
// 更糟的是 `GREATEST(max_level, ...)` **只增不减** ——
// 一次「随便点进 405 看看」的调试，会把玩家真实的第 153 关永久顶到 404，
// 之后的每一次看地图、每一次选关分享，读到的都是这个被污染的数。
//
// 所以现在：**跳关只是「登记一下我要去第 N 关」，一个字节都不写**。
// 客户端进关本来就不需要服务端配合（`enterLevel` 直接拉关卡数据），
// 真正的进度只由**通关上报**（`applyCoverProgress`）和**看广告跳过**推进。
//
// ## 为什么接口还留着
//
// 1. 它是「服务端调试开关是否开启」的探针：`debug.enabled: false` 时 403，
//    客户端据此在控制台说明「服务端调试没开」。开关的独立把关（客户端绕过不算数）
//    这条安全边界必须留在服务端。
// 2. 生产环境 `config.prod.yaml` 不含 `debug` 段 → `Debug.Enabled` 零值 false
//    → 这个接口直接 403，表现得**根本不存在**。
//
// ## 被污染过的账号怎么救
//
// 见 `DebugRepairProgressHandler`：按 `level_records` 把 `max_level` 重算回真实值。
// 客户端调试面板上的「修进度」按钮就是打它。
func DebugJumpHandler(db *core.DB, debugEnabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		// ── 开关检查放在最前面 ──
		//
		// 必须在读参数之前 —— 生产环境下这个接口要表现得**根本不存在**。
		// （单测里 `db` 传 nil：开关关着时绝不能碰库。）
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

		lv := CoverLevels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}
		uid := core.UIDFromContext(c)

		// 回读当前进度**只为回包**（客户端日志 / 排查用），不参与任何写入。
		var maxLevel int
		if err := db.QueryRow("SELECT max_level FROM users WHERE id=$1", uid).Scan(&maxLevel); err != nil {
			core.Fail(c, core.CodeInternal, "读取进度失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"ok":       true,
			"maxLevel": maxLevel, // 原样返回，未推进
			"jumpedTo": req.LevelIdx,
		})
	}
}

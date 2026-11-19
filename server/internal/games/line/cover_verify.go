package line

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverVerifyHandler **服务端通关判定**。
//
// ## 为什么判定要放服务端
//
// 客户端现在的 `isCoverSolved` 只做两件事：覆盖全部格 + 线头在终点 —— 那只是
// 「看起来对了」的即时反馈（抖动、音效、通关动画都靠它）。真正的对错必须由
// 服务端按**完整规则**回放一遍，否则：
//
//   - 改内存就能通关（客户端判定可绕过）；
//   - 冰面滑行、单向门、星星顺序、钥匙门、传送门这些规则一旦有分歧，
//     客户端说通了、服务端说没通，成绩就不可信。
//
// ## 判据（`ValidateCoverPath`）
//
//   1. 路径长度 == 可走格数（必须铺满，不能重复、不能交叉）
//   2. 每一步都是合法移动（滑行 / 单向门 / 钥匙门 / 星星顺序 / 传送门）
//   3. 起终点约束
//
// 注意：这**不是**在解一遍题，只是照着玩家给的路径回放 —— O(n)，与求解器无关。
//
// ## 关卡数据来源
//
// 优先数据库（可热更），没有则回落到内置表。数据库为空时（本地开发常见）
// 内置表就是唯一来源 —— 不能因为表空就直接判「关卡不存在」。
func CoverVerifyHandler(levelDB *CoverLevelDB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			LevelIdx int `json:"levelIdx"`
			/** 玩家画出的完整路径（拍平索引序列，含起终点）。 */
			Path []int `json:"path"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		if len(req.Path) == 0 {
			core.Fail(c, core.CodeBadRequest, "路径为空")
			return
		}

		// ① 先查数据库（可热更），失败则回落内置表。
		err := levelDB.ValidatePath(c.Request.Context(), req.LevelIdx, req.Path)
		if err == ErrLevelNotFound {
			// 数据库没有这一关 → 用内置表
			err = CoverLevels.ValidatePath(req.LevelIdx, req.Path)
			if err != nil {
				// 内置表也说关卡不存在，才是真的不存在
				if _, ok := err.(*PathValidationError); !ok {
					core.Fail(c, core.CodeLevelNotFound, fmt.Sprintf("第 %d 关不存在", req.LevelIdx))
					return
				}
			}
		}

		if err != nil {
			// **校验失败不是服务器错误**：返回 200 + valid=false + 原因，
			// 让客户端能直接把原因显示给玩家（比如「路径长度不对」）。
			core.OK(c, gin.H{
				"valid":  false,
				"reason": err.Error(),
			})
			return
		}

		core.OK(c, gin.H{
			"valid":  true,
			"reason": "",
			"steps":  len(req.Path) - 1,
		})
	}
}

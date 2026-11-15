package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverHintHandler 按参考解给提示（**查表，零计算**）。
//
// ## 为什么要有这个接口
//
// 原来提示是**客户端实时求解**的：每次点「提示」都在主线程跑一遍
// 哈密顿搜索。实测冰块关 / 传送门关上会超时（剪枝失效），
// 表现为「这一关暂时给不出提示」。
//
// 现在参考解随关卡一起入库，玩家路径是参考解前缀时
// 直接切后缀 —— **O(1)，永远给得出**。
//
// ## 走岔了怎么办
//
// 玩家走岔时参考解接不回来（强行回退会让线突然倒退，体验极差）。
// 这时返回 `fromReference = false`，客户端退回实时求解。
//
// ## 安全
//
// 接口挂在鉴权组下（`auth`）。参考解**只在这里返回给客户端**，
// 但它已经是客户端能通过求解得到的东西（提示本身就是答案），
// 真正的防线是「关卡表下发时剥离解」—— 玩家不能靠读表白嫖通关。
func CoverHintHandler(db *CoverLevelDB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			LevelIdx int `json:"levelIdx"`
			/** 玩家已走过的格（拍平索引序列，含线头）。 */
			Walked []int `json:"walked"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}

		hint, err := db.HintByReference(c.Request.Context(), req.LevelIdx, req.Walked)
		if err != nil {
			if err == ErrLevelNotFound {
				core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
				return
			}
			core.Fail(c, core.CodeInternal, "查询提示失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"idx":          hint.Idx,
			"cells":        hint.Cells,
			"fromReference": hint.FromReference,
		})
	}
}

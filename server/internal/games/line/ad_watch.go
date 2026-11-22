package line

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverAdWatchHandler 记录一次「看完激励视频」，并返回累计次数。
//
// ## 为什么要单独一个接口
//
// `users.ad_watch_cnt` 这一列从 001 就存在，后台玩家详情页也在读它
// （`admin/stats.go` 的 `u.ad_watch_cnt`），但**全仓没有一处写过它** ——
// 界面显示「看广告次数 0 次」，是死数据。
//
// 挂到 `/api/cover/progress` 上也能写，但那样有两个问题：
//
//   - 通关失败（路径非法 / 用时异常）时，玩家其实已经看完广告了，
//     计数会跟着整笔请求一起回滚 —— 越是被判作弊的请求越不计数，
//     而广告平台那边是真扣了曝光；
//   - 看广告这件事和通关不是一件事，塞进同一个事务只会让
//     `applyCoverProgress` 越来越难读。
//
// 所以给一条轻量接口：一个 `UPDATE ... RETURNING`，无事务、无锁。
//
// ## 广告有没有真看完，服务端验不了
//
// 与 `cover_unlock.go` 同一个折衷：看完是平台 SDK 在**客户端**回调的，
// 我们没接广告主验签。伪造请求多刷几次计数，损失是后台一个数字不准，
// 不影响进度、发奖或排行榜 —— 不值得为它把链路做复杂。
// 真要准，就在 `ad_revenue` 对账时以平台回调为准。
func CoverAdWatchHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 请求体可以空：`placement` 只用于将来的分广告位统计，
		// 现在不落库，所以绑不上也不算错。
		var req struct {
			Placement string `json:"placement"`
		}
		_ = c.ShouldBindJSON(&req)

		uid := core.UIDFromContext(c)

		// 单条 UPDATE 自增：不需要读-改-写，也就没有并发丢更新的问题。
		// `RETURNING` 顺手把新值带回来，客户端不用再拉一次 profile。
		var cnt int
		err := db.QueryRow(
			"UPDATE users SET ad_watch_cnt = ad_watch_cnt + 1 WHERE id=$1 RETURNING ad_watch_cnt",
			uid,
		).Scan(&cnt)
		if err != nil {
			core.Fail(c, core.CodeInternal, "记录广告次数失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"adWatchCnt": cnt,
			"placement":  req.Placement,
		})
	}
}

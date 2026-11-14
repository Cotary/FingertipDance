package line

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// SkinConfig 描述一个皮肤的解锁条件。
type SkinConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Tier        string `json:"tier"`
	UnlockType  string `json:"unlockType"`
	UnlockValue int    `json:"unlockValue"`
}

// ConfigHandler 返回关卡版本、皮肤表与广告配置。
//
// ## 两套关卡表
//
// 经典模式（起终点连线）与 cover 模式（铺满全盘）各有自己的表，
// 版本号必须**分别**下发 —— 客户端按版本号决定要不要重拉，
// 只报一个版本号的话，改了 cover 表客户端却以为没变。
//
// `levelVersion` / `levelCount` 保留**经典模式**的语义（老客户端在用），
// cover 的用 `coverLevelVersion` / `coverLevelCount`。
func ConfigHandler(skins []SkinConfig, adID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		core.OK(c, gin.H{
			"levelVersion": Levels.Version(),
			"levelCount":   Levels.Count(),
			// cover 模式（现行玩法）的表版本与关数
			"coverLevelVersion": CoverLevels.Version(),
			"coverLevelCount":   CoverLevels.Count(),
			"skins":             skins,
			"ad": gin.H{
				"rewardedVideoId": adID,
				"interstitialId":  "",
			},
			"features": gin.H{
				"hint":           true,
				"skip":           true,
				"shareChallenge": true,
			},
			"serverTime": time.Now().UnixMilli(),
		})
	}
}

// LevelsHandler 分批下发关卡表。
//
// Deprecated: **经典模式已下线** —— 客户端现在只用 cover 模式
// （`/api/levels-v3`）。这个接口保留是为了兼容老客户端，
// 新的客户端代码不要调用它。
func LevelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		from, err := strconv.Atoi(c.DefaultQuery("from", "1"))
		if err != nil || from < 1 {
			core.Fail(c, core.CodeBadRequest, "from 参数非法")
			return
		}
		count, err := strconv.Atoi(c.DefaultQuery("count", "50"))
		if err != nil || count < 1 || count > 100 {
			core.Fail(c, core.CodeBadRequest, "count 参数需在 1..100 之间")
			return
		}
		levels := Levels.Range(from, count)
		core.OK(c, gin.H{
			"version": Levels.Version(),
			"from":    from,
			"levels":  levels,
		})
	}
}

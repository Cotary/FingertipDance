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
func ConfigHandler(skins []SkinConfig, adID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		core.OK(c, gin.H{
			"levelVersion": Levels.Version(),
			"levelCount":   Levels.Count(),
			"skins":        skins,
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

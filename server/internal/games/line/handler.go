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

// PlatformConfigLoader 按平台读取运营配置。
//
// ## 为什么用函数注入，而不是在这里直接查库
//
// 读写平台配置的 SQL 在 `admin/config_store.go`（后台是唯一的写入口），
// 而 admin 已经 import 了 line。这里再 import admin 就成环了。
//
// 注入一个函数把依赖方向拉直：line 只定义「怎么用配置」，
// 数据从哪来由 main 决定。顺带的好处是——测试不用连数据库。
type PlatformConfigLoader func(platform int) (PlatformConfig, error)

// ConfigHandler 返回关卡版本、皮肤表与**按平台**的运营配置。
//
// ## 两套关卡表
//
// 经典模式（起终点连线）与 cover 模式（铺满全盘）各有自己的表，
// 版本号必须**分别**下发 —— 客户端按版本号决定要不要重拉，
// 只报一个版本号的话，改了 cover 表客户端却以为没变。
//
// `levelVersion` / `levelCount` 保留**经典模式**的语义（老客户端在用），
// cover 的用 `coverLevelVersion` / `coverLevelCount`。
//
// ## 平台由 query 声明
//
// 这个接口**不鉴权**，而且客户端在登录之前就要拿到它（登录失败也要能玩），
// 那时没有 token、推断不出平台。所以由客户端带 `?platform=`，
// 缺失或非法一律按微信处理（老客户端走的也是这条路）——
// 详见 `PlatformCodeOf`。
//
// ## 配置读不出来时不能失败
//
// 这个接口挂掉，客户端会退回内置默认值：广告位变 placeholder、
// 分享链接拼不出来。但「读不到配置」不该等于「退回一个更差的世界」——
// 所以读写失败只记日志，照常返回默认配置。
func ConfigHandler(load PlatformConfigLoader, skins []SkinConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		platform := PlatformCodeOf(c.Query("platform"))

		cfg := DefaultPlatformConfig()
		if load != nil {
			if got, err := load(platform); err == nil {
				// 兜住库里的历史脏值（负数间隔 / 非法 URL）
				cfg = got.Normalize()
			}
		}

		core.OK(c, gin.H{
			"levelVersion": Levels.Version(),
			"levelCount":   Levels.Count(),
			// cover 模式（现行玩法）的表版本与关数
			"coverLevelVersion": CoverLevels.Version(),
			"coverLevelCount":   CoverLevels.Count(),
			"skins":             skins,
			// 本次按哪个平台下发（客户端可据此自检映射有没有搞错）
			"platform":      platform,
			"shareUrlPrefix": cfg.ShareURLPrefix,
			"ad": gin.H{
				"rewardedVideoId": cfg.Ad.RewardedVideoID,
				"interstitialId":  cfg.Ad.InterstitialID,
				"bannerId":        cfg.Ad.BannerID,
				// 频控：服务端只下发参数，判定在客户端（见 ads.ts / rewardRules.ts）
				"interstitialIntervalSec": cfg.Ad.InterstitialIntervalSec,
				"rewardedDailyLimit":      cfg.Ad.RewardedDailyLimit,
				"hintFreeUses":            cfg.Ad.HintFreeUses,
				"skipDailyLimit":          cfg.Ad.SkipDailyLimit,
			},
			// ## 这里必须**逐个字段写**，不能用 `cfg.Features` 直接序列化
			//
			// 用结构体直接序列化会自动带上新加的字段，就不会漏 —— 但历史上
			// 这里一直是手写 map，于是 `mechIntro` 加进配置结构后**忘了补这一行**：
			// 后台能存、库里能读，客户端却永远收不到，机制说明卡一张都不弹，
			// 而且没有任何报错（客户端把缺失当成"开"以外的任何处理都不对劲）。
			//
			// 所以这行新增字段时要同步加一条测试（见 cover_contract_test.go 的
			// TestConfigHandlerSendsAllFeatureFlags）。
			"features": gin.H{
				"hint":           cfg.Features.Hint,
				"skip":           cfg.Features.Skip,
				"shareChallenge": cfg.Features.ShareChallenge,
				"mechIntro":      cfg.Features.MechIntro,
			},
			// 主题的**解锁条件**（不是主题本体）。客户端按 id 覆盖本地常量，
			// 没下发的 id 保持本地不变。
			"themes":     cfg.Themes,
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

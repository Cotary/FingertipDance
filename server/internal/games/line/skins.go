package line

// DefaultSkins 返回默认皮肤表。
//
// ## 必须与客户端 `src/render/skins/index.ts` 的 `SKINS` 保持一致
//
// 这份表通过 `/api/config` 下发给客户端。虽然当前客户端皮肤页用的是
// 本地的 `SKINS` 常量、不读服务端这份，但一旦有别处（比如运营后台、
// 小程序热更）读它，口径不一致就会表现为「皮肤页说看广告解锁，
// 服务端说通关第 3 关解锁」。
//
// ## 关于 8 个 normal 皮肤
//
// 客户端在 2026-11-01 把它们从「按关卡自动发放」改成了「看广告解锁」
// （理由：打关卡和看广告发的是同一批货，稀缺感被稀释）。
// 这里同步改成 `ad`。
//
// **实际发放不依赖这张表** —— 皮肤是按关卡表的 `unlockSkin` 字段发的
// （见 `grantSkinForLevel`），所以改这里不会影响真实发放。
func DefaultSkins() []SkinConfig {
	return []SkinConfig{
		{ID: "wood", Name: "原木", Tier: "free", UnlockType: "default", UnlockValue: 0},
		{ID: "mint", Name: "薄荷", Tier: "free", UnlockType: "default", UnlockValue: 0},
		{ID: "graphite", Name: "石墨", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "slate", Name: "青岩", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "blush", Name: "藕粉", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "amber", Name: "琥珀", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "marble", Name: "大理石", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "brushed", Name: "金属拉丝", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "ice", Name: "冰晶", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "neon", Name: "霓虹", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "gold", Name: "黄金", Tier: "premium", UnlockType: "milestone", UnlockValue: 200},
		{ID: "stardust", Name: "星尘", Tier: "premium", UnlockType: "milestone", UnlockValue: 500},
		{ID: "galaxy", Name: "星河", Tier: "premium", UnlockType: "milestone", UnlockValue: 900},
		{ID: "ad_rose", Name: "玫瑰", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "ad_ocean", Name: "深海", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "ad_ember", Name: "余烬", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
	}
}

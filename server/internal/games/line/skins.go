package line

// DefaultSkins 返回默认皮肤表。与客户端 skins.ts 保持一致。
func DefaultSkins() []SkinConfig {
	return []SkinConfig{
		{ID: "wood", Name: "原木", Tier: "free", UnlockType: "default", UnlockValue: 0},
		{ID: "mint", Name: "薄荷", Tier: "free", UnlockType: "default", UnlockValue: 0},
		{ID: "graphite", Name: "石墨", Tier: "normal", UnlockType: "level", UnlockValue: 3},
		{ID: "slate", Name: "青岩", Tier: "normal", UnlockType: "level", UnlockValue: 8},
		{ID: "blush", Name: "藕粉", Tier: "normal", UnlockType: "level", UnlockValue: 15},
		{ID: "amber", Name: "琥珀", Tier: "normal", UnlockType: "level", UnlockValue: 25},
		{ID: "marble", Name: "大理石", Tier: "normal", UnlockType: "level", UnlockValue: 40},
		{ID: "brushed", Name: "金属拉丝", Tier: "normal", UnlockType: "level", UnlockValue: 60},
		{ID: "ice", Name: "冰晶", Tier: "normal", UnlockType: "level", UnlockValue: 90},
		{ID: "neon", Name: "霓虹", Tier: "normal", UnlockType: "level", UnlockValue: 130},
		{ID: "gold", Name: "黄金", Tier: "premium", UnlockType: "milestone", UnlockValue: 200},
		{ID: "stardust", Name: "星尘", Tier: "premium", UnlockType: "milestone", UnlockValue: 500},
		{ID: "galaxy", Name: "星河", Tier: "premium", UnlockType: "milestone", UnlockValue: 900},
		{ID: "ad_rose", Name: "玫瑰", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "ad_ocean", Name: "深海", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
		{ID: "ad_ember", Name: "余烬", Tier: "normal", UnlockType: "ad", UnlockValue: 0},
	}
}

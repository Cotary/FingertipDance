package line

import "testing"

// 看广告解锁的**准入判定**。
//
// 这几条决定"付费墙有没有被绕开"：
// 客户端只能说自己想解锁哪个 id，能不能解锁由这里判。

func TestThemeUnlockableOnlyWhenAdTier(t *testing.T) {
	cfg := DefaultPlatformConfig()

	// 默认两套：mise 免费、mingsha 里程碑 60 —— 都不能走广告
	if themeUnlockableByAd(cfg, "mise") {
		t.Error("免费主题不该能用广告解锁")
	}
	if themeUnlockableByAd(cfg, "mingsha") {
		t.Error("里程碑主题不该能用广告解锁（否则等于跳过 60 关）")
	}

	// 运营把某套改成 ad 档之后才允许
	cfg.Themes = append(cfg.Themes, ThemeConfig{ID: "night", Name: "夜色", Unlock: "ad"})
	if !themeUnlockableByAd(cfg, "night") {
		t.Error("ad 档主题应可解锁")
	}
	if themeUnlockableByAd(cfg, "unknown") {
		t.Error("配置里没有的主题一律拒绝")
	}
}

func TestSkinUnlockableOnlyWhenAd(t *testing.T) {
	skins := DefaultSkins()

	// 普通皮肤（ad 档）可解锁
	if !skinUnlockableByAd(skins, "graphite") {
		t.Error("ad 档皮肤应可解锁")
	}
	// 免费皮肤不需要走广告，也不该被这条接口当成可解锁（否则多发一次奖励）
	if skinUnlockableByAd(skins, "wood") {
		t.Error("免费皮肤不该走广告解锁")
	}
	// 里程碑专属：黄金 / 星尘 / 星河
	for _, id := range []string{"gold", "stardust", "galaxy"} {
		if skinUnlockableByAd(skins, id) {
			t.Errorf("%s 是里程碑皮肤，不能走广告解锁", id)
		}
	}
	if skinUnlockableByAd(skins, "nope") {
		t.Error("未知 id 一律拒绝")
	}
}

package line

import (
	"encoding/json"
	"testing"
)

// TestDefaultPlatformConfigKeepsLegacyBehavior 锁定「不配置 = 与改造前一致」。
//
// 这是这次改造的安全底线：数据库里一行都没有时，客户端拿到的
// 广告位、功能开关、免费提示次数必须和硬编码时期**逐项相同**。
// 一旦这里变了，线上会在没有任何配置动作的情况下悄悄改行为。
func TestDefaultPlatformConfigKeepsLegacyBehavior(t *testing.T) {
	c := DefaultPlatformConfig()

	if c.Ad.RewardedVideoID != "adunit-mock" {
		t.Errorf("默认激励视频广告位 = %q，应保持改造前的 adunit-mock", c.Ad.RewardedVideoID)
	}
	if c.Ad.InterstitialIntervalSec != 60 {
		t.Errorf("默认插屏间隔 = %d 秒，应与 ads.ts 的 60_000ms 一致", c.Ad.InterstitialIntervalSec)
	}
	if !c.Features.Hint || !c.Features.Skip || !c.Features.ShareChallenge {
		t.Errorf("默认功能开关应全开，实际 = %+v", c.Features)
	}
	if c.Ad.HintFreeUses != 0 {
		t.Errorf("默认免费提示次数 = %d，应为 0（首次就要看广告）", c.Ad.HintFreeUses)
	}
	// 主题是「内容」，默认必须都解锁得出来，不能因为配置表空着就全锁
	if len(c.Themes) != 2 {
		t.Fatalf("默认主题数 = %d，应为 2（与客户端 THEMES 对齐）", len(c.Themes))
	}
	if c.Themes[0].ID != "mise" || c.Themes[0].Unlock != "free" {
		t.Errorf("默认第一套主题应为 mise/free，实际 = %+v", c.Themes[0])
	}
	if c.Themes[1].ID != "mingsha" || c.Themes[1].Unlock != "milestone" || c.Themes[1].Value != 60 {
		t.Errorf("默认第二套主题应为 mingsha/milestone/60，实际 = %+v", c.Themes[1])
	}
}

// TestMergeEmptyKeepsDefaults 锁定「空对象 = 全默认」。
//
// 迁移预置的行存的是 `{}`。如果这里反序列化成零值，
// 广告位会变成空串、开关全变 false —— 一次启动就把线上关停。
func TestMergeEmptyKeepsDefaults(t *testing.T) {
	for _, raw := range [][]byte{nil, []byte("{}")} {
		c, err := MergePlatformConfig(raw)
		if err != nil {
			t.Fatalf("解析 %q 失败: %v", raw, err)
		}
		if c.Ad.RewardedVideoID != "adunit-mock" || !c.Features.Hint {
			t.Errorf("%q 应解析为默认值，实际 ad=%+v features=%+v", raw, c.Ad, c.Features)
		}
	}
}

// TestMergePartialKeepsUntouchedFields 锁定「只覆盖出现的字段」。
//
// 这条决定了以后新增配置项**不需要迁移老行**：
// 老 JSON 里没有的字段，读出来就是新默认值。
func TestMergePartialKeepsUntouchedFields(t *testing.T) {
	c, err := MergePlatformConfig([]byte(`{"ad":{"interstitialId":"inter-1"}}`))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if c.Ad.InterstitialID != "inter-1" {
		t.Errorf("插屏广告位 = %q，期望 inter-1", c.Ad.InterstitialID)
	}
	if c.Ad.RewardedVideoID != "adunit-mock" {
		t.Errorf("没下发的激励视频广告位被改成了 %q", c.Ad.RewardedVideoID)
	}
	if c.Ad.InterstitialIntervalSec != 60 {
		t.Errorf("没下发的插屏间隔被改成了 %d", c.Ad.InterstitialIntervalSec)
	}
	if !c.Features.Skip {
		t.Error("没下发的功能开关被改成了 false")
	}
}

// TestNormalizeClampsBadInput 锁定表单脏值的收口。
//
// 后台是纯文本表单，运营会填负数、超长值、没有协议的域名。
// 这些值原样下发会让客户端「永远不解锁 / 永远不弹插屏」，
// 而且从界面上完全看不出是配置的问题。
func TestNormalizeClampsBadInput(t *testing.T) {
	c := PlatformConfig{
		ShareURLPrefix: "  game.example.com/line?  ",
		Ad: AdConfig{
			RewardedVideoID:         "  ",
			InterstitialIntervalSec: -5,
			HintFreeUses:            999,
			SkipDailyLimit:          -1,
			RewardedDailyLimit:      1000000,
		},
	}
	n := c.Normalize()

	if n.ShareURLPrefix != "" {
		t.Errorf("没有协议的分享前缀应被丢弃，实际 = %q", n.ShareURLPrefix)
	}
	if n.Ad.RewardedVideoID == "" {
		t.Error("空广告位应回落默认值（空串会让客户端用 placeholder）")
	}
	if n.Ad.InterstitialIntervalSec != 0 {
		t.Errorf("负间隔应夹到 0，实际 = %d", n.Ad.InterstitialIntervalSec)
	}
	if n.Ad.HintFreeUses != 20 {
		t.Errorf("免费提示次数应夹到 20，实际 = %d", n.Ad.HintFreeUses)
	}
	if n.Ad.SkipDailyLimit != 0 {
		t.Errorf("负的跳关上限应夹到 0（= 不限），实际 = %d", n.Ad.SkipDailyLimit)
	}
	if n.Ad.RewardedDailyLimit != 1000 {
		t.Errorf("激励上限应夹到 1000，实际 = %d", n.Ad.RewardedDailyLimit)
	}
}

// TestNormalizeSharePrefixTrimsQuerySeparator 锁定分享前缀不带悬挂分隔符。
//
// 客户端拼的是 `前缀 + "?" + query`。前缀末尾留着 `?` 或 `&`
// 会拼出 `...line?&l=47`，有些容器解析出来的 query 是空的。
func TestNormalizeSharePrefixTrimsQuerySeparator(t *testing.T) {
	c := PlatformConfig{ShareURLPrefix: "https://game.example.com/line?&"}
	if got := c.Normalize().ShareURLPrefix; got != "https://game.example.com/line" {
		t.Errorf("分享前缀 = %q，期望去掉尾部的 ?&", got)
	}
}

// TestNormalizeThemes 锁定主题行的清洗规则。
func TestNormalizeThemes(t *testing.T) {
	c := PlatformConfig{Themes: []ThemeConfig{
		{ID: "mise", Unlock: "free", Value: 999},                // 非里程碑 → value 归零
		{ID: "mise", Unlock: "ad"},                              // 重复 id → 丢弃
		{ID: "  ", Unlock: "free"},                              // 空 id → 丢弃
		{ID: "weird", Unlock: "收费", Value: 12},                  // 未知解锁方式 → free
		{ID: "late", Unlock: "milestone", Value: -3},            // 负关号 → 0
		{ID: "named", Name: " ", Unlock: "milestone", Value: 9}, // 空名字 → 用 id
	}}
	n := c.Normalize()

	if len(n.Themes) != 4 {
		t.Fatalf("清洗后主题数 = %d，应为 4（重复与空 id 被丢弃）: %+v", len(n.Themes), n.Themes)
	}
	if n.Themes[0].ID != "mise" || n.Themes[0].Value != 0 {
		t.Errorf("free 主题的 value 应归零，实际 = %+v", n.Themes[0])
	}
	if n.Themes[1].Unlock != "free" {
		t.Errorf("未知解锁方式应回落 free，实际 = %+v", n.Themes[1])
	}
	if n.Themes[2].Value != 0 {
		t.Errorf("负的里程碑关号应夹到 0，实际 = %+v", n.Themes[2])
	}
	if n.Themes[3].Name != "named" {
		t.Errorf("空名称应回落 id，实际 = %q", n.Themes[3].Name)
	}
}

// TestPlatformCodeOf 锁定平台映射。
//
// ## 为什么未知值也要能跑
//
// `/api/config` 不鉴权、客户端在登录前就要拿到。
// 一个写错的参数不该让广告位变成 placeholder（那等于当天没有广告收入），
// 所以未知值按微信处理 —— 那是唯一已经在跑的平台。
func TestPlatformCodeOf(t *testing.T) {
	cases := map[string]int{
		"":       PlatformWechat,
		"1":      PlatformWechat,
		"2":      PlatformDouyin,
		"3":      PlatformWeb,
		"wechat": PlatformWechat,
		"douyin": PlatformDouyin,
		"web":    PlatformWeb,
		"9":      PlatformWechat,
		"???":    PlatformWechat,
	}
	for raw, want := range cases {
		if got := PlatformCodeOf(raw); got != want {
			t.Errorf("PlatformCodeOf(%q) = %d，期望 %d", raw, got, want)
		}
	}
}

// TestPlatformConfigJSONShape 锁定下发给客户端的字段名。
//
// 客户端按这些 key 读（`api.ts` 的 ServerConfig）。改名不会有编译错误，
// 只会让客户端静默拿到 undefined —— 然后退回默认值，谁都不知道配置没生效。
func TestPlatformConfigJSONShape(t *testing.T) {
	b, err := json.Marshal(DefaultPlatformConfig())
	if err != nil {
		t.Fatalf("序列化失败: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("反序列化失败: %v", err)
	}
	for _, k := range []string{"shareUrlPrefix", "ad", "features", "themes"} {
		if _, ok := m[k]; !ok {
			t.Errorf("下发的配置缺少字段 %q", k)
		}
	}
	ad, _ := m["ad"].(map[string]any)
	for _, k := range []string{
		"rewardedVideoId", "interstitialId", "bannerId",
		"interstitialIntervalSec", "rewardedDailyLimit", "hintFreeUses", "skipDailyLimit",
	} {
		if _, ok := ad[k]; !ok {
			t.Errorf("ad 缺少字段 %q", k)
		}
	}
}

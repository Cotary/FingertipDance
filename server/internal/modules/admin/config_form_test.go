package admin

import (
	"net/url"
	"strings"
	"testing"

	"github.com/tupss/f-game/server/internal/games/line"
)

// TestFormPrefixSeparatesPlatforms 锁定两个平台字段名不串台。
//
// 一张表单里放两份配置，字段名是唯一的区分。
// 一旦串了，保存后两份配置会变成同一份 —— 而且表现是
// 「抖音的广告位填到了微信」，从后台界面上完全看不出来。
func TestFormPrefixSeparatesPlatforms(t *testing.T) {
	if got := formPrefix(line.PlatformWechat); got != "wx_" {
		t.Errorf("微信前缀 = %q", got)
	}
	if got := formPrefix(line.PlatformDouyin); got != "dy_" {
		t.Errorf("抖音前缀 = %q", got)
	}
}

// TestReadPlatformFormIsolatesPlatforms 锁定同一次提交里两平台互不影响。
func TestReadPlatformFormIsolatesPlatforms(t *testing.T) {
	form := url.Values{
		"wx_ad_rewardedVideoId":  {"wx-rewarded"},
		"wx_ad_interstitialId":   {"wx-inter"},
		"dy_ad_rewardedVideoId":  {"dy-rewarded"},
		"wx_feat_hint":           {"on"},
		"dy_feat_shareChallenge": {"on"},
	}
	base := line.DefaultPlatformConfig()

	wx := ReadPlatformForm(form, "wx_", base)
	dy := ReadPlatformForm(form, "dy_", base)

	if wx.Ad.RewardedVideoID != "wx-rewarded" || wx.Ad.InterstitialID != "wx-inter" {
		t.Errorf("微信广告位解析错误: %+v", wx.Ad)
	}
	if dy.Ad.RewardedVideoID != "dy-rewarded" {
		t.Errorf("抖音广告位解析错误: %+v", dy.Ad)
	}
	if dy.Ad.InterstitialID == "wx-inter" {
		t.Error("微信的插屏广告位串到了抖音（字段前缀没生效）")
	}
	if !wx.Features.Hint {
		t.Error("微信的「提示」开关应为开")
	}
	if dy.Features.Hint {
		t.Error("抖音没勾「提示」，却解析成了开")
	}
	if !dy.Features.ShareChallenge {
		t.Error("抖音勾了「分享挑战」，却解析成了关")
	}
}

// TestReadPlatformFormBlankNumberKeepsBase 锁定「留空 = 用当前值」。
//
// 运营只想改广告位时，频控输入框可能是空的（或者被浏览器自动填充清掉）。
// 留空按 0 处理的话，插屏间隔会变成 0 → 每次结算都弹广告；
// 免费提示次数变成 0 → 玩家突然每次提示都要看广告。都是静默的行为变化。
func TestReadPlatformFormBlankNumberKeepsBase(t *testing.T) {
	base := line.DefaultPlatformConfig()
	base.Ad.HintFreeUses = 3
	base.Ad.InterstitialIntervalSec = 90

	cfg := ReadPlatformForm(url.Values{"wx_ad_rewardedVideoId": {"id"}}, "wx_", base)
	if cfg.Ad.HintFreeUses != 3 {
		t.Errorf("留空的免费提示次数 = %d，应保留当前值 3", cfg.Ad.HintFreeUses)
	}
	if cfg.Ad.InterstitialIntervalSec != 90 {
		t.Errorf("留空的插屏间隔 = %d，应保留当前值 90", cfg.Ad.InterstitialIntervalSec)
	}
}

// TestReadPlatformFormParsesThemes 锁定主题行解析。
//
// 页面上永远多画几行空位（加主题时不用改后台代码），
// 空 id 的行必须被忽略 —— 否则每保存一次就多出几条空主题，
// 客户端拿到一堆 id 为空的行。
func TestReadPlatformFormParsesThemes(t *testing.T) {
	form := url.Values{
		"wx_theme_0_id":     {"mise"},
		"wx_theme_0_name":   {"秘色天青"},
		"wx_theme_0_unlock": {"free"},
		"wx_theme_0_value":  {"0"},

		"wx_theme_1_id":     {"mingsha"},
		"wx_theme_1_name":   {"鸣沙丹青"},
		"wx_theme_1_unlock": {"milestone"},
		"wx_theme_1_value":  {"120"},

		// 空行（页面上本来就画着三行空白）
		"wx_theme_2_id":     {""},
		"wx_theme_2_name":   {""},
		"wx_theme_2_unlock": {"free"},
		"wx_theme_2_value":  {""},

		// 未知解锁方式：应回落 free，而不是让客户端拿到一个不认识的值
		"wx_theme_3_id":     {"future"},
		"wx_theme_3_unlock": {"收费"},
		"wx_theme_3_value":  {"999"},
	}
	cfg := ReadPlatformForm(form, "wx_", line.DefaultPlatformConfig())

	if len(cfg.Themes) != 3 {
		t.Fatalf("解析出 %d 条主题，应为 3（空 id 行被忽略）: %+v", len(cfg.Themes), cfg.Themes)
	}
	if cfg.Themes[1].Value != 120 || cfg.Themes[1].Unlock != "milestone" {
		t.Errorf("里程碑主题解析错误: %+v", cfg.Themes[1])
	}
	if cfg.Themes[2].Unlock != "free" {
		t.Errorf("未知解锁方式应回落 free，实际 = %+v", cfg.Themes[2])
	}
}

// TestReadPlatformFormNormalizes 锁定「提交即归一化」。
//
// 归一化必须发生在**回显之前**：保存失败时页面显示的是
// `ReadPlatformForm` 的返回值。如果这里没归一化，
// 运营会看到一个自己没填过的负数，以为表单被改坏了。
func TestReadPlatformFormNormalizes(t *testing.T) {
	form := url.Values{
		"wx_ad_interstitialIntervalSec": {"-30"},
		"wx_ad_hintFreeUses":            {"500"},
		"wx_shareUrlPrefix":             {"game.example.com"},
	}
	cfg := ReadPlatformForm(form, "wx_", line.DefaultPlatformConfig())

	if cfg.Ad.InterstitialIntervalSec != 0 {
		t.Errorf("负间隔应归一化为 0，实际 = %d", cfg.Ad.InterstitialIntervalSec)
	}
	if cfg.Ad.HintFreeUses != 20 {
		t.Errorf("超大的免费提示次数应夹到 20，实际 = %d", cfg.Ad.HintFreeUses)
	}
	if cfg.ShareURLPrefix != "" {
		t.Errorf("没有协议的分享前缀应被丢弃，实际 = %q", cfg.ShareURLPrefix)
	}
}

// TestFormHasPlatform 锁定「提交里缺某个平台时不覆盖它」的判据。
//
// 后台一次提交会为两个平台各构造一份配置。如果表单里根本没有
// 抖音字段，走 `ReadPlatformForm` 会得到「开关全关 + 主题为空」——
// 保存后抖音被静默下线。判据必须在解析之前拦一下。
func TestFormHasPlatform(t *testing.T) {
	v := url.Values{"wx_ad_rewardedVideoId": {"x"}}
	if !formHasPlatform(v, "wx_") {
		t.Error("表单里有 wx_ 字段，应判为 true")
	}
	if formHasPlatform(v, "dy_") {
		t.Error("表单里没有 dy_ 字段，应判为 false")
	}
	if formHasPlatform(url.Values{}, "wx_") {
		t.Error("空表单应判为 false")
	}
}

// TestKnownThemeIDsHint 锁定后台「主题 id」旁边的提示不是空话。
//
// 主题 id 写错**不会报错**，只是那一行永远不生效 —— 运营会以为
// 已经配好了。所以必须在表单上把「客户端认得哪些 id」列出来。
// 这份清单来自 DefaultPlatformConfig，与服务端默认配置同源。
func TestKnownThemeIDsHint(t *testing.T) {
	hint := knownThemeIDs()
	if hint == "" {
		t.Fatal("主题 id 提示为空 —— 运营没有任何依据判断自己写错了")
	}
	for _, want := range []string{"mise", "mingsha"} {
		if !strings.Contains(hint, want) {
			t.Errorf("提示里缺 %q：%q", want, hint)
		}
	}
}

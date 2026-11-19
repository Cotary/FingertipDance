package adrev

import (
	"testing"
	"time"
)

// TestClassifySlot 锁定广告位归类。
//
// ## 为什么重要
//
// 平台给的广告位名五花八门（`SLOT_ID_WEAPP_REWARD_VIDEO`、`激励视频`、
// `rewarded_video`…），且抖音还按 banner/interstitial/video 三档返回。
// 不归类的话，后台按「激励视频 / 插屏 / Banner」筛选完全没用 ——
// 每种名字都算成一个独立类型，列表上会散成几十行。
func TestClassifySlot(t *testing.T) {
	cases := []struct {
		in   string
		want string
		desc string
	}{
		{"SLOT_ID_WEAPP_REWARD_VIDEO", "rewarded", "微信长命名"},
		{"rewarded_video", "rewarded", "下划线命名"},
		{"激励视频", "rewarded", "中文名"},
		{"interstitial", "interstitial", "插屏英文"},
		{"插屏广告", "interstitial", "插屏中文"},
		{"banner", "banner", "banner"},
		{"BANNER_AD", "banner", "大写 banner"},
		{"横幅", "banner", "中文横幅"},
		{"unknown_slot", "", "认不出 → 空（= 合计）"},
		{"", "", "空串"},
	}
	for _, c := range cases {
		if got := classifySlot(c.in); got != c.want {
			t.Errorf("%s: classifySlot(%q) = %q，期望 %q", c.desc, c.in, got, c.want)
		}
	}
}

// TestSyncerSkipsWithoutCreds 锁定「没凭证就安静跳过」。
//
// ## 为什么这条重要
//
// 本地开发、CI、还没申请到流量主的阶段都没有真实凭证。
// 如果同步器在这种情况下报错，日志会被无意义的失败刷满，
// 而真正的错误反而被淹掉。
//
// 跳过 ≠ 失败：`Skipped=true` + `Reason` 说明原因，`Err` 保持空。
func TestSyncerSkipsWithoutCreds(t *testing.T) {
	s := New(nil, Creds{}, Creds{})
	results := s.SyncRange(time.Now(), time.Now())
	if len(results) != 2 {
		t.Fatalf("应返回两个平台的结果，实际 %d", len(results))
	}
	for _, r := range results {
		if !r.Skipped {
			t.Errorf("平台 %d 没凭证时应跳过，实际 Skipped=false", r.Platform)
		}
		if r.Err != "" {
			t.Errorf("平台 %d 跳过时不应有错误，实际 %q", r.Platform, r.Err)
		}
		if r.Reason == "" {
			t.Errorf("平台 %d 跳过时必须说明原因", r.Platform)
		}
	}
}

// TestSyncerSkipsInMockMode 锁定 mock 模式也不打外部请求。
func TestSyncerSkipsInMockMode(t *testing.T) {
	s := New(nil, Creds{AppID: "a", Secret: "b", Mock: true}, Creds{AppID: "c", Secret: "d", Mock: true})
	for _, r := range s.SyncRange(time.Now(), time.Now()) {
		if !r.Skipped {
			t.Errorf("mock 模式下平台 %d 应跳过", r.Platform)
		}
		if r.Err != "" {
			t.Errorf("mock 模式下平台 %d 不应报错：%q", r.Platform, r.Err)
		}
	}
}

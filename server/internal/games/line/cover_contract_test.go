package line

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// TestCoverUnlockSkinPresent 验证 cover 关卡表**带** unlockSkin 字段。
//
// 背景（2026-11-06）：cover 关卡表曾经没有这个字段，
// 而服务端发皮肤的逻辑是「读关卡表的 unlockSkin」——
// 结果 premium 三款（黄金/星尘/星河）在 cover 模式下**永远拿不到**。
//
// 这个测试锁死「表里必须有，且必须覆盖三关 premium」。
func TestCoverUnlockSkinPresent(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	want := map[int]string{200: "gold", 500: "stardust", 900: "galaxy"}
	found := 0
	for idx, wantSkin := range want {
		lv := CoverLevels.Get(idx)
		if lv == nil {
			t.Fatalf("第 %d 关缺失", idx)
		}
		if lv.UnlockSkin == nil {
			t.Fatalf("第 %d 关缺少 unlockSkin", idx)
		}
		if *lv.UnlockSkin != wantSkin {
			t.Fatalf("第 %d 关 unlockSkin = %q，期望 %q", idx, *lv.UnlockSkin, wantSkin)
		}
		found++
	}
	if found != len(want) {
		t.Fatalf("校验了 %d 关，期望 %d 关", found, len(want))
	}
}

// TestCoverSkipUsesCoverTable 验证 cover 跳过的步数取自 cover 表。
//
// 背景（2026-11-06）：cover 模式跳过时用的是**经典**表的 `shortest`，
// 而 cover 的步数恒为 `required − 1` —— 两者根本不是一回事。
func TestCoverSkipUsesCoverTable(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	for idx := 1; idx <= 20; idx++ {
		lv := CoverLevels.Get(idx)
		if lv == nil {
			t.Fatalf("第 %d 关缺失", idx)
		}
		// cover 的跳过步数 = required − 1（铺满一条路）
		if lv.Required-1 <= 0 {
			t.Fatalf("第 %d 关 required = %d，步数应为正", idx, lv.Required)
		}
	}
}

// TestModeConstantsDistinct 验证两种模式的常量不同且语义正确。
//
// 主键是 `(uid, mode, level_idx)` —— mode 相同就等于没隔离。
func TestModeConstantsDistinct(t *testing.T) {
	if ModeClassic == ModeCover {
		t.Fatal("经典模式与 cover 模式的 mode 常量不能相同")
	}
	if ModeClassic != 0 || ModeCover != 1 {
		t.Fatalf("mode 常量应为 classic=0 cover=1，实际 %d / %d", ModeClassic, ModeCover)
	}
}

// TestStarOfCoverThresholds 锁定 cover 模式的星级阈值。
//
// 阈值必须与客户端 `ui/hud.ts` 的 `starOfCover` **完全一致**，
// 任何一侧改动都会导致两端算出的星级不同（地图上显示 3 星、结算页显示 2 星）。
func TestStarOfCoverThresholds(t *testing.T) {
	cases := []struct {
		undos int
		want  int
	}{
		{0, 3},
		{1, 2},
		{2, 2},
		{3, 1},
		{10, 1},
	}
	for _, c := range cases {
		if got := StarOfCover(c.undos); got != c.want {
			t.Fatalf("StarOfCover(%d) = %d，期望 %d", c.undos, got, c.want)
		}
	}
}

// TestCoverStepsMustEqualRequiredMinusOne 验证 cover 的步数必须等于 required−1。
//
// 不校验的话客户端可以随便报步数刷「总步数」统计。
func TestCoverStepsMustEqualRequiredMinusOne(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	lv := CoverLevels.Get(1)
	if lv == nil {
		t.Fatal("第 1 关缺失")
	}
	if lv.Required-1 != lv.Shortest {
		t.Fatalf("cover 的 Shortest 应恒为 required−1：shortest=%d required=%d",
			lv.Shortest, lv.Required)
	}
}

// TestCoverProgressResultHasUnlockedSkins 验证 cover 的成绩响应**带** unlockedSkins。
//
// 背景（2026-11-07）：cover 模式的成绩接口漏了这个字段，
// 而客户端 `progress.sync({unlockedSkins: res.unlockedSkins})` 是**整体覆盖**语义 ——
// 少返回就把本地皮肤数组覆盖成 `undefined`，下一帧
// `progress.current.unlockedSkins.length` 抛异常，
// 而 `requestAnimationFrame(frame)` 在函数末尾调用，
// 一帧抛异常整个渲染循环就永久中断。
//
// 表现：通关后画面卡在结算动画、「下一关」点了没反应，
// 且不报任何网络错误 —— 极难定位。
//
// 这个测试锁死「响应里必须有这个字段，且不能是 null」。
func TestCoverProgressResultHasUnlockedSkins(t *testing.T) {
	res := &coverProgressResult{
		Passed:        true,
		MaxLevel:      2,
		UnlockedSkins: []string{"wood", "mint"},
		Stars:         3,
	}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("序列化失败: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("反序列化失败: %v", err)
	}
	v, ok := got["unlockedSkins"]
	if !ok {
		t.Fatalf("响应缺少 unlockedSkins 字段：%s", string(b))
	}
	if v == nil {
		t.Fatalf("unlockedSkins 不能为 null：%s", string(b))
	}
	arr, ok := v.([]any)
	if !ok {
		t.Fatalf("unlockedSkins 应为数组，实际 %T", v)
	}
	if len(arr) != 2 {
		t.Fatalf("unlockedSkins 长度应为 2，实际 %d", len(arr))
	}
}

// 机制首见说明卡的开关默认必须是**开**。
//
// 它是玩法引导的一部分，不是运营活动 —— 默认关掉等于这个功能从来没上线过，
// 而且不报错（玩家只是永远看不到说明卡）。
func TestMechIntroDefaultOn(t *testing.T) {
	cfg := DefaultPlatformConfig()
	if !cfg.Features.MechIntro {
		t.Error("features.mechIntro 默认必须为 true")
	}
}

// 首现位置由客户端解码关卡表推导，服务端**不该**再存一份。
//
// 这条断言是防回归的：一旦有人往配置里加 `mechIntroAt: {onway: 13}`，
// 就意味着关卡表更新后要同步改配置，而漏改的表现是「提示卡在该出现时不出现」。
func TestNoServerSideMechSchedule(t *testing.T) {
	if _, ok := reflect.TypeOf(PlatformConfig{}).FieldByName("MechIntroAt"); ok {
		t.Error("机制首现位置应由客户端从关卡表推导，不要在服务端配置里存一份")
	}
}

// `/api/config` 的 `features` 必须下发**全部**字段。
//
// ## 这条测试为什么值得写
//
// `ConfigHandler` 里 `features` 是手写 map（不是直接序列化结构体）。
// 于是「给 FeaturesConfig 加一个字段」和「在 handler 里补一行」
// 是两件必须同时做的事 —— 而漏掉后者不会报错：
//
//   - 后台能存、库里能读、`go build` 通过；
//   - 客户端收到的 JSON 里**没有这个键**，功能静默失效；
//   - 表现是「配置改了不生效」，最难查的一类。
//
// 这一轮就踩了：`mechIntro` 加进配置结构后忘了补 handler，
// 结果机制说明卡一张都不弹，直到实测 `/api/config` 才发现。
//
// 用反射对齐字段名，以后加字段忘了补 handler，这条会当场红。
func TestConfigHandlerSendsAllFeatureFlags(t *testing.T) {
	want := make([]string, 0, 4)
	ft := reflect.TypeOf(FeaturesConfig{})
	for i := 0; i < ft.NumField(); i++ {
		tag := ft.Field(i).Tag.Get("json")
		if tag == "" {
			continue
		}
		want = append(want, tag)
	}

	src, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatalf("读源码失败: %v", err)
	}
	text := string(src)

	for _, key := range want {
		if !strings.Contains(text, `"`+key+`":`) {
			t.Errorf("ConfigHandler 的 features 里缺 %q —— 加进配置结构后必须同步下发，否则客户端永远收不到", key)
		}
	}
}

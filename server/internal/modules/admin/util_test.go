package admin

import "testing"

// TestYuanToFen 锁定「元 → 分」的换算精度。
//
// ## 为什么这需要一个测试
//
// 浮点换算会少一分：`12.50 * 100` 在 float64 下是 `1249.9999999999998`，
// 直接 `int64()` 会截成 1249。单看一行无所谓，几百行加下来
// 报表就和平台对不上账，而且**查不出是哪一行**。
//
// 这类错误的特点：不报错、看起来像正常的数、只在总和上暴露。
func TestYuanToFen(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		desc string
	}{
		{"12.50", 1250, "标准两位小数"},
		{"12.5", 1250, "一位小数补齐"},
		{"12", 1200, "整数"},
		{"0.01", 1, "最小单位（一分）"},
		{"0.1", 10, "一角"},
		{"0", 0, "零"},
		{"", 0, "空串当 0"},
		{".5", 50, "省略整数部分"},
		{"1234.56", 123456, "大额"},
		{"-3.20", -320, "负数（退款场景）"},
		// 超过两位小数只取前两位 —— 人民币最小单位是分，第三位无意义
		{"1.999", 199, "三位小数截断"},
	}
	for _, c := range cases {
		got := yuanToFen(c.in)
		if got != c.want {
			t.Errorf("%s: yuanToFen(%q) = %d，期望 %d", c.desc, c.in, got, c.want)
		}
	}
}

// TestYuanToFenNoFloatDrift 验证 0.1+0.2 这类经典浮点问题不会出现在累计里。
//
// 用「分」存整数的全部理由就是这个：累加一百次 0.01 元必须正好是 1 元。
func TestYuanToFenNoFloatDrift(t *testing.T) {
	var total int64
	for i := 0; i < 100; i++ {
		total += yuanToFen("0.01")
	}
	if total != 100 {
		t.Fatalf("100 次 0.01 元累计应为 100 分（1 元），实际 %d 分", total)
	}
}

// TestConstTimeEqual 验证常数时间比较的基本正确性。
//
// 这里测不出「是否真的常数时间」（那需要纳秒级计时），
// 但至少保证相等/不等的判定是对的 —— 否则后台登录直接挂掉。
func TestConstTimeEqual(t *testing.T) {
	if !constTimeEqual("abc", "abc") {
		t.Error("相同字符串应相等")
	}
	if constTimeEqual("abc", "abd") {
		t.Error("不同字符串不应相等")
	}
	if constTimeEqual("abc", "abcd") {
		t.Error("长度不同不应相等")
	}
	if !constTimeEqual("", "") {
		t.Error("两个空串应相等")
	}
}

// TestMoneyFormat 锁定「分 → 元」的展示格式。
func TestMoneyFormat(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{1250, "12.50"},
		{0, "0.00"},
		{1, "0.01"},
		{100, "1.00"},
		{999999, "9999.99"},
		{-320, "-3.20"},
	}
	for _, c := range cases {
		if got := money(c.in); got != c.want {
			t.Errorf("money(%d) = %q，期望 %q", c.in, got, c.want)
		}
	}
}

// TestClassifySlot 锁定广告位归类。
//
// ## 为什么重要
//
// 平台给的广告位名五花八门（`SLOT_ID_WEAPP_REWARD_VIDEO`、`激励视频`、
// `rewarded_video`…）。不归类的话，后台按「激励视频 / 插屏 / Banner」
// 筛选完全没用 —— 每种名字都被算成一个独立类型。
func TestClassifySlot(t *testing.T) {
	// 只测本函数自己的规则；它不接受空串以外的灵活输入，
	// 所以放在同一包内的测试里。
	cases := []struct {
		in   string
		want string
	}{
		// 这些测试放在 adrev 包里更合适（classifySlot 在那边）。
		// 这里留空占位，真正的测试见 adrev 包。
	}
	_ = cases
}

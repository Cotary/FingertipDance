package profile

import (
	"testing"
)

// TestPlatformOf 锁定平台名 → 数值的映射。
//
// ## 为什么这需要测试
//
// 这个映射直接决定写进 `users.platform` 的值，而那个值会被
// 后台的每一个统计口径分组。映射错了，数据不会报错，
// 只会安静地把抖音用户记成微信用户 —— 等发现时几个月的数据都脏了。
func TestPlatformOf(t *testing.T) {
	cases := []struct {
		in       string
		wantCode int
		wantWx   bool
		desc     string
	}{
		{"wechat", PlatformWechat, true, "微信"},
		{"douyin", PlatformDouyin, false, "抖音"},
		{"web", PlatformWeb, false, "Web"},
		// 老客户端不带 platform —— 必须是微信，且走微信的 code2session。
		// 若当成 Web，存量用户会被记成 Web，且 code 换 openid 直接失效（登录失败）。
		{"", PlatformWechat, true, "老客户端（空）默认微信"},
		// 认不出的平台名当 Web，不报错 —— 登录不该因为统计字段拼错而失败
		{"tiktok", PlatformWeb, false, "未知平台降到 Web"},
	}
	for _, c := range cases {
		code, wx := platformOf(c.in)
		if code != c.wantCode {
			t.Errorf("%s: platformOf(%q) 平台码 = %d，期望 %d", c.desc, c.in, code, c.wantCode)
		}
		if wx != c.wantWx {
			t.Errorf("%s: platformOf(%q) isWechat = %v，期望 %v", c.desc, c.in, wx, c.wantWx)
		}
	}
}

// TestPlatformConstants 锁定平台编号不能撞车。
//
// 撞车（比如两个平台都是 1）会让两端的用户混在同一个分组里，
// 而且不会有任何报错。
func TestPlatformConstants(t *testing.T) {
	seen := map[int]string{}
	for name, v := range map[string]int{
		"unknown": PlatformUnknown,
		"wechat":  PlatformWechat,
		"douyin":  PlatformDouyin,
		"web":     PlatformWeb,
	} {
		if prev, ok := seen[v]; ok {
			t.Fatalf("平台码 %d 被 %s 与 %s 共用", v, prev, name)
		}
		seen[v] = name
	}
	// 0 必须留给「未知」：它是 `users.platform` 的默认值，
	// 一旦被某个真实平台占用，所有老数据都会被误判成那个平台。
	if PlatformUnknown != 0 {
		t.Fatalf("PlatformUnknown 必须是 0（表默认值），实际 %d", PlatformUnknown)
	}
}

// TestPlatformConstantsMatchMigration 锁定代码里的平台码与迁移文件和文档一致。
//
// 迁移里的注释写「0=未知 1=微信 2=抖音 3=Web」。
// 代码改了却忘了改注释（或者反过来），后来的人会照着注释写查询条件。
func TestPlatformConstantsMatchMigration(t *testing.T) {
	if PlatformWechat != 1 {
		t.Errorf("微信平台码应为 1，实际 %d", PlatformWechat)
	}
	if PlatformDouyin != 2 {
		t.Errorf("抖音平台码应为 2，实际 %d", PlatformDouyin)
	}
	if PlatformWeb != 3 {
		t.Errorf("Web 平台码应为 3，实际 %d", PlatformWeb)
	}
}

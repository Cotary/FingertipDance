package admin

import "testing"

// 后台图片必须按魔数判类型。
//
// ## 为什么不能一律回 image/jpeg
//
// 微信压缩图是 jpeg，安卓相机可能是 jpeg，截图工具常常是 png，
// 部分机型给 webp。一律回 jpeg 的话 png / webp 在浏览器里变成裂图，
// **而且不报错** —— 运营只会说"这张图打不开"，看不出是类型判错了。
func TestSniffImageMime(t *testing.T) {
	webp := append([]byte("RIFF"), append([]byte{0, 0, 0, 0}, []byte("WEBPVP8 ")...)...)
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"png", []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, "image/png"},
		{"jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0}, "image/jpeg"},
		{"webp", webp, "image/webp"},
		{"gif", []byte("GIF89a"), "image/gif"},
		{"unknown", []byte{0x00, 0x01, 0x02}, "application/octet-stream"},
		{"too short", []byte{0xFF}, "application/octet-stream"},
	}
	for _, c := range cases {
		if got := sniffImageMime(c.data); got != c.want {
			t.Errorf("%s: 期望 %s，实际 %s", c.name, c.want, got)
		}
	}
}

// 非法状态不能被写进库（列表筛选按这三档走，写进别的值就永远筛不出来）。
func TestSetFeedbackStatusRejectsUnknown(t *testing.T) {
	err := SetFeedbackStatus(nil, 1, "whatever")
	if err == nil {
		t.Error("非法状态必须报错，不能静默写入")
	}
}

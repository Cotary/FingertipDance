package profile

import (
	"testing"

	"github.com/tupss/f-game/server/internal/platform/wechat"
)

func TestHashOpenID(t *testing.T) {
	a := wechat.HashOpenID("openid_abc")
	b := wechat.HashOpenID("openid_abc")
	c := wechat.HashOpenID("openid_abd")
	if a != b {
		t.Fatal("相同 openid 的哈希应相同")
	}
	if a == c {
		t.Fatal("不同 openid 的哈希应不同")
	}
	// sha256 十六进制串，固定 64 字符
	if len(a) != 64 {
		t.Fatalf("哈希长度应为 64，实际 %d", len(a))
	}
}

func TestEncryptOpenID(t *testing.T) {
	enc, err := wechat.EncryptOpenID("openid_abc", "wxapp", "secret")
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}
	if enc == "openid_abc" {
		t.Fatal("加密结果不应等于明文")
	}
	// 同样输入应产出不同密文（随机 nonce）
	enc2, _ := wechat.EncryptOpenID("openid_abc", "wxapp", "secret")
	if enc == enc2 {
		t.Fatal("两次加密结果不应相同（GCM nonce 应随机）")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	const openID = "mock_openid_test123"
	enc, err := wechat.EncryptOpenID(openID, "wxapp", "secret")
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}
	dec, err := wechat.DecryptOpenID(enc, "wxapp", "secret")
	if err != nil {
		t.Fatalf("解密失败: %v", err)
	}
	if dec != openID {
		t.Fatalf("往返解密不一致：期望 %q，实际 %q", openID, dec)
	}
}

func TestCode2SessionMock(t *testing.T) {
	openID, err := wechat.Code2Session("test123", "wxapp", "secret", true)
	if err != nil {
		t.Fatalf("mock code2session 失败: %v", err)
	}
	if openID != "mock_openid_test123" {
		t.Fatalf("mock openid 应为 mock_openid_test123，实际 %q", openID)
	}
}

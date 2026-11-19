package wechat

import (
	"github.com/tupss/f-game/server/internal/platform/identity"
)

// 这一组函数保留为**转发**，让老调用点不用改。
//
// 实现在 `internal/platform/identity` —— 因为抖音也要用同一套
// （哈希做唯一索引、加密存 openid），让 douyin 包反过来 import
// wechat 包是语义错误的。

// EncryptOpenID 用 AES-GCM 加密 openid，密钥由 appid+secret 派生。
func EncryptOpenID(openID, appID, secret string) (string, error) {
	return identity.Encrypt(openID, appID, secret)
}

// DecryptOpenID 解密 openid（用于需要还原 openid 的场景）。
func DecryptOpenID(enc, appID, secret string) (string, error) {
	return identity.Decrypt(enc, appID, secret)
}

// HashOpenID 计算 openid 的 sha256 十六进制串，用于唯一索引。
// 规格 03 §3/§7：openid_hash = sha256(openid)，CHAR(64)。
func HashOpenID(openID string) string {
	return identity.Hash(openID)
}

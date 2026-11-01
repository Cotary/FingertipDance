package wechat

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
)

// EncryptOpenID 用 AES-GCM 加密 openid，密钥由 appid+secret 派生。
func EncryptOpenID(openID, appID, secret string) (string, error) {
	key := deriveKey(appID, secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 密码块: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("生成随机数: %w", err)
	}
	sealed := gcm.Seal(nonce, nonce, []byte(openID), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptOpenID 解密 openid（用于需要还原 openid 的场景）。
func DecryptOpenID(enc, appID, secret string) (string, error) {
	key := deriveKey(appID, secret)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("创建 AES 密码块: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM: %w", err)
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", fmt.Errorf("解码密文: %w", err)
	}
	if len(raw) < gcm.NonceSize() {
		return "", fmt.Errorf("密文长度不足")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败: %w", err)
	}
	return string(plain), nil
}

// HashOpenID 计算 openid 的 sha256 十六进制串，用于唯一索引。
// 规格 03 §3/§7：openid_hash = sha256(openid)，CHAR(64)。
func HashOpenID(openID string) string {
	sum := sha256.Sum256([]byte(openID))
	return hex.EncodeToString(sum[:])
}

// deriveKey 从 appid 与 secret 派生 32 字节密钥。
func deriveKey(appID, secret string) []byte {
	sum := sha256.Sum256([]byte(appID + secret))
	return sum[:]
}

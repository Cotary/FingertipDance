// Package identity 提供与平台无关的 openid 处理：哈希与加解密。
//
// ## 为什么从 wechat 包里抽出来
//
// 接抖音之前，`HashOpenID` / `EncryptOpenID` 住在 `platform/wechat` 里 ——
// 因为那时只有微信一个平台。现在抖音也要用同一套：
//
//   - 哈希用来做**唯一索引**（`users.openid_hash`），两个平台必须
//     用同一种算法，否则「同一个 id 在两端算出的 hash 不同」会让
//     统计数据无法横向比较（虽然实际 id 本来就不同，但规则要统一）。
//   - 加密用来存 `users.openid`，同样要一套。
//
// 如果让 douyin 包去 import wechat 包取这两个函数，语义是错的
// （抖音不依赖微信），而且将来加第三个平台会越来越别扭。
package identity

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

// Hash 计算 openid 的 sha256 十六进制串，用于唯一索引。
//
// 为什么是 sha256 而不是直接存明文：`openid_hash` 上有 UNIQUE 约束，
// 数据库不会给裸 id 建索引时做任何保护，一旦库被拖走，
// 明文 id 可以直接拿去关联其它数据。哈希之后至少多一层。
//
// 注意：这**不是**密码学意义上的安全存储（openid 熵不高、可能被彩虹表），
// 真正敏感的东西（session_key）从来不入库。
func Hash(openID string) string {
	sum := sha256.Sum256([]byte(openID))
	return hex.EncodeToString(sum[:])
}

// Encrypt 用 AES-GCM 加密 openid，密钥由 appid+secret 派生。
//
// 每个平台用**自己的** appid/secret 派生密钥：同一个 openid 字符串
// 在微信和抖音下算出的密文不同，互不干扰。
func Encrypt(openID, appID, secret string) (string, error) {
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

// Decrypt 解密 openid（用于需要还原 openid 的场景，如调用平台接口）。
func Decrypt(enc, appID, secret string) (string, error) {
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

// deriveKey 从 appid 与 secret 派生 32 字节密钥。
func deriveKey(appID, secret string) []byte {
	sum := sha256.Sum256([]byte(appID + secret))
	return sum[:]
}

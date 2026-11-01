package core

import (
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenIssuer 负责签发与校验 JWT。
type TokenIssuer struct {
	secret []byte
	ttl    time.Duration
}

// NewTokenIssuer 创建签发器。
func NewTokenIssuer(secret string, ttlHours int) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret), ttl: time.Duration(ttlHours) * time.Hour}
}

// Issue 为指定用户签发令牌。
func (t *TokenIssuer) Issue(uid int64) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(uid, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(t.ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}

// Parse 解析令牌并返回其中的用户 ID。
func (t *TokenIssuer) Parse(tokenStr string) (int64, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", tok.Header["alg"])
		}
		return t.secret, nil
	})
	if err != nil {
		return 0, fmt.Errorf("解析令牌: %w", err)
	}
	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok || !token.Valid {
		return 0, fmt.Errorf("令牌无效")
	}
	uid, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("令牌主体不是合法用户 ID: %w", err)
	}
	return uid, nil
}

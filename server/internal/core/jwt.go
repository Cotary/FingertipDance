package core

import (
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 令牌作用域。
//
// ## 为什么必须有
//
// 后台能看到**全部玩家的全部数据**。如果后台令牌与玩家令牌同一种，
// 那么任何一个玩家 token 泄露（截图、日志、中间人、被人 reverse 出客户端）
// 就直接等于后台沦陷。
//
// 加上 scope 之后：
//   - 玩家 token 拿到 `/api/admin/*` 一律 401（哪怕签名是合法的）
//   - 后台 token 也**不能**当玩家 token 用（它没有 uid，`sub` 是管理员名）
//
// 这是「最小权限」在单服务里的最小实现，够用了。
const (
	// ScopePlayer 玩家令牌（sub = uid）
	ScopePlayer = "player"
	// ScopeAdmin 后台令牌（sub = 管理员用户名）
	ScopeAdmin = "admin"
)

// Claims 是自定义声明。
//
// 内嵌 `RegisteredClaims` 保留标准字段（sub/exp/iat），
// 加一个 `scope` 区分令牌用途。
type Claims struct {
	Scope string `json:"scope,omitempty"`
	jwt.RegisteredClaims
}

// TokenIssuer 负责签发与校验 JWT。
type TokenIssuer struct {
	secret []byte
	ttl    time.Duration
}

// NewTokenIssuer 创建签发器。
func NewTokenIssuer(secret string, ttlHours int) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret), ttl: time.Duration(ttlHours) * time.Hour}
}

// Issue 为指定用户签发**玩家**令牌。
func (t *TokenIssuer) Issue(uid int64) (string, error) {
	return t.issue(strconv.FormatInt(uid, 10), ScopePlayer, t.ttl)
}

// IssueAdmin 签发**后台**令牌。
//
// 有效期刻意短（12 小时）：管理员不是天天开着后台，
// 短窗口能显著缩小令牌泄露后的可用时间。
func (t *TokenIssuer) IssueAdmin(username string) (string, error) {
	return t.issue(username, ScopeAdmin, 12*time.Hour)
}

// issue 是两种令牌的共同签发逻辑。
func (t *TokenIssuer) issue(subject, scope string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		Scope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}

// Parse 解析令牌并返回其中的用户 ID。
//
// ## 必须校验 scope
//
// 不校验的话，后台令牌（sub 是管理员名字）会被当成 uid 解析 ——
// `strconv.ParseInt` 失败只是个偶然的运气；换成数字用户名就直接串号了。
// 更重要的是：后台令牌能调所有玩家接口，等于提权。
func (t *TokenIssuer) Parse(tokenStr string) (int64, error) {
	claims, err := t.parse(tokenStr)
	if err != nil {
		return 0, err
	}
	if claims.Scope != ScopePlayer {
		return 0, fmt.Errorf("令牌作用域不正确（期望 player，实际 %q）", claims.Scope)
	}
	uid, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("令牌主体不是合法用户 ID: %w", err)
	}
	return uid, nil
}

// ParseAdmin 解析后台令牌，返回管理员用户名。
//
// 与 `Parse` 严格对称：scope 必须是 admin，
// 玩家令牌在这里一律被拒。
func (t *TokenIssuer) ParseAdmin(tokenStr string) (string, error) {
	claims, err := t.parse(tokenStr)
	if err != nil {
		return "", err
	}
	if claims.Scope != ScopeAdmin {
		return "", fmt.Errorf("令牌作用域不正确（期望 admin，实际 %q）", claims.Scope)
	}
	return claims.Subject, nil
}

// parse 是两种令牌的共同解析逻辑（只验签与过期，不判 scope）。
func (t *TokenIssuer) parse(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", tok.Header["alg"])
		}
		return t.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("解析令牌: %w", err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("令牌无效")
	}
	return claims, nil
}

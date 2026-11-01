# T10 — Go: 登录 + Profile

**目标**：实现 `POST /api/login`（微信 code2session）、用户表读写、JWT 签发。

**前置依赖**：T08。

---

## 步骤

### 10.1 写 `internal/platform/wechat/code2session.go`

```go
package wechat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Session 是 code2session 的响应。
type Session struct {
	OpenID     string `json:"openid"`
	UnionID    string `json:"unionid"`
	SessionKey string `json:"session_key"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

// Code2Session 用登录 code 换取 openid。
// mock 为真时不请求微信服务器，直接返回可复现的假 openid。
func Code2Session(code, appID, secret string, mock bool) (string, error) {
	if mock {
		return "mock_openid_" + code, nil
	}
	if code == "" {
		return "", fmt.Errorf("code 为空")
	}
	u := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		url.QueryEscape(appID), url.QueryEscape(secret), url.QueryEscape(code),
	)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		return "", fmt.Errorf("请求微信服务器: %w", err)
	}
	defer resp.Body.Close()

	var s Session
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return "", fmt.Errorf("解析微信响应: %w", err)
	}
	if s.ErrCode != 0 {
		return "", fmt.Errorf("微信返回错误 %d: %s", s.ErrCode, s.ErrMsg)
	}
	if s.OpenID == "" {
		return "", fmt.Errorf("微信响应中没有 openid")
	}
	return s.OpenID, nil
}
```

### 10.2 写 `internal/platform/wechat/openid.go`（openid 加密存储）

```go
package wechat

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
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

// HashOpenID 计算 openid 的 sha256，用于唯一索引。
func HashOpenID(openID string) string {
	sum := sha256.Sum256([]byte(openID))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// deriveKey 从 appid 与 secret 派生 32 字节密钥。
func deriveKey(appID, secret string) []byte {
	sum := sha256.Sum256([]byte(appID + secret))
	return sum[:]
}
```

### 10.3 写 `internal/modules/profile/profile.go`

```go
package profile

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/platform/wechat"
)

// 登录请求。
type loginReq struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

// 用户记录。
type User struct {
	ID            int64
	OpenIDEnc    string
	OpenIDHash   string
	Nickname     string
	Avatar       string
	MaxLevel     int
	TotalTimeMs  int64
	TotalSteps   int
	UnlockedSkins []string
	AdWatchCnt   int
}

// LoginHandler 处理登录：code 换 openid → 查找或创建用户 → 签发令牌。
func LoginHandler(cfg *core.Config, issuer *core.TokenIssuer, db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req loginReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		if req.Code == "" {
			core.Fail(c, core.CodeBadRequest, "code 不能为空")
			return
		}

		openID, err := wechat.Code2Session(req.Code, cfg.Wechat.AppID, cfg.Wechat.Secret, cfg.Wechat.Mock)
		if err != nil {
			core.Fail(c, core.CodeUnauthorized, "登录失败: "+err.Error())
			return
		}

		hash := wechat.HashOpenID(openID)
		user, isNew, err := findOrCreate(db, hash, req.Nickname, req.Avatar)
		if err != nil {
			core.Fail(c, core.CodeInternal, "用户处理失败: "+err.Error())
			return
		}

		token, err := issuer.Issue(user.ID)
		if err != nil {
			core.Fail(c, core.CodeInternal, "签发令牌失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"token":          token,
			"uid":            user.ID,
			"nickname":       user.Nickname,
			"avatar":         user.Avatar,
			"maxLevel":       user.MaxLevel,
			"totalTimeMs":    user.TotalTimeMs,
			"totalSteps":     user.TotalSteps,
			"unlockedSkins":  user.UnlockedSkins,
			"adWatchCnt":     user.AdWatchCnt,
			"isNew":          isNew,
		})
	}
}

// findOrCreate 按 openid 哈希查找用户，不存在则创建。
func findOrCreate(db *core.DB, hash, nickname, avatar string) (*User, bool, error) {
	u, err := queryByHash(db, hash)
	if err == nil {
		// 更新登录信息
		if nickname != "" || avatar != "" {
			_, _ = db.Exec(
				"UPDATE users SET nickname=?, avatar=?, last_login_at=? WHERE id=?",
				orKeep(nickname, u.Nickname), orKeep(avatar, u.Avatar), time.Now(), u.ID,
			)
			if nickname != "" { u.Nickname = nickname }
			if avatar != "" { u.Avatar = avatar }
		} else {
			_, _ = db.Exec("UPDATE users SET last_login_at=? WHERE id=?", time.Now(), u.ID)
		}
		return u, false, nil
	}
	if err != sql.ErrNoRows {
		return nil, false, fmt.Errorf("查询用户: %w", err)
	}

	// 新用户
	now := time.Now()
	res, err := db.Exec(
		"INSERT INTO users (openid, openid_hash, nickname, avatar, max_level, total_time_ms, total_steps, unlocked_skins, ad_watch_cnt, created_at, last_login_at) VALUES (?,?,?,?,0,0,0,?,0,?,?)",
		"", hash, nickname, avatar, `["wood","mint"]`, now, now,
	)
	if err != nil {
		return nil, false, fmt.Errorf("创建用户: %w", err)
	}
	id, _ := res.LastInsertId()
	return &User{
		ID: id, OpenIDHash: hash, Nickname: nickname, Avatar: avatar,
		UnlockedSkins: []string{"wood", "mint"},
	}, true, nil
}

// queryByHash 按 openid 哈希查询用户。
func queryByHash(db *core.DB, hash string) (*User, error) {
	row := db.QueryRow(
		"SELECT id, openid, openid_hash, nickname, avatar, max_level, total_time_ms, total_steps, unlocked_skins, ad_watch_cnt FROM users WHERE openid_hash=?",
		hash,
	)
	var u User
	var skinsJSON string
	if err := row.Scan(&u.ID, &u.OpenIDEnc, &u.OpenIDHash, &u.Nickname, &u.Avatar,
		&u.MaxLevel, &u.TotalTimeMs, &u.TotalSteps, &skinsJSON, &u.AdWatchCnt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(skinsJSON), &u.UnlockedSkins)
	if u.UnlockedSkins == nil {
		u.UnlockedSkins = []string{}
	}
	return &u, nil
}

// orKeep 保留旧值当新值为空。
func orKeep(newVal, old string) string {
	if newVal != "" {
		return newVal
	}
	return old
}
```

### 10.4 写 Go 侧测试 `internal/modules/profile/profile_test.go`

```go
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
	if len(a) < 40 {
		t.Fatalf("哈希长度异常: %d", len(a))
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
```

### 10.5 手动验证

```powershell
cd I:\work\f-game\server
go run ./cmd/http --config deploy/config.local.yaml
```

```powershell
$resp = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/login" -Method Post -ContentType "application/json" -Body '{"code":"test123","nickname":"测试玩家","avatar":""}'
$resp | ConvertTo-Json -Depth 5
```
**期望**：`code: 0`，返回 `token`、`uid`、`maxLevel: 0`、`unlockedSkins: ["wood","mint"]`。

用同一个 code 再登一次 → `uid` 应相同，`isNew: false`。
换一个 code → `uid` 不同，`isNew: true`。

```powershell
# 验证令牌可用
$headers = @{ Authorization = "Bearer $($resp.data.token)" }
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/leaderboard" -Headers $headers | ConvertTo-Json
```

**数据库检查**：
```sql
SELECT id, openid_hash, nickname, max_level, unlocked_skins FROM users;
```
→ `openid` 列应为空字符串（明文不落库），`openid_hash` 有值。

---

## 验收

```powershell
cd I:\work\f-game\server
go build ./...
go test ./...
```

- 登录接口返回 `code: 0` 与有效令牌
- 重复登录 `uid` 稳定
- `users` 表中 `openid` 列为空或密文

---

## 坑
- **`openid` 列不存明文** → `findOrCreate` 里 INSERT 的是空字符串。若要真存密文，需要把 appid/secret 传进 `findOrCreate` → **改为传入 cfg 并存 `wechat.EncryptOpenID(openID, appid, secret)`**
- `ShouldBindJSON` 对 `{}` 空 body 会报错 → 客户端必须带 `code`
- `unlocked_skins` 是 JSON 列，读出来是字符串 → 必须 `json.Unmarshal`
- gin 的 `c.Error(err)` 用于把非致命错误挂到上下文给日志中间件用 → 埋点失败时用它

---

## 产出物
- `server/internal/platform/wechat/code2session.go` `openid.go`
- `server/internal/modules/profile/profile.go` `profile_test.go`

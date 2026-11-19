package profile

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/platform/douyin"
	"github.com/tupss/f-game/server/internal/platform/identity"
	"github.com/tupss/f-game/server/internal/platform/wechat"
)

// 用户归属平台（与 migrations/008_platform.sql 的约定一致）。
//
// 数值而不是字符串：平台是**闭集**，GROUP BY 出来顺序稳定、
// 索引更小。0 留给「未知」——接抖音之前注册的老用户都是 0。
const (
	PlatformUnknown = 0
	PlatformWechat  = 1
	PlatformDouyin  = 2
	PlatformWeb     = 3
)

// loginReq 登录请求。
type loginReq struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
	// Platform 客户端所在平台：`wechat` / `douyin` / `web`。
	//
	// **不传时按微信处理** —— 老客户端没有这个字段，而它们全是微信端。
	// 这样升级服务端不会让存量用户登录失败。
	Platform string `json:"platform"`
}

// platformOf 把请求里的平台名映射成库里的数值。
//
// 认不出的平台名一律当 Web（未知来源里最无害的一档），
// **不报错** —— 登录是玩家的第一道门，不该因为一个统计字段的拼写
// 把玩家挡在门外。真要纠错，看 `users.platform = 3` 的异常分布即可。
func platformOf(name string) (code int, isWechat bool) {
	switch name {
	case "wechat":
		return PlatformWechat, true
	case "douyin":
		return PlatformDouyin, false
	case "web":
		return PlatformWeb, false
	case "":
		// 老客户端：只有微信端存在「不带 platform」的历史版本
		return PlatformWechat, true
	default:
		return PlatformWeb, false
	}
}

// User 用户记录。
type User struct {
	ID            int64
	OpenIDEnc     string
	OpenIDHash    string
	Nickname      string
	Avatar        string
	MaxLevel      int
	TotalTimeMs   int64
	TotalSteps    int
	UnlockedSkins []string
	AdWatchCnt    int
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

		// ── 按平台选 code2session 与密钥 ──
		//
		// 两平台的接口形状不同（微信 GET + query，抖音 POST + JSON），
		// 密钥也完全不同。混用会得到一个笼统的「登录失败」，
		// 所以这里一次性把「平台 → 实现 + 密钥」绑定好。
		platCode, isWechat := platformOf(req.Platform)
		var openID string
		var appID, secret string
		var err error
		if isWechat {
			appID, secret = cfg.Wechat.AppID, cfg.Wechat.Secret
			openID, err = wechat.Code2Session(req.Code, appID, secret, cfg.Wechat.Mock)
		} else if platCode == PlatformDouyin {
			appID, secret = cfg.Douyin.AppID, cfg.Douyin.Secret
			openID, err = douyin.Code2Session(req.Code, appID, secret, cfg.Douyin.Mock)
		} else {
			// Web 端没有 code2session，code 本身就是身份（本地调试用）
			appID, secret = "web", "web"
			openID = "web_" + req.Code
		}
		if err != nil {
			core.Fail(c, core.CodeUnauthorized, "登录失败: "+err.Error())
			return
		}

		hash := identity.Hash(openID)
		enc, err := identity.Encrypt(openID, appID, secret)
		if err != nil {
			core.Fail(c, core.CodeInternal, "加密 openid 失败: "+err.Error())
			return
		}

		user, isNew, err := findOrCreate(db, hash, enc, req.Nickname, req.Avatar, platCode, openID)
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
			"token":         token,
			"uid":           user.ID,
			"nickname":      user.Nickname,
			"avatar":        user.Avatar,
			"maxLevel":      user.MaxLevel,
			"totalTimeMs":   user.TotalTimeMs,
			"totalSteps":    user.TotalSteps,
			"unlockedSkins": user.UnlockedSkins,
			"adWatchCnt":    user.AdWatchCnt,
			"isNew":         isNew,
		})
	}
}

// ProfileHandler 返回当前用户进度（切后台回前台时刷新用）。
func ProfileHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := core.UIDFromContext(c)
	row := db.QueryRow(
		"SELECT max_level, total_time_ms, total_steps, unlocked_skins FROM users WHERE id=$1",
		uid,
	)
		var maxLevel, totalSteps int
		var totalTimeMs int64
		var skinsJSON string
		if err := row.Scan(&maxLevel, &totalTimeMs, &totalSteps, &skinsJSON); err != nil {
			core.Fail(c, core.CodeInternal, "用户不存在")
			return
		}
		var skins []string
		_ = json.Unmarshal([]byte(skinsJSON), &skins)
		if skins == nil {
			skins = []string{}
		}
		core.OK(c, gin.H{
			"maxLevel":     maxLevel,
			"totalTimeMs":  totalTimeMs,
			"totalSteps":   totalSteps,
			"unlockedSkins": skins,
		})
	}
}

// findOrCreate 按 openid 哈希查找用户，不存在则创建。
// enc 是加密后的 openid（AES-GCM），绝不落明文。
//
// ## platform / plainUID 的写入时机
//
// - **新用户**：注册时写死平台，这一行从此归属该平台。
// - **老用户**（`platform = 0`，接抖音之前建的）：登录时**补写**一次。
//   只在为 0 时补，不覆盖已有值 —— 否则一个微信老用户
//   某次从 Web 调试端登录，平台就被改成 Web，历史统计口径全乱。
func findOrCreate(db *core.DB, hash, enc, nickname, avatar string, platform int, plainUID string) (*User, bool, error) {
	u, err := queryByHash(db, hash)
	if err == nil {
		// 更新登录信息
		if nickname != "" || avatar != "" {
			_, _ = db.Exec(
				"UPDATE users SET nickname=$1, avatar=$2, last_login_at=$3 WHERE id=$4",
				orKeep(nickname, u.Nickname), orKeep(avatar, u.Avatar), time.Now(), u.ID,
			)
			if nickname != "" {
				u.Nickname = nickname
			}
			if avatar != "" {
				u.Avatar = avatar
			}
		} else {
			_, _ = db.Exec("UPDATE users SET last_login_at=$1 WHERE id=$2", time.Now(), u.ID)
		}
		// 老数据补平台归属（只在为 0 时）
		_, _ = db.Exec(
			"UPDATE users SET platform=$1, platform_uid=$2 WHERE id=$3 AND platform=0 AND $1<>0",
			platform, plainUID, u.ID,
		)
		return u, false, nil
	}
	if err != sql.ErrNoRows {
		return nil, false, fmt.Errorf("查询用户: %w", err)
	}

	// 新用户
	now := time.Now()
	var id int64
	err = db.QueryRow(
		"INSERT INTO users (openid, openid_hash, nickname, avatar, max_level, total_time_ms, total_steps, unlocked_skins, ad_watch_cnt, platform, platform_uid, created_at, last_login_at) VALUES ($1,$2,$3,$4,0,0,0,$5,0,$6,$7,$8,$9) RETURNING id",
		enc, hash, nickname, avatar, `["wood","mint"]`, platform, plainUID, now, now,
	).Scan(&id)
	if err != nil {
		return nil, false, fmt.Errorf("创建用户: %w", err)
	}
	return &User{
		ID: id, OpenIDEnc: enc, OpenIDHash: hash, Nickname: nickname, Avatar: avatar,
		UnlockedSkins: []string{"wood", "mint"},
	}, true, nil
}

// queryByHash 按 openid 哈希查询用户。
func queryByHash(db *core.DB, hash string) (*User, error) {
	row := db.QueryRow(
		"SELECT id, openid, openid_hash, nickname, avatar, max_level, total_time_ms, total_steps, unlocked_skins, ad_watch_cnt FROM users WHERE openid_hash=$1",
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

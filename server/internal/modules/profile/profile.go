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

// loginReq 登录请求。
type loginReq struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
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

		openID, err := wechat.Code2Session(req.Code, cfg.Wechat.AppID, cfg.Wechat.Secret, cfg.Wechat.Mock)
		if err != nil {
			core.Fail(c, core.CodeUnauthorized, "登录失败: "+err.Error())
			return
		}

		hash := wechat.HashOpenID(openID)
		enc, err := wechat.EncryptOpenID(openID, cfg.Wechat.AppID, cfg.Wechat.Secret)
		if err != nil {
			core.Fail(c, core.CodeInternal, "加密 openid 失败: "+err.Error())
			return
		}

		user, isNew, err := findOrCreate(db, hash, enc, req.Nickname, req.Avatar)
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
func findOrCreate(db *core.DB, hash, enc, nickname, avatar string) (*User, bool, error) {
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
		return u, false, nil
	}
	if err != sql.ErrNoRows {
		return nil, false, fmt.Errorf("查询用户: %w", err)
	}

	// 新用户
	now := time.Now()
	var id int64
	err = db.QueryRow(
		"INSERT INTO users (openid, openid_hash, nickname, avatar, max_level, total_time_ms, total_steps, unlocked_skins, ad_watch_cnt, created_at, last_login_at) VALUES ($1,$2,$3,$4,0,0,0,$5,0,$6,$7) RETURNING id",
		enc, hash, nickname, avatar, `["wood","mint"]`, now, now,
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

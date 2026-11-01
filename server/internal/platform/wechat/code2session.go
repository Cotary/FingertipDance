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

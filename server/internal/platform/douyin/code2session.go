package douyin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Session 是抖音 code2session 的响应。
//
// 与微信的两点不同：
//   - 抖音返回 `anonymous_openid`（匿名用户），微信没有。
//   - 抖音的成功标志是 `err_no == 0`，不是 `errcode == 0`。
type Session struct {
	OpenID          string `json:"openid"`
	AnonymousOpenID string `json:"anonymous_openid"`
	SessionKey      string `json:"session_key"`
	UnionID         string `json:"unionid"`
	ErrNo           int    `json:"err_no"`
	ErrTips         string `json:"err_tips"`
}

// Code2Session 用登录 code 换取 openid。
//
// mock 为真时不请求抖音服务器，直接返回可复现的假 openid ——
// 本地开发和 CI 都不该依赖外部服务。
func Code2Session(code, appID, secret string, mock bool) (string, error) {
	if mock {
		return "mock_dy_openid_" + code, nil
	}
	if code == "" {
		return "", fmt.Errorf("code 为空")
	}

	// 抖音的 code2session 是 **POST + JSON body**，微信是 GET + query。
	// 用错方法会得到一个笼统的「参数错误」，很难查。
	body, err := json.Marshal(map[string]string{
		"appid":  appID,
		"secret": secret,
		"code":   code,
	})
	if err != nil {
		return "", fmt.Errorf("编码请求体: %w", err)
	}

	u := "https://developer.toutiao.com/api/apps/v2/jscode2session"
	req, err := http.NewRequest(http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("构造请求: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求抖音服务器: %w", err)
	}
	defer resp.Body.Close()

	var s Session
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return "", fmt.Errorf("解析抖音响应: %w", err)
	}
	if s.ErrNo != 0 {
		return "", fmt.Errorf("抖音返回错误 %d: %s", s.ErrNo, s.ErrTips)
	}

	// 优先真 openid；拿不到才退回匿名 id。
	//
	// ## 为什么允许匿名
	//
	// 抖音允许玩家**不授权**就进游戏（anonymous_openid）。
	// 直接拒绝的话，「不授权」的玩家根本玩不了 —— 而他们恰恰是大多数。
	//
	// 匿名 id 的语义与本应用内的 openid 一致（同一个设备同一应用恒定），
	// 所以当作用户主键完全够用；代价是换设备会变成新账号。
	// 这是抖音的产品模型，不是我们的缺陷。
	if s.OpenID != "" {
		return s.OpenID, nil
	}
	if s.AnonymousOpenID != "" {
		return s.AnonymousOpenID, nil
	}
	return "", fmt.Errorf("抖音响应中没有 openid")
}

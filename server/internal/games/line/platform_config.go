package line

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// 平台编号（与 users.platform / ad_revenue.platform / migrations/008 一致）。
//
// 0 是「未知」，只在历史数据里出现；配置表不存 0 ——
// 没有平台归属的请求按微信处理（见 `PlatformCodeOf`）。
const (
	PlatformWechat = 1
	PlatformDouyin = 2
	PlatformWeb    = 3
)

// PlatformConfig 是一个平台的全部运营参数。
//
// ## 为什么这些值在数据库里，而 appid/secret 不在
//
// 这里每一项都是**运营会调**的：换个广告位、把提示改成每天前两次免费、
// 换个分享域名。改完不该等一次发版。
//
// appid / secret 是**凭证**，泄露等于别人能冒充我们调平台接口。
// 它们的轮换要走密钥管理，不是后台表单 —— 所以留在 yaml + 环境变量里。
//
// ## 默认值只有一份
//
// `DefaultPlatformConfig()` 就是「不配置也能跑」的那套值，
// 与改造前服务端硬编码的返回值逐项一致。数据库里只存**差异**，
// 读取时先铺默认值再覆盖（`MergePlatformConfig`）。
type PlatformConfig struct {
	// ShareURLPrefix 分享链接前缀，如 `https://game.example.com/line`。
	//
	// 小游戏端没有 `location`，拼分享链接只能靠这个；
	// Web 端有 location 时优先用本地 origin（本地调试不会发出线上域名）。
	ShareURLPrefix string         `json:"shareUrlPrefix"`
	Ad             AdConfig       `json:"ad"`
	Features       FeaturesConfig `json:"features"`
	Themes         []ThemeConfig  `json:"themes"`
}

// AdConfig 是广告位与频控。
//
// 广告位 ID 两端**不共用**（微信广告后台与抖音广告后台各自创建），
// 混填的表现是「广告加载失败」，而失败在客户端看起来只是「点了没反应」，
// 比报错更难查。所以按平台分行存。
type AdConfig struct {
	RewardedVideoID string `json:"rewardedVideoId"`
	InterstitialID  string `json:"interstitialId"`
	BannerID        string `json:"bannerId"`

	// 以下四项是**频控**：服务端只下发参数，判定在客户端做。
	//
	// 为什么不放服务端：这些都是「省得玩家烦」的节奏控制，
	// 不是防作弊。放服务端意味着每次提示/跳过都要多一次网络往返，
	// 而网络不通时还得决定「算不算数」—— 得不偿失。
	// 真要防刷的是奖励发放，那条链路由服务端成绩表把关。

	// InterstitialIntervalSec 两次插屏的最小间隔（秒）。默认 60。
	InterstitialIntervalSec int `json:"interstitialIntervalSec"`
	// RewardedDailyLimit 激励视频每日次数上限，0 = 不限。
	RewardedDailyLimit int `json:"rewardedDailyLimit"`
	// HintFreeUses 每关**免费**提示次数。
	//
	// 0 = 第一次就要看广告（现行行为）。
	// 语义是「前 N 次免费，第 N+1 次付一次广告费，之后本关免费」——
	// 每关最多只收一次，和改造前 `hintUsed === 0` 的规则对齐。
	// 若按「每次都付」实现，默认值 0 会让所有玩家的每次提示都要看广告，
	// 这是最恶劣的那种「配置没生效，行为却变了」。
	HintFreeUses int `json:"hintFreeUses"`
	// SkipDailyLimit 每日跳关次数上限，0 = 不限。
	SkipDailyLimit int `json:"skipDailyLimit"`
}

// FeaturesConfig 是功能开关。
//
// 关掉不等于删代码：关掉后客户端不画那个按钮、点击也不响应。
// 用途是「这一版先别放这个入口」（比如广告位审核期、活动下线）。
type FeaturesConfig struct {
	Hint           bool `json:"hint"`
	Skip           bool `json:"skip"`
	ShareChallenge bool `json:"shareChallenge"`
}

// ThemeConfig 是主题的**解锁条件**（不是主题本体）。
//
// 主题的贴图/音效/动效仍在客户端包里，服务端只能改「什么时候解锁它」。
// 客户端按 id 匹配：**服务端没下发的 id 保持本地常量**，
// 这样一次配置失误（漏了一个主题）不会把玩家的主题墙清空。
type ThemeConfig struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Unlock string `json:"unlock"` // free | milestone | ad
	Value  int    `json:"value"`  // milestone = 关号；ad / free = 0
}

// DefaultPlatformConfig 返回内置默认配置。
//
// 每一项都对齐**改造前的硬编码行为**，所以「不配置」= 线上线下表现不变：
//   - 广告位 `adunit-mock`（`main.go` 里 ConfigHandler 的老实参）
//   - 功能开关全开（`ConfigHandler` 里原先恒 true）
//   - 插屏间隔 60 秒（`ads.ts` 的 `interstitialInterval = 60_000`）
//   - 首次提示看广告（`rewardRules.ts` 的 `hintUsed === 0`）
//   - 两个主题的解锁条件对齐 `render/themes/*.ts`
func DefaultPlatformConfig() PlatformConfig {
	return PlatformConfig{
		ShareURLPrefix: "",
		Ad: AdConfig{
			RewardedVideoID:         "adunit-mock",
			InterstitialID:          "",
			BannerID:                "",
			InterstitialIntervalSec: 60,
			RewardedDailyLimit:      0,
			HintFreeUses:            0,
			SkipDailyLimit:          0,
		},
		Features: FeaturesConfig{Hint: true, Skip: true, ShareChallenge: true},
		Themes: []ThemeConfig{
			{ID: "mise", Name: "秘色天青", Unlock: "free", Value: 0},
			{ID: "mingsha", Name: "鸣沙丹青", Unlock: "milestone", Value: 60},
		},
	}
}

// PlatformCodeOf 把 query 里的 `?platform=` 解析成平台编号。
//
// ## 为什么由客户端声明，而不是从 token 推断
//
// `/api/config` 是**不鉴权**的公开接口，而且客户端在登录成功之前
// （甚至登录失败时）就要拿到它 —— 那时没有 token，推断不出平台。
//
// ## 为什么不认识的平台就报 400
//
// 这个接口失败会让客户端退回内置默认值（广告位变成 placeholder）。
// 为了让一个写错的参数不至于把线上广告打空，未知值一律按**微信**处理：
// 那是唯一一个已经在跑的平台，老客户端（不带参数）也走的这条路。
func PlatformCodeOf(raw string) int {
	switch strings.TrimSpace(raw) {
	case "1", "wechat", "wx", "weixin":
		return PlatformWechat
	case "2", "douyin", "tt", "bytedance":
		return PlatformDouyin
	case "3", "web", "h5", "browser":
		return PlatformWeb
	default:
		return PlatformWechat
	}
}

// MergePlatformConfig 把库里存的 JSON 覆盖到默认值上。
//
// ## 为什么不是直接 Unmarshal 到空结构体
//
// 库里存的是**差异**（没改过的字段根本不在 JSON 里，老行甚至是 `{}`）。
// 直接反序列化到空结构体会让没写的字段变成零值 ——
// 广告位变成空串、功能开关全变 false，等于一次「静默下线」。
//
// 先铺默认值再覆盖，缺字段就保留默认值；以后新增配置项也不用迁移老行。
func MergePlatformConfig(raw []byte) (PlatformConfig, error) {
	cfg := DefaultPlatformConfig()
	if len(raw) == 0 {
		return cfg, nil
	}
	// `{}` 是预置行的内容：解析成功但什么都没覆盖
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return DefaultPlatformConfig(), fmt.Errorf("解析平台配置: %w", err)
	}
	return cfg.Normalize(), nil
}

// Normalize 修正越界值，返回可直接下发 / 入库的配置。
//
// 后台表单是纯文本，运营会填 `-1`、`999999`、带空格的 URL。
// 这些值如果原样下发，客户端要么除法出错（负数间隔），
// 要么永远不解锁（关号写成 999999）。所以**在写入和读取两端都归一化**：
// 写入保证库里干净，读取兜住历史脏数据。
func (c PlatformConfig) Normalize() PlatformConfig {
	out := c

	out.ShareURLPrefix = strings.TrimSpace(out.ShareURLPrefix)
	// 去掉尾部 `?` / `&`：客户端会自己拼查询串，
	// 留着会拼出 `...?&l=47` 这种半截分隔符。
	out.ShareURLPrefix = strings.TrimRight(out.ShareURLPrefix, "?&")
	if out.ShareURLPrefix != "" &&
		!strings.HasPrefix(out.ShareURLPrefix, "http://") &&
		!strings.HasPrefix(out.ShareURLPrefix, "https://") {
		// 不是 http(s) 的一律丢弃：宁可回落 location / 空串，
		// 也不要发出一个 `game.example.com?l=47` 这种没有协议的链接。
		out.ShareURLPrefix = ""
	}

	out.Ad.RewardedVideoID = strings.TrimSpace(out.Ad.RewardedVideoID)
	out.Ad.InterstitialID = strings.TrimSpace(out.Ad.InterstitialID)
	out.Ad.BannerID = strings.TrimSpace(out.Ad.BannerID)
	out.Ad.InterstitialIntervalSec = clampInt(out.Ad.InterstitialIntervalSec, 0, 3600)
	out.Ad.RewardedDailyLimit = clampInt(out.Ad.RewardedDailyLimit, 0, 1000)
	out.Ad.HintFreeUses = clampInt(out.Ad.HintFreeUses, 0, 20)
	out.Ad.SkipDailyLimit = clampInt(out.Ad.SkipDailyLimit, 0, 1000)

	// 平台不能下发空广告位：空串会让客户端退回 placeholder，
	// 而 placeholder 在正式包里是加载不出来的。广告位留空 = 保留默认。
	if out.Ad.RewardedVideoID == "" {
		out.Ad.RewardedVideoID = DefaultPlatformConfig().Ad.RewardedVideoID
	}

	// 主题：去重 + 丢弃非法项。
	//
	// 重复 id 会让客户端「后一个覆盖前一个」，结果取决于遍历顺序 ——
	// 这种不确定性在配置里不该存在。保留第一条。
	seen := make(map[string]struct{}, len(out.Themes))
	themes := make([]ThemeConfig, 0, len(out.Themes))
	for _, t := range out.Themes {
		t.ID = strings.TrimSpace(t.ID)
		if t.ID == "" {
			continue
		}
		if _, ok := seen[t.ID]; ok {
			continue
		}
		switch t.Unlock {
		case "free", "ad", "milestone":
		default:
			// 未知解锁方式：最保守的兜底是「免费」还是「不解锁」？
			// 选 free —— 主题是内容，不是奖励货币；
			// 一次配置写错不该让已解锁的玩家突然失去主题。
			t.Unlock = "free"
		}
		if t.Unlock != "milestone" {
			t.Value = 0
		} else {
			t.Value = clampInt(t.Value, 0, 100000)
		}
		t.Name = strings.TrimSpace(t.Name)
		if t.Name == "" {
			t.Name = t.ID
		}
		seen[t.ID] = struct{}{}
		themes = append(themes, t)
	}
	out.Themes = themes

	return out
}

// clampInt 把 v 夹到 [lo, hi]。
func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ParseIntForm 解析表单里的整数，非法或为空返回 def。
//
// 后台表单提交的是字符串，运营清空一个输入框时拿到的是 ""（不是 0）——
// 直接 Atoi 会报错并把整张表单保存失败，这里按「没填 = 用默认」处理。
func ParseIntForm(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}

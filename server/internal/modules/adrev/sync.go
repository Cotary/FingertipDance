// Package adrev 把平台侧的广告收益数据同步进本地库。
//
// ## 数据从哪来（这是你在设计文档里问的「广告能拿到数据不」）
//
// **能，但只能在服务端拿，客户端拿不到。**
//
//   - 微信：`GET https://api.weixin.qq.com/publisher/stat?action=publisher_adpos_general`
//     需要 `access_token`（用 appid+secret 换），单次最多查 90 天。
//   - 抖音：`POST https://minigame.zijieapi.com/mgplatform/api/apps/ad/income/query`
//     需要 openapi 的 client token，按 start/end 日期 + 分页查。
//
// 两者都是「平台给你的结算数据」，不是我们埋点能算出来的 ——
// 客户端只知道「看了几次广告」，不知道「这次广告值多少钱」。
//
// ## 三条设计约束
//
// 1. **失败绝不能影响主服务**。全部同步逻辑跑在独立 goroutine 里，
//    出错只写日志 + 记「上次失败原因」，绝不 panic、绝不阻塞任何游戏接口。
// 2. **必须幂等**。同一天重复同步要覆盖而非追加（靠 `ad_revenue` 的
//    UNIQUE 约束 + ON CONFLICT DO UPDATE）。否则同步跑两次收益翻倍。
// 3. **凭证缺失时必须「什么都不做」而不是「报错」**。
//    没配 appid/secret 的环境（本地开发、CI）本就不该有广告数据，
//    让它安静跳过，比让它每次都失败刷日志要好。
package adrev

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/tupss/f-game/server/internal/core"
)

// 平台编号（与 users.platform 一致）。
const (
	PlatformWechat = 1
	PlatformDouyin = 2
)

// Creds 是一套平台凭证。
type Creds struct {
	AppID  string
	Secret string
	// Mock 为真时返回造出来的假数据（本地开发用，不打外部请求）
	Mock bool
}

// Syncer 负责把平台数据同步进库。
type Syncer struct {
	db     *core.DB
	wechat Creds
	douyin Creds
	// httpClient 可替换（测试用）
	httpClient *http.Client
}

// New 创建同步器。
func New(db *core.DB, wechat, douyin Creds) *Syncer {
	return &Syncer{
		db:         db,
		wechat:     wechat,
		douyin:     douyin,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Result 是一次同步的结果，给后台显示用。
type Result struct {
	Platform int    `json:"platform"`
	Skipped  bool   `json:"skipped"`
	Reason   string `json:"reason,omitempty"`
	Rows     int    `json:"rows"`
	Err      string `json:"error,omitempty"`
}

// SyncRange 同步指定日期区间（含首尾）的广告数据。
//
// 两个平台分别同步，**一个失败不影响另一个**。
func (s *Syncer) SyncRange(from, to time.Time) []Result {
	var out []Result

	// 微信：一次最多 90 天，按窗口切
	out = append(out, s.syncWechat(from, to))
	// 抖音：按天/区间拉，分页自己翻
	out = append(out, s.syncDouyin(from, to))
	return out
}

// syncWechat 同步微信广告汇总。
//
// ## 接口说明（2026-11 现状）
//
// `publisher_adpos_general` 返回**按日期 + 广告位类型**聚合的
// 曝光 / 点击 / 收入。字段名官方用的是 `cost`（单位分）。
//
// 单次窗口 90 天，超过会被拒 —— 这里按 90 天切片。
func (s *Syncer) syncWechat(from, to time.Time) Result {
	r := Result{Platform: PlatformWechat}
	if s.wechat.Mock {
		r.Skipped = true
		r.Reason = "mock 模式，跳过微信同步"
		return r
	}
	if s.wechat.AppID == "" || s.wechat.Secret == "" {
		r.Skipped = true
		r.Reason = "未配置微信 appid/secret"
		return r
	}

	tok, err := s.wechatAccessToken()
	if err != nil {
		r.Err = err.Error()
		return r
	}

	// 90 天窗口切片
	cursor := from
	for !cursor.After(to) {
		end := cursor.AddDate(0, 0, 89)
		if end.After(to) {
			end = to
		}
		n, err := s.fetchWechatRange(tok, cursor, end)
		if err != nil {
			r.Err = err.Error()
			return r
		}
		r.Rows += n
		cursor = end.AddDate(0, 0, 1)
	}
	return r
}

// wechatAccessToken 换 access_token。
//
// ## 为什么不缓存
//
// 缓存需要 Redis 或内存状态，而同步是**低频**操作（一天一次，
// 甚至手动触发）。每次换一次 token 的成本（一次 HTTPS 请求）
// 远小于缓存一致性的复杂度。真到了高频场景再优化。
func (s *Syncer) wechatAccessToken() (string, error) {
	u := fmt.Sprintf(
		"https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s",
		url.QueryEscape(s.wechat.AppID), url.QueryEscape(s.wechat.Secret),
	)
	resp, err := s.httpClient.Get(u)
	if err != nil {
		return "", fmt.Errorf("请求 access_token: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("读取响应: %w", err)
	}
	var t struct {
		AccessToken string `json:"access_token"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &t); err != nil {
		return "", fmt.Errorf("解析响应: %w", err)
	}
	if t.AccessToken == "" {
		return "", fmt.Errorf("微信未返回 access_token（errcode=%d %s）", t.ErrCode, t.ErrMsg)
	}
	return t.AccessToken, nil
}

// fetchWechatRange 拉一个 ≤90 天的窗口。
func (s *Syncer) fetchWechatRange(token string, from, to time.Time) (int, error) {
	u := fmt.Sprintf(
		"https://api.weixin.qq.com/publisher/stat?action=publisher_adpos_general&access_token=%s&start_date=%s&end_date=%s",
		url.QueryEscape(token),
		from.Format("2006-01-02"), to.Format("2006-01-02"),
	)
	resp, err := s.httpClient.Get(u)
	if err != nil {
		return 0, fmt.Errorf("请求微信广告数据: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, fmt.Errorf("读取响应: %w", err)
	}

	// 微信的返回结构是 { list: [ { date, ad_slot, exposure_uv, exposure_count, click_count, income } ] }
	// 字段命名各版本略有差异，这里做宽松兼容：收入优先 `income`，退 `cost`。
	var doc struct {
		List []struct {
			Date         string  `json:"date"`
			AdSlot       string  `json:"ad_slot"`
			AdSlotName   string  `json:"ad_slot_name"`
			Exposure     int64   `json:"exposure_count"`
			ExposureUV   int64   `json:"exposure_uv"`
			Click        int64   `json:"click_count"`
			Income       float64 `json:"income"`
			Cost         float64 `json:"cost"`
		} `json:"list"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return 0, fmt.Errorf("解析微信响应: %w", err)
	}
	if doc.ErrCode != 0 {
		return 0, fmt.Errorf("微信返回错误 %d: %s", doc.ErrCode, doc.ErrMsg)
	}

	n := 0
	for _, it := range doc.List {
		day, err := time.Parse("2006-01-02", it.Date)
		if err != nil {
			continue
		}
		// 收入：接口给的是「元」（浮点），转成分存整数
		yuan := it.Income
		if yuan == 0 {
			yuan = it.Cost
		}
		fen := int64(yuan*100 + 0.5)
		slot := it.AdSlot
		if slot == "" {
			slot = it.AdSlotName
		}
		if err := upsertAd(s.db, PlatformWechat, day, classifySlot(slot), slot, it.Exposure, it.Click, fen); err == nil {
			n++
		}
	}
	return n, nil
}

// syncDouyin 同步抖音广告数据。
func (s *Syncer) syncDouyin(from, to time.Time) Result {
	r := Result{Platform: PlatformDouyin}
	if s.douyin.Mock {
		r.Skipped = true
		r.Reason = "mock 模式，跳过抖音同步"
		return r
	}
	if s.douyin.AppID == "" || s.douyin.Secret == "" {
		r.Skipped = true
		r.Reason = "未配置抖音 appid/secret"
		return r
	}

	tok, err := s.douyinClientToken()
	if err != nil {
		r.Err = err.Error()
		return r
	}

	// 抖音按页翻（每页上限 500）。这里保守用 100，翻到空页为止。
	page := 1
	for page <= 100 {
		n, more, err := s.fetchDouyinPage(tok, from, to, page)
		if err != nil {
			r.Err = err.Error()
			return r
		}
		r.Rows += n
		if !more {
			break
		}
		page++
	}
	return r
}

// douyinClientToken 换抖音的 client_token。
func (s *Syncer) douyinClientToken() (string, error) {
	payload, _ := json.Marshal(map[string]string{
		"appid":     s.douyin.AppID,
		"secret":    s.douyin.Secret,
		"grant_type": "client_credential",
	})
	resp, err := s.httpClient.Post(
		"https://developer.toutiao.com/api/apps/v2/token",
		"application/json",
		readerOf(payload),
	)
	if err != nil {
		return "", fmt.Errorf("请求抖音 token: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("读取响应: %w", err)
	}
	var doc struct {
		ErrNo int `json:"err_no"`
		Data  struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return "", fmt.Errorf("解析抖音 token: %w", err)
	}
	if doc.ErrNo != 0 || doc.Data.AccessToken == "" {
		return "", fmt.Errorf("抖音未返回 access_token（err_no=%d）", doc.ErrNo)
	}
	return doc.Data.AccessToken, nil
}

// fetchDouyinPage 拉一页抖音广告数据。
func (s *Syncer) fetchDouyinPage(token string, from, to time.Time, page int) (int, bool, error) {
	payload, _ := json.Marshal(map[string]interface{}{
		"start_date": from.Format("2006-01-02"),
		"end_date":   to.Format("2006-01-02"),
		"page_no":    page,
		"page_size":  100,
	})
	req, err := http.NewRequest(http.MethodPost,
		"https://minigame.zijieapi.com/mgplatform/api/apps/ad/income/query", readerOf(payload))
	if err != nil {
		return 0, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, false, fmt.Errorf("请求抖音广告数据: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, false, fmt.Errorf("读取响应: %w", err)
	}

	var doc struct {
		ErrNo  int    `json:"err_no"`
		ErrMsg string `json:"err_msg"`
		Data   struct {
			List []struct {
				Date        string  `json:"date"`
				AdType      string  `json:"ad_type"`
				Placement   string  `json:"ad_placement_id"`
				Exposure    int64   `json:"exposure_cnt"`
				Click       int64   `json:"click_cnt"`
				Income      float64 `json:"income"`
			} `json:"list"`
			Total int `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return 0, false, fmt.Errorf("解析抖音响应: %w", err)
	}
	if doc.ErrNo != 0 {
		return 0, false, fmt.Errorf("抖音返回错误 %d: %s", doc.ErrNo, doc.ErrMsg)
	}

	n := 0
	for _, it := range doc.Data.List {
		day, err := time.Parse("2006-01-02", it.Date)
		if err != nil {
			continue
		}
		fen := int64(it.Income*100 + 0.5)
		if err := upsertAd(s.db, PlatformDouyin, day, it.AdType, it.Placement, it.Exposure, it.Click, fen); err == nil {
			n++
		}
	}
	// 还有下一页的条件：本页满 100 且累计未达 total
	more := len(doc.Data.List) >= 100 && (doc.Data.Total == 0 || page*100 < doc.Data.Total)
	return n, more, nil
}

// upsertAd 幂等写入一行广告数据。
//
// ## 为什么用 ON CONFLICT DO UPDATE 而不是 INSERT ... ON CONFLICT DO NOTHING
//
// 平台会**修正**历史数据（反作弊、结算补差）。
// DO NOTHING 会让第一次抓到的错数永远留在库里；
// DO UPDATE 则每次都拿最新值覆盖。
//
// 但**手工补录的行不能被自动同步覆盖** —— 所以有 `source='manual'` 时跳过。
func upsertAd(db *core.DB, platform int, day time.Time, adType, placement string, imp, clk, fen int64) error {
	_, err := db.Exec(`
INSERT INTO ad_revenue (platform, day, ad_type, placement, impressions, clicks, revenue_fen, source, fetched_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,'api',$8)
ON CONFLICT (platform, day, ad_type, placement)
DO UPDATE SET impressions=$5, clicks=$6, revenue_fen=$7, source='api', fetched_at=$8
WHERE ad_revenue.source <> 'manual'`,
		platform, day, adType, placement, imp, clk, fen, time.Now())
	return err
}

// classifySlot 把平台给的广告位名归类到统一的三档。
//
// 平台侧的命名五花八门（`SLOT_ID_WEAPP_REWARD_VIDEO`、`激励视频`…），
// 不归一的话后台按类型的筛选完全没用。
func classifySlot(s string) string {
	l := lower(s)
	switch {
	case contains(l, "reward") || contains(l, "激励"):
		return "rewarded"
	case contains(l, "interstitial") || contains(l, "插屏"):
		return "interstitial"
	case contains(l, "banner") || contains(l, "横幅"):
		return "banner"
	default:
		return ""
	}
}

// ── 小工具（避免引入 bytes/strings 的重复样板）──

func readerOf(b []byte) io.Reader { return &byteReader{b: b} }

type byteReader struct {
	b []byte
	i int
}

func (r *byteReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}

func lower(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}

func contains(hay, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	if len(hay) < len(needle) {
		return false
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		if hay[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// 编译期占位，避免 database/sql 未使用。
var _ = sql.ErrNoRows

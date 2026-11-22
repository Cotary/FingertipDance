package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// TestCORSAllowsWhitelistedOrigin 锁定白名单内的来源能拿到 CORS 头。
func TestCORSAllowsWhitelistedOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS("https://game.example.com"))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://game.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	got := w.Header().Get("Access-Control-Allow-Origin")
	if got != "https://game.example.com" {
		t.Errorf("白名单内的 Origin 应被回显，实际 = %q", got)
	}
}

// TestCORSRejectsUnknownOrigin 锁定白名单外的来源拿不到 CORS 头。
//
// ## 为什么重要
//
// 以前是写死的 `Access-Control-Allow-Origin: *` + 允许 `Authorization` 头，
// 意味着**任何网站**都能从用户浏览器里拿 token 调我们的 API。
func TestCORSRejectsUnknownOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS("https://game.example.com"))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("白名单外的 Origin 不应拿到 CORS 头，实际 = %q", got)
	}
}

// TestCORSWildcardForLocalDev 锁定 `*` 仍然可用（本地开发不能被卡住）。
func TestCORSWildcardForLocalDev(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS("*"))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("通配符模式下应返回 *，实际 = %q", got)
	}
}

// TestCORSNoOriginHeader 锁定同源 / 非浏览器请求不被拦。
func TestCORSNoOriginHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS("https://game.example.com"))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("没有 Origin 头的请求应放行，实际状态 = %d", w.Code)
	}
}

// TestCORSEmptyListRejectsAll 锁定「空白名单 = 拒绝所有跨域」。
//
// ## 这是本次修复的核心
//
// 原来的判据是 `allowAll := len(allowed) == 0` —— 空列表 = 放行全部。
// 而生产配置 `config.prod.yaml` 里**常常根本没有 `cors:` 段**
// （那一段只出现在 `config.local.yaml`），于是 `cfg.CORS.AllowedOrigins`
// 是 `nil` → `core.CORS(cfg.CORS.AllowedOrigins...)` 传进来零个参数
// → **生产环境实际下发 `Access-Control-Allow-Origin: *`**，
// 而 `Allow-Headers` 里含 `Authorization`。
//
// 后果就是白名单本来要防的那件事：任何网站都能从玩家浏览器里拿 token
// 调我们的 API。而且它**不会报错** —— 一切看起来都正常。
//
// 现在空列表一律按「拒绝所有跨域」处理。
func TestCORSEmptyListRejectsAll(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS()) // 零个参数 —— 生产配置缺 `cors:` 段时的实际形态
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("空白名单时任何 Origin 都不该拿到 CORS 头，实际 = %q", got)
	}
	if got := w.Header().Get("Access-Control-Allow-Headers"); got != "" {
		t.Errorf("空白名单时不该下发 Allow-Headers，实际 = %q", got)
	}
}

// TestCORSEmptySliceRejectsAll 锁定「显式空数组」与「零参数」行为一致。
//
// 两者在生产里都可能出现：一个是 yaml 里写了 `allowed_origins: []`，
// 一个是根本没写那一段。它们必须给出**同一个**答案。
func TestCORSEmptySliceRejectsAll(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS([]string{}...)) // 显式空数组展开 → 仍是零个参数
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("显式空数组时不该下发 CORS 头，实际 = %q", got)
	}
}

// TestCORSEmptyListStillAllowsNoOrigin 锁定「空白名单」不影响小游戏端。
//
// 小游戏端 `wx.request` / `tt.request` **不带 `Origin` 头**，
// 走的是同源/非浏览器分支。所以生产把白名单留空不影响小游戏。
func TestCORSEmptyListStillAllowsNoOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS())
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("没有 Origin 头的请求应放行，实际状态 = %d", w.Code)
	}
}

// TestCORSProdConfigDoesNotAllowAll 锁定生产配置模板本身是「拒绝所有」。
//
// 这一条是**配置层面的回归测试**：即使中间件写对了，
// 哪天有人在 `config.prod.yaml` 里手滑写了 `["*"]`，这里也会拦下来。
//
// 读的是仓库里的模板文件（不是临时构造的 yaml），
// 因为要防的正是「有人改了这个文件」。
func TestCORSProdConfigDoesNotAllowAll(t *testing.T) {
	path := "../../deploy/config.prod.yaml"
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("加载生产配置失败: %v", err)
	}

	for _, o := range cfg.CORS.AllowedOrigins {
		if o == "*" {
			t.Error("生产配置里出现通配符 `*` —— 任何网站都能拿玩家 token 调我们的 API")
		}
	}
}

// TestCORSPreflight 锁定 OPTIONS 预检返回 204。
func TestCORSPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS("https://game.example.com"))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	req.Header.Set("Origin", "https://game.example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("预检应返回 204，实际 = %d", w.Code)
	}
}

// TestRateLimiterBlocksBurst 锁定限流器能挡住突发刷接口。
func TestRateLimiterBlocksBurst(t *testing.T) {
	rl := NewRateLimiter(1, 5) // 每秒 1 个，突发 5 个

	// 前 5 个应放行
	for i := 0; i < 5; i++ {
		if !rl.Allow("1.2.3.4") {
			t.Fatalf("第 %d 个请求应放行（突发额度内）", i+1)
		}
	}
	// 第 6 个应被拒
	if rl.Allow("1.2.3.4") {
		t.Error("超出突发额度的请求应被拒绝")
	}
}

// TestRateLimiterSeparatesKeys 锁定不同客户端互不影响。
func TestRateLimiterSeparatesKeys(t *testing.T) {
	rl := NewRateLimiter(1, 2)

	rl.Allow("1.1.1.1")
	rl.Allow("1.1.1.1")
	if rl.Allow("1.1.1.1") {
		t.Error("1.1.1.1 的额度用完了，应被拒绝")
	}

	// 另一个客户端应该有独立额度
	if !rl.Allow("2.2.2.2") {
		t.Error("2.2.2.2 应有独立额度")
	}
}

// TestRateLimiterRefills 锁定令牌会随时间补充。
func TestRateLimiterRefills(t *testing.T) {
	rl := NewRateLimiter(10, 1) // 每秒 10 个，桶容量 1

	rl.Allow("x")
	if rl.Allow("x") {
		t.Fatal("桶空了应被拒绝")
	}

	// 等 200ms → 应该补上 2 个令牌
	time.Sleep(200 * time.Millisecond)
	if !rl.Allow("x") {
		t.Error("过了一段时间后应恢复放行")
	}
}

// TestRateLimitMiddlewareReturns429 锁定超限返回 429。
func TestRateLimitMiddlewareReturns429(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rl := NewRateLimiter(0.0001, 1) // 几乎不补充
	r := gin.New()
	r.Use(RateLimitMiddleware(rl))
	r.POST("/report", func(c *gin.Context) { c.String(200, "ok") })

	// 第一个放行
	req := httptest.NewRequest(http.MethodPost, "/report", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("第一个请求应放行，实际 = %d", w.Code)
	}

	// 第二个超限
	req2 := httptest.NewRequest(http.MethodPost, "/report", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != 429 {
		t.Errorf("超限请求应返回 429，实际 = %d", w2.Code)
	}
}

// TestRateLimiterCleanup 锁定长期不用的桶会被清掉（防止 map 无限增长）。
func TestRateLimiterCleanup(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	rl.Allow("a")
	rl.Allow("b")
	if len(rl.buckets) != 2 {
		t.Fatalf("应有 2 个桶，实际 = %d", len(rl.buckets))
	}
	// 把 last 推到很久以前
	rl.mu.Lock()
	for _, b := range rl.buckets {
		b.last = time.Now().Add(-time.Hour)
	}
	rl.mu.Unlock()

	rl.Cleanup(10 * time.Minute)
	if len(rl.buckets) != 0 {
		t.Errorf("过期桶应被清理，实际剩 %d 个", len(rl.buckets))
	}
}

// TestCORSConfigFromYAML 锁定配置能从 YAML 读出白名单。
func TestCORSConfigFromYAML(t *testing.T) {
	y := `
server:
  port: 50001
db:
  dsn: "x"
redis:
  addr: "x"
jwt:
  secret: "x"
wechat:
  appid: "x"
  secret: "x"
cors:
  allowed_origins:
    - "https://a.example.com"
    - "https://b.example.com"
  allow_credentials: true
`
	dir := t.TempDir()
	path := dir + "/cfg.yaml"
	if err := os.WriteFile(path, []byte(y), 0o644); err != nil {
		t.Fatalf("写配置失败: %v", err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	if len(cfg.CORS.AllowedOrigins) != 2 {
		t.Errorf("白名单应有 2 项，实际 = %v", cfg.CORS.AllowedOrigins)
	}
	if !cfg.CORS.AllowCredentials {
		t.Error("allow_credentials 应为 true")
	}
}

// TestCORSConfigFromEnv 锁定环境变量能覆盖白名单。
func TestCORSConfigFromEnv(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://x.com, https://y.com ,")
	cfg := &Config{}
	cfg.overrideFromEnv()
	if len(cfg.CORS.AllowedOrigins) != 2 {
		t.Errorf("环境变量应解析出 2 项，实际 = %v", cfg.CORS.AllowedOrigins)
	}
	if cfg.CORS.AllowedOrigins[0] != "https://x.com" {
		t.Errorf("第 1 项 = %q", cfg.CORS.AllowedOrigins[0])
	}
}

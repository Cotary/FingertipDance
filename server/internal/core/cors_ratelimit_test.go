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

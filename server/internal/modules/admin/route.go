package admin

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/modules/adrev"
)

// 后台 cookie 名。
//
// 页面走 cookie（浏览器刷新要保持登录），API 走 Bearer（便于脚本/curl）。
// 两者**是同一个令牌**，只是用不同方式携带。
const (
	cookieName = "admin_token"
	cookieTTL  = 12 * 60 * 60 // 与 IssueAdmin 的有效期一致
)

// Register 挂载后台的全部路由。
//
// ## 路由分两类
//
//   - **页面**（`/admin/*`）：走 cookie，未登录跳登录页
//   - **API**（`/api/admin/*`）：走 Bearer，未授权返回 JSON 401
//
// 页面不用 Bearer 是因为浏览器地址栏没法带 Authorization 头；
// API 不用 cookie 是为了让脚本能直接 curl（也避免 CSRF 面扩大）。
func Register(r *gin.Engine, cfg *core.Config, issuer *core.TokenIssuer, db *core.DB, syncer *adrev.Syncer) {
	if !cfg.Admin.Enabled {
		// 后台关闭时**不注册任何路由** —— 连 404 都不给，
		// 免得被人从响应差异上判断出「这里本来有个后台」。
		return
	}

	// ── 登录（不鉴权）──
	r.GET("/admin/login", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(LoginPage("")))
	})
	r.POST("/admin/login", func(c *gin.Context) {
		user := c.PostForm("user")
		pass := c.PostForm("password")
		token, err := issueIfMatch(cfg, issuer, user, pass)
		if err != nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(LoginPage("账号或密码错误")))
			return
		}
		// HttpOnly：JS 读不到，降低 XSS 窃取风险
		// SameSite=Lax：阻止跨站 POST 携带（CSRF 的主要路径）
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(cookieName, token, cookieTTL, "/admin", "", false, true)
		c.Redirect(http.StatusFound, "/admin")
	})
	r.GET("/admin/logout", func(c *gin.Context) {
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(cookieName, "", -1, "/admin", "", false, true)
		c.Redirect(http.StatusFound, "/admin/login")
	})

	// JSON 登录（给脚本用）
	r.POST("/api/admin/login", LoginHandler(cfg, issuer))

	// ── 页面（cookie 鉴权）──
	page := r.Group("/admin")
	page.Use(pageAuth(issuer))
	{
		// 总览。同时注册 `/admin` 与 `/admin/`：
		// gin 默认会把 `/admin/` 301 到 `/admin`（RedirectTrailingSlash），
		// 但我们挂了 `pageAuth` 中间件 —— 重定向发生在中间件之后就容易
		// 变成「登录了还是被踢回登录页」的诡异循环。两个都注册最稳。
		overview := func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(OverviewPage(cfg, db, core.AdminFromContext(c))))
		}
		page.GET("", overview)
		page.GET("/", overview)
		page.GET("/platform", func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(PlatformPage(db, core.AdminFromContext(c))))
		})
		page.GET("/players", func(c *gin.Context) {
			f := playerFilterFromQuery(c)
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(PlayersPage(db, core.AdminFromContext(c), f)))
		})
		page.GET("/players/:id", func(c *gin.Context) {
			uid, err := strconv.ParseInt(c.Param("id"), 10, 64)
			if err != nil || uid <= 0 {
				c.String(http.StatusBadRequest, "玩家 ID 非法")
				return
			}
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(PlayerDetailPage(db, core.AdminFromContext(c), uid)))
		})
		page.GET("/levels", func(c *gin.Context) {
			limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(LevelsPage(db, core.AdminFromContext(c), limit)))
		})
		page.GET("/ads", func(c *gin.Context) {
			days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
			c.Data(http.StatusOK, "text/html; charset=utf-8",
				[]byte(AdsPage(db, core.AdminFromContext(c), days)))
		})
		// 页面表单提交（手工补录 / 触发同步）
		page.POST("/ads/manual", func(c *gin.Context) {
			handleManualForm(c, db)
			c.Redirect(http.StatusFound, "/admin/ads")
		})
		page.POST("/ads/sync", func(c *gin.Context) {
			triggerSync(c, syncer)
			c.Redirect(http.StatusFound, "/admin/ads")
		})
	}

	// ── API（Bearer 鉴权）──
	api := r.Group("/api/admin")
	api.Use(core.AdminAuthMiddleware(issuer))
	{
		api.GET("/stats/overview", OverviewHandler(db))
		api.GET("/stats/platform", PlatformsHandler(db))
		api.GET("/players", PlayersHandler(db))
		api.GET("/players/:id", PlayerDetailHandler(db))
		api.GET("/levels", LevelsHandler(db))
		api.GET("/ads", AdsHandler(db))
		api.POST("/ads/manual", ManualAdHandler(db))
		api.POST("/ads/sync", func(c *gin.Context) {
			days := 30
			if v := c.Query("days"); v != "" {
				if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 365 {
					days = n
				}
			}
			to := time.Now().AddDate(0, 0, -1) // 平台数据通常 T+1
			from := to.AddDate(0, 0, -(days - 1))
			core.OK(c, gin.H{"results": syncer.SyncRange(from, to)})
		})
	}
}

// issueIfMatch 校验账号密码并签发 admin 令牌。
//
// 与 `LoginHandler` 里的比较逻辑相同，抽出来给表单登录用。
func issueIfMatch(cfg *core.Config, issuer *core.TokenIssuer, user, pass string) (string, error) {
	if !constTimeEqual(user, cfg.Admin.User) || !constTimeEqual(pass, cfg.Admin.Password) {
		return "", errBadCreds
	}
	return issuer.IssueAdmin(user)
}

// pageAuth 是页面的 cookie 鉴权中间件。
//
// ## 为什么不复用 core.AdminAuthMiddleware
//
// 那条中间件读的是 `Authorization` 头，而浏览器导航请求带不了这个头。
// 逻辑（验 scope=admin）完全一样，只是**令牌从哪取**不同。
func pageAuth(issuer *core.TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		tok, err := c.Cookie(cookieName)
		if err != nil || tok == "" {
			c.Redirect(http.StatusFound, "/admin/login")
			c.Abort()
			return
		}
		name, err := issuer.ParseAdmin(tok)
		if err != nil {
			c.SetCookie(cookieName, "", -1, "/admin", "", false, true)
			c.Redirect(http.StatusFound, "/admin/login")
			c.Abort()
			return
		}
		c.Set(core.ContextAdmin, name)
		c.Next()
	}
}

// playerFilterFromQuery 从 URL query 解析玩家筛选条件。
func playerFilterFromQuery(c *gin.Context) PlayerFilter {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	plat, _ := strconv.Atoi(c.DefaultQuery("platform", "0"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "50"))
	return PlayerFilter{Platform: plat, Search: c.Query("q"), Page: page, Size: size}
}

// handleManualForm 处理后台页面的手工补录表单。
//
// 表单是全字符串的（`revenueYuan` 用「元」而不是「分」，
// 因为运营填的是元），这里转成请求结构再走同一条写入逻辑。
func handleManualForm(c *gin.Context, db *core.DB) {
	plat, _ := strconv.Atoi(c.PostForm("platform"))
	imp, _ := strconv.ParseInt(c.PostForm("impressions"), 10, 64)
	clk, _ := strconv.ParseInt(c.PostForm("clicks"), 10, 64)
	yuan := c.PostForm("revenueYuan")
	fen := yuanToFen(yuan)

	_, _ = db.Exec(`
INSERT INTO ad_revenue (platform, day, ad_type, placement, impressions, clicks, revenue_fen, source, fetched_at)
VALUES ($1,$2::date,$3,$4,$5,$6,$7,'manual',now())
ON CONFLICT (platform, day, ad_type, placement)
DO UPDATE SET impressions=$5, clicks=$6, revenue_fen=$7, source='manual', fetched_at=now()`,
		plat, c.PostForm("day"), c.PostForm("adType"), c.PostForm("placement"), imp, clk, fen)
}


// triggerSync 从后台页面触发一次同步。
//
// 同步可能要几秒（多次外部请求），所以**放到 goroutine 里**跑：
// 页面立刻返回，用户刷新就能看到结果。
// 失败只写日志 —— 后台的同步按钮不该把整个页面拖住。
func triggerSync(c *gin.Context, syncer *adrev.Syncer) {
	if syncer == nil {
		return
	}
	to := time.Now().AddDate(0, 0, -1)
	from := to.AddDate(0, 0, -29)
	go func() {
		for _, r := range syncer.SyncRange(from, to) {
			if r.Err != "" {
				c.Error(fmt.Errorf("广告同步(平台%d): %s", r.Platform, r.Err))
			}
		}
	}()
}

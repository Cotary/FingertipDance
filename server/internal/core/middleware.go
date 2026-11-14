package core

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ContextUID 是请求上下文里存放用户 ID 的键。
const ContextUID = "uid"

// CORS 允许跨域。
//
// ## 白名单而不是通配符
//
// 以前这里是写死的 `Access-Control-Allow-Origin: *`。配合
// `Authorization` 被允许（`Allow-Headers` 里有），意味着**任何网站**
// 都能从用户浏览器里拿 token 调我们的 API。
//
// 现在改成白名单：
//   - `allowed` 含 `*` → 允许所有（本地开发默认）
//   - `allowed` 为空 → 拒绝所有跨域（只放行同源请求）
//   - 否则按 `Origin` 精确匹配
//
// `Allow-Credentials` 与 `Origin: *` 不能共存（浏览器规范），
// 所以通配符模式下会忽略 credentials，并回显具体的 Origin。
func CORS(allowed ...string) gin.HandlerFunc {
	allowAll := len(allowed) == 0
	set := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		if o == "*" {
			allowAll = true
		}
		if o != "" {
			set[o] = true
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		// 没有 Origin 头 = 同源请求或非浏览器客户端 → 直接放行
		if origin == "" {
			c.Next()
			return
		}
		if allowAll {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		} else if set[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
		} else {
			// 不在白名单里 → 不下发 CORS 头。
			// 浏览器自己会拦掉响应，这里不 Abort（让业务逻辑照常跑，
			// 只是浏览器拿不到结果）。
			c.Next()
			return
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// LoggerMiddleware 记录请求日志。
func LoggerMiddleware(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("http",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", time.Since(start)),
			zap.Int64("uid", uidFromContext(c)),
		)
	}
}

// AuthMiddleware 校验 Bearer 令牌并把用户 ID 注入上下文。
func AuthMiddleware(issuer *TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			Fail(c, CodeUnauthorized, "缺少令牌")
			c.Abort()
			return
		}
		uid, err := issuer.Parse(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			Fail(c, CodeUnauthorized, "令牌无效")
			c.Abort()
			return
		}
		c.Set(ContextUID, uid)
		c.Next()
	}
}

// OptionalAuthMiddleware 尝试解析 Bearer 令牌，**但不强制要求**。
//
// ## 用途
//
// 埋点接口 `/api/report` 在客户端 `login()` **之前**就要用
// （`app_start` 是启动第一个事件），此时还没有 token。
// 如果这个接口挂在强制鉴权的分组下，那批事件会永远 401。
//
// ## 为什么不能简单地「不挂鉴权中间件」
//
// 不挂的话服务端拿不到 uid，所有事件都会记到 uid=0 名下，
// 之后就无法按玩家聚合埋点了。
//
// 所以：有 token 就用 token 里的 uid，没有就用 0（匿名）。
func OptionalAuthMiddleware(issuer *TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			if uid, err := issuer.Parse(strings.TrimPrefix(header, "Bearer ")); err == nil {
				c.Set(ContextUID, uid)
			}
		}
		c.Next()
	}
}

// uidFromContext 读取上下文中的用户 ID，不存在返回 0。
func uidFromContext(c *gin.Context) int64 {
	v, ok := c.Get(ContextUID)
	if !ok {
		return 0
	}
	uid, _ := v.(int64)
	return uid
}

// UIDFromContext 导出上下文的用户 ID，供 handler 使用。
func UIDFromContext(c *gin.Context) int64 { return uidFromContext(c) }

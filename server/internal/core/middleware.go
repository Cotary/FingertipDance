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

// CORS 允许跨域。生产环境应改为域名白名单。
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
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

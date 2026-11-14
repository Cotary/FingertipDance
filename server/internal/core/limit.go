package core

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// MaxRequestBody 是请求体大小上限（字节）。
//
// ## 为什么需要它
//
// 客户端上报 cover 成绩时带的是 `path []int` —— 一关最多 121 格，
// 正常请求体只有几 KB。但接口是**公开的**（只要有 token 就能调），
// 构造一个 `path` 传 100 万个点的请求会被 `ShouldBindJSON` 完整读进内存：
//
//   - 100 万个 int ≈ 8 MB JSON
//   - 解码后切片 ≈ 8 MB
//
// 十几个人并发就能把服务端的内存打满。而且 Gin 默认**不限制**请求体大小
// （`http.MaxBytesReader` 需要显式套）。
//
// 64 KB 足够装下最大的合法请求（121 个路径点 + 少量字段），
// 超出直接判 400。
const MaxRequestBody = 64 << 10 // 64 KB

// LimitBodyMiddleware 限制请求体大小。
//
// 必须挂在**所有**路由之前 —— Gin 的中间件顺序即执行顺序，
// 放在具体 handler 里才套就晚了（`ShouldBindJSON` 已经读完了）。
//
// 用法：
//
//	r.Use(core.LimitBodyMiddleware())
func LimitBodyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxRequestBody)
		}
		c.Next()
	}
}

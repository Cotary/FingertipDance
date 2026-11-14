package core

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter 是一个**进程内**的令牌桶限流器。
//
// ## 为什么需要它
//
// `/api/report` 是**匿名可调**的（`OptionalAuthMiddleware` —— 登录前的埋点也要能上报）。
// 没有限流的话：
//
//   - 任何人可以循环调这个接口，把 `events` 表刷爆（每请求 50 条事件）
//   - 每次调用都要写库 → 数据库 IO 被拖垮，**影响正常玩家的成绩上报**
//
// `/api/login` 同理（不需要 token）。
//
// ## 局限
//
// 这是**单进程**限流。多实例部署时每个实例各算各的 ——
// 真正的总量限制得靠 Redis（`internal/core/redis.go` 已经在用 Redis）。
// 但单进程限流已经能挡住「脚本小子刷接口」这个主要场景，
// 且不引入额外的外部依赖。
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     float64 // 每秒补多少个令牌
	capacity float64 // 桶容量（允许的突发量）
}

// bucket 是单个 key 的令牌桶状态。
type bucket struct {
	tokens float64
	last   time.Time
}

// NewRateLimiter 创建一个限流器。
//
// @param perSecond 每秒允许的请求数
// @param burst     允许的突发量（桶容量）
func NewRateLimiter(perSecond, burst float64) *RateLimiter {
	return &RateLimiter{
		buckets:  make(map[string]*bucket),
		rate:     perSecond,
		capacity: burst,
	}
}

// Allow 判断是否放行，并消耗一个令牌。
func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.capacity, last: now}
		rl.buckets[key] = b
	}
	// 按经过的时间补令牌
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * rl.rate
		if b.tokens > rl.capacity {
			b.tokens = rl.capacity
		}
		b.last = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Cleanup 清理长时间没活动的桶（防止 map 无限增长）。
//
// 定期调用（比如每 5 分钟一次）。
func (rl *RateLimiter) Cleanup(maxIdle time.Duration) {
	cutoff := time.Now().Add(-maxIdle)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for k, b := range rl.buckets {
		if b.last.Before(cutoff) {
			delete(rl.buckets, k)
		}
	}
}

// RateLimitMiddleware 按客户端 IP 限流。
//
// 超限时返回 429（`Fail` 用的是 HTTP 200 + 业务码，
// 这里直接用 429 让客户端和中间件能正确识别）。
func RateLimitMiddleware(rl *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if !rl.Allow(key) {
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(429, Response{Code: CodeRateLimit, Msg: "请求过于频繁"})
			return
		}
		c.Next()
	}
}

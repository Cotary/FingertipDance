package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestReportEndpointAllowsAnonymous 锁定 `/api/report` **不能**挂在强制鉴权下。
//
// ## 为什么
//
// 客户端在 `login()` **之前**就开始埋点了 —— `app_start` 是启动第一个事件，
// 那时 localStorage 里还没有 token。
//
// 如果这个接口挂在 `auth` 分组（强制 Bearer 令牌）下，那批事件会永远 401，
// 而且 401 会被 web 平台的 request() 转成异常 → tracker 的 catch 吞掉 →
// 事件永久卡在本地缓冲里。现象：localStorage.event_buffer 一直增长。
//
// ## 怎么修的
//
// 单独给 `/api/report` 挂 `OptionalAuthMiddleware`：
// 有 token 就用 token 里的 uid，没有就记 uid=0（匿名）。
func TestReportEndpointAllowsAnonymous(t *testing.T) {
	main := filepath.Join("..", "..", "cmd", "http", "main.go")
	b, err := os.ReadFile(main)
	if err != nil {
		t.Fatalf("读取 main.go 失败: %v", err)
	}
	src := string(b)

	// 找到 `/report` 的注册行
	idx := strings.Index(src, `"/report"`)
	if idx < 0 {
		t.Fatal("main.go 里找不到 /report 的路由注册")
	}
	line := src[idx:]
	if end := strings.Index(line, "\n"); end >= 0 {
		line = line[:end]
	}

	// 必须挂 OptionalAuthMiddleware
	if !strings.Contains(line, "OptionalAuthMiddleware") {
		t.Errorf("/report 路由没有挂 OptionalAuthMiddleware，会导致登录前的埋点永远 401：\n  %s", line)
	}

	// 反向检查：/report 不在 auth 分组里
	authBlock := src
	if i := strings.Index(src, `auth := api.Group("")`); i >= 0 {
		authBlock = src[i:]
	}
	for _, ln := range strings.Split(authBlock, "\n") {
		trimmed := strings.TrimSpace(ln)
		if strings.Contains(trimmed, `"/report"`) && strings.HasPrefix(trimmed, "auth.") {
			t.Errorf("/report 不该出现在 auth 分组里（强制鉴权会让登录前的事件永远 401）：\n  %s", trimmed)
		}
	}
}

// TestOptionalAuthMiddlewareExists 保证可选鉴权中间件没被删掉。
func TestOptionalAuthMiddlewareExists(t *testing.T) {
	p := filepath.Join("middleware.go")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读取 middleware.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "func OptionalAuthMiddleware") {
		t.Fatal("middleware.go 里找不到 OptionalAuthMiddleware")
	}
	// 它必须**不**拒绝匿名请求 —— 没有 Authorization 头时也要放行
	fnStart := strings.Index(src, "func OptionalAuthMiddleware")
	fn := src[fnStart:]
	if end := strings.Index(fn, "\n}\n"); end >= 0 {
		fn = fn[:end]
	}
	if strings.Contains(fn, "Abort()") {
		t.Errorf("OptionalAuthMiddleware 不能 Abort（它是可选鉴权，匿名必须放行）：\n  %s", fn)
	}
	if !strings.Contains(fn, "c.Next()") {
		t.Errorf("OptionalAuthMiddleware 必须调用 c.Next() 继续处理请求")
	}
}

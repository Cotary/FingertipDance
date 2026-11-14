package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestMaxRequestBodyIsReasonable 锁定请求体上限值。
//
// 64 KB 足够装最大的合法请求（121 个路径点 + 少量字段），
// 太小会误杀正常玩家，太大就失去保护意义。
func TestMaxRequestBodyIsReasonable(t *testing.T) {
	if MaxRequestBody < 16<<10 {
		t.Errorf("MaxRequestBody = %d，太小了（正常请求只有几 KB）", MaxRequestBody)
	}
	if MaxRequestBody > 1<<20 {
		t.Errorf("MaxRequestBody = %d，太大了（失去保护意义）", MaxRequestBody)
	}
}

// TestLimitBodyMiddlewareUsesMaxBytesReader 锁定中间件真的用了 MaxBytesReader。
//
// `http.MaxBytesReader` 是唯一能真正限制请求体读入量的标准库手段。
// 只在文档里写「有上限」而代码里没套 = 没有上限。
func TestLimitBodyMiddlewareUsesMaxBytesReader(t *testing.T) {
	p := filepath.Join("limit.go")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读取 limit.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "http.MaxBytesReader") {
		t.Error("limit.go 里没有用 http.MaxBytesReader（请求体实际上没有被限制）")
	}
	if !strings.Contains(src, "MaxRequestBody") {
		t.Error("limit.go 里没有引用 MaxRequestBody")
	}
}

// TestLimitBodyMiddlewareWired 锁定中间件真的挂到了路由上。
func TestLimitBodyMiddlewareWired(t *testing.T) {
	main := filepath.Join("..", "..", "cmd", "http", "main.go")
	b, err := os.ReadFile(main)
	if err != nil {
		t.Fatalf("读取 main.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "core.LimitBodyMiddleware()") {
		t.Error("main.go 里没有挂 LimitBodyMiddleware（请求体无限制，可被刷内存）")
	}

	// 必须在 gin.Recovery 之前注册（中间件按注册顺序执行）
	limitIdx := strings.Index(src, "core.LimitBodyMiddleware()")
	recovIdx := strings.Index(src, "gin.Recovery()")
	if limitIdx < 0 || recovIdx < 0 {
		t.Fatal("找不到 LimitBodyMiddleware 或 gin.Recovery")
	}
	if limitIdx > recovIdx {
		t.Error("LimitBodyMiddleware 应该在 gin.Recovery() 之前注册")
	}
}

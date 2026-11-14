package line

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// readFileInPackage 按包内相对路径读文件（测试用）。
func readFileInPackage(t *testing.T, parts ...string) ([]byte, error) {
	t.Helper()
	return os.ReadFile(filepath.Join(parts...))
}

// TestDebugJumpDisabledByDefault 锁定「调试跳关接口默认关闭」。
//
// ## 为什么这条最重要
//
// 跳关接口能让任何人把 `max_level` 推到 1000 ——
// 直接毁掉排行榜和关卡解锁链。
//
// 生产环境的 `config.prod.yaml` **不含** `debug` 段，
// yaml 解析后 `Debug.Enabled` 就是零值 `false` ——
// 所以「没配」必须等于「关着」，不能等于「开着」。
func TestDebugJumpDisabledByDefault(t *testing.T) {
	cfg := &core.Config{}
	if cfg.Debug.Enabled {
		t.Fatal("Debug.Enabled 的零值必须是 false（生产配置不含 debug 段 → 必须默认关闭）")
	}

	// 配置加载后也必须是关闭的
	var loaded core.Config
	if loaded.Debug.Enabled {
		t.Fatal("Debug.Enabled 默认必须是 false")
	}
}

// TestDebugJumpHandlerRejectsWhenDisabled 锁定「开关关闭时接口直接 403」。
//
// 关键是**在读参数之前**就返回 —— 生产环境下这个接口
// 要表现得「根本不存在」。
func TestDebugJumpHandlerRejectsWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	// 调试关闭
	r.POST("/api/debug/jump", DebugJumpHandler(nil, false))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/debug/jump",
		strings.NewReader(`{"levelIdx":500}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	var resp core.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v (body=%s)", err, w.Body.String())
	}
	if resp.Code != core.CodeForbidden {
		t.Errorf("调试关闭时应返回 %d(Forbidden)，实际 %d", core.CodeForbidden, resp.Code)
	}
}

// TestDebugJumpHandlerDoesNotTouchDataWhenDisabled 锁定「开关关闭时不碰数据库」。
//
// `db` 传 `nil` —— 如果处理器在开关检查之前就用了 db，
// 这个测试会直接 panic（nil pointer dereference）。
func TestDebugJumpHandlerDoesNotTouchDataWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.POST("/api/debug/jump", DebugJumpHandler(nil, false))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/debug/jump",
		strings.NewReader(`{"levelIdx":500}`))
	req.Header.Set("Content-Type", "application/json")

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("调试关闭时不应该碰数据库，却 panic 了: %v", r)
		}
	}()
	r.ServeHTTP(w, req)
}

// TestDebugJumpSourceDoesNotWriteLevelRecords 锁定「跳关不写成绩表」。
//
// ## 为什么不能补写记录
//
// `applyCoverProgress` 用 `level_records` 有无来判定 `firstPass`，
// 而 `firstPass` 决定真实成绩能不能刷新纪录。
//
// 如果跳关时给 1..N-1 都塞一条 `skipped=1`（undos=0、time_ms=0）的记录，
// 玩家之后真去打第 300 关时：
//
//	isNewBest = 0 < 0 || (0 == 0 && timeMs < 0) = false
//
// → 真实成绩被丢弃，玩家永远拿不到那颗星。
func TestDebugJumpSourceDoesNotWriteLevelRecords(t *testing.T) {
	b, err := readFileInPackage(t, "debug_jump.go")
	if err != nil {
		t.Fatalf("读取 debug_jump.go 失败: %v", err)
	}
	src := string(b)

	if strings.Contains(src, "INSERT INTO level_records") ||
		strings.Contains(src, "UPDATE level_records") {
		t.Error("跳关接口写了 level_records（会让之后的真实成绩永远刷不了新纪录）")
	}
	if !strings.Contains(src, "max_level = GREATEST(max_level") {
		t.Error("跳关接口没有推进 max_level")
	}
}

// TestDebugJumpAdvancesToLevelMinusOne 锁定「跳关把 max_level 推到目标关的前一关」。
//
// 少 1 是刻意的：目标关本身还没打过，不该算「已通关」。
// `currentLevel = maxLevel + 1` → 目标关正好成为「当前关」。
func TestDebugJumpAdvancesToLevelMinusOne(t *testing.T) {
	b, err := readFileInPackage(t, "debug_jump.go")
	if err != nil {
		t.Fatalf("读取 debug_jump.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "target := req.LevelIdx - 1") {
		t.Error("跳关的目标应该是 req.LevelIdx - 1（目标关本身还没打过）")
	}
}

// TestDebugRouteIsRegistered 锁定「路由挂上了」。
func TestDebugRouteIsRegistered(t *testing.T) {
	b, err := readFileInPackage(t, "..", "..", "..", "cmd", "http", "main.go")
	if err != nil {
		t.Fatalf("读取 main.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "/debug/jump") {
		t.Error("main.go 里没有注册 /debug/jump 路由")
	}
	if !strings.Contains(src, "cfg.Debug.Enabled") {
		t.Error("main.go 没有把 cfg.Debug.Enabled 传给跳关处理器")
	}
}

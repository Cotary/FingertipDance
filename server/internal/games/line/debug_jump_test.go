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

// TestDebugJumpSourceDoesNotWriteAnyProgress 锁定「跳关不写任何进度」。
//
// ## 2026-11-21 起这条断言反过来了
//
// 旧实现把 `users.max_level` 推到 `levelIdx - 1`（目标关成为「当前关」），
// 代价是**玩家的真实进度被永久顶高**：点进第 405 关看一眼，
// `max_level` 就从真实的 153 变成 404，之后再也不会自己降回来。
//
// 表现就是 2026-11-21 那次排查的问题：地图说「1..404 已通关、405 是你在这里」，
// 分享选关按星级说「405 你还没通过」—— 两条都对，放在一起就是自相矛盾。
//
// 所以现在的契约是：跳关**一个字节都不写**。真正的进度只由
// 通关上报（`applyCoverProgress`）与看广告跳过推进。
func TestDebugJumpSourceDoesNotWriteAnyProgress(t *testing.T) {
	b, err := readFileInPackage(t, "debug_jump.go")
	if err != nil {
		t.Fatalf("读取 debug_jump.go 失败: %v", err)
	}
	src := string(b)

	if strings.Contains(src, "INSERT INTO level_records") ||
		strings.Contains(src, "UPDATE level_records") {
		t.Error("跳关接口写了 level_records（会让之后的真实成绩永远刷不了新纪录）")
	}
	if strings.Contains(src, "UPDATE users") || strings.Contains(src, "max_level = GREATEST") {
		t.Error("跳关接口写了 users.max_level —— 会永久顶掉玩家真实进度（2026-11-21 的 bug）")
	}
}

// TestDebugJumpDoesNotBumpMaxLevel 锁定「跳关不再推进 max_level」。
//
// 少 1 那套（`target := levelIdx - 1`）已经删了：它让「抵达」变成了「已通关」。
func TestDebugJumpDoesNotBumpMaxLevel(t *testing.T) {
	b, err := readFileInPackage(t, "debug_jump.go")
	if err != nil {
		t.Fatalf("读取 debug_jump.go 失败: %v", err)
	}
	src := string(b)

	if strings.Contains(src, "target := req.LevelIdx - 1") {
		t.Error("跳关还在算 target = levelIdx-1（这是旧实现，会把目标关的上一关写成已通关）")
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
	if !strings.Contains(src, "/debug/repair-progress") {
		t.Error("main.go 里没有注册 /debug/repair-progress 路由（被跳关顶坏的账号没地方修）")
	}
	if !strings.Contains(src, "cfg.Debug.Enabled") {
		t.Error("main.go 没有把 cfg.Debug.Enabled 传给跳关处理器")
	}
}

// TestDebugRepairProgressRejectsWhenDisabled 锁定「修进度接口同样默认关闭」。
//
// 这个接口能把 `max_level` 改小 —— 生产环境要是能调，
// 任何人都能把别人的进度打回 0。所以它和跳关共用同一道开关门。
func TestDebugRepairProgressRejectsWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.POST("/api/debug/repair-progress", DebugRepairProgressHandler(nil, false))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/debug/repair-progress", nil)
	r.ServeHTTP(w, req)

	var resp core.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v (body=%s)", err, w.Body.String())
	}
	if resp.Code != core.CodeForbidden {
		t.Errorf("调试关闭时应返回 %d(Forbidden)，实际 %d", core.CodeForbidden, resp.Code)
	}
}

// TestDebugRepairProgressRecomputesFromRecords 锁定重算口径。
//
// 两条必须同时成立：
//  1. 从 `level_records` 取 `MAX(level_idx)`，且**只看 skipped=0**
//     （看广告跳过的关没有星，不该算「通过」——和分享选关、星级接口同一口径）；
//  2. 没有记录时落到 0，而不是把 `max_level` 留在原处或塞个 1。
func TestDebugRepairProgressRecomputesFromRecords(t *testing.T) {
	b, err := readFileInPackage(t, "debug_progress.go")
	if err != nil {
		t.Fatalf("读取 debug_progress.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "COALESCE(MAX(level_idx), 0)") {
		t.Error("修进度没有按 MAX(level_idx) 重算（没有记录时应落 0）")
	}
	if !strings.Contains(src, "skipped=0") {
		t.Error("修进度没有排除 skipped=1（看广告跳过的关不算通过）")
	}
	if !strings.Contains(src, "UPDATE users SET max_level=") {
		t.Error("修进度没有写回 users.max_level")
	}
}

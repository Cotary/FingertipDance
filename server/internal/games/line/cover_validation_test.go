package line

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestCoverProgressRejectsNegativeUndos 锁定「重来次数不能为负」。
//
// ## 为什么这条校验必须有
//
// `undos` 直接决定两件事：
//
//  1. 星级：`StarOfCover(-1)` → 3 星（比 0 次重来还好看）
//  2. 纪录：`isNewBest = req.Undos < oldUndos`
//
// 第 2 点是致命的 —— 只要玩家（或恶意客户端）上报一次 `undos = -1`，
// 之后**任何**正常提交都满足 `-1 < 正常值` 之外的判定，
// 纪录被永久锁死，玩家再也看不到「刷新纪录」。
func TestCoverProgressRejectsNegativeUndos(t *testing.T) {
	src := readCoverHandlerSource(t)

	// 必须有 undos 的负数校验
	if !strings.Contains(src, "req.Undos < 0") {
		t.Error("cover 成绩接口缺少 undos < 0 的校验（负数会锁死纪录）")
	}
	if !strings.Contains(src, "重来次数不能为负") {
		t.Error("cover 成绩接口缺少 undos 负数的错误提示")
	}
}

// TestCoverProgressRejectsNegativeStepsAndTime 锁定步数与用时的下界。
func TestCoverProgressRejectsNegativeStepsAndTime(t *testing.T) {
	src := readCoverHandlerSource(t)

	if !strings.Contains(src, "req.Steps < 0") {
		t.Error("cover 成绩接口缺少 steps < 0 的校验（负步数会让 total_steps 变负）")
	}
	if !strings.Contains(src, "req.TimeMs < 0") {
		t.Error("cover 成绩接口缺少 timeMs < 0 的校验（负用时会让总用时变负）")
	}
}

// TestCoverChallengeHasNumericValidation 锁定「挑战接口也必须有数值校验」。
//
// ## 背景
//
// 经典接口 `ChallengeHandler` 一直有 `steps` / `timeMs` 校验，
// 但 cover 的 `CoverChallengeHandler` **一个都没有** ——
// 路径长度对得上就直接写库。
//
// 后果：`timeMs = 0` + `undos` 相同 → 直接伪造「刷新纪录 + 极速」。
func TestCoverChallengeHasNumericValidation(t *testing.T) {
	src := readCoverHandlerSource(t)

	// 定位挑战接口的函数体
	start := strings.Index(src, "func CoverChallengeHandler")
	if start < 0 {
		t.Fatal("找不到 CoverChallengeHandler")
	}
	body := src[start:]

	// 挑战接口里必须有 undos / steps / timeMs 的校验
	for _, needle := range []string{
		"req.Undos < 0",
		"req.Steps != len(cells)-1",
		"req.TimeMs < 0",
		"req.TimeMs < len(req.Path)*20",
	} {
		if !strings.Contains(body, needle) {
			t.Errorf("CoverChallengeHandler 缺少校验 %q（可伪造纪录）", needle)
		}
	}
}

// TestCoverProgressValidatesUndosBeforeBranching 锁定「校验在跳过分支之前」。
//
// 跳过时 `path` 为空、长度校验不适用，但 `undos` / `steps` / `timeMs`
// 的下界**仍然**必须校验 —— 否则可以用 `skipped: true` + 负 undos 绕过。
func TestCoverProgressValidatesUndosBeforeBranching(t *testing.T) {
	src := readCoverHandlerSource(t)

	start := strings.Index(src, "func CoverProgressHandler")
	if start < 0 {
		t.Fatal("找不到 CoverProgressHandler")
	}
	end := strings.Index(src[start:], "func applyCoverProgress")
	if end < 0 {
		t.Fatal("找不到 applyCoverProgress")
	}
	body := src[start : start+end]

	negIdx := strings.Index(body, "req.Undos < 0")
	skipIdx := strings.Index(body, "if !req.Skipped {")
	if negIdx < 0 || skipIdx < 0 {
		t.Fatal("找不到负数校验或跳过分支")
	}
	if negIdx > skipIdx {
		t.Error("undos 的负数校验必须在 `if !req.Skipped` 分支**之前**（否则能用 skipped 绕过）")
	}
}

// TestLimitBodyMiddlewareWired 锁定请求体大小限制真的挂上了。
//
// 没有它，构造一个 `path` 传 100 万个点的请求就能把内存打满
// （Gin 默认不限制请求体大小）。
func TestLimitBodyMiddlewareWired(t *testing.T) {
	main := filepath.Join("..", "..", "..", "cmd", "http", "main.go")
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

// TestApplyProgressLocksUserRow 锁定「写入进度前要锁用户行」。
//
// 不锁的话并发提交同一关会：
//   - 两个事务都判定 firstPass → 都 INSERT → 撞主键 500
//   - total_steps 累加丢一次
//   - unlocked_skins 整体读-改-写丢一个皮肤
func TestApplyProgressLocksUserRow(t *testing.T) {
	for _, fn := range []string{"func applyCoverProgress", "func applyProgress"} {
		p := "progress.go"
		if fn == "func applyCoverProgress" {
			p = "cover_handler.go"
		}
		b, err := os.ReadFile(p)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", p, err)
		}
		src := string(b)
		start := strings.Index(src, fn)
		if start < 0 {
			t.Fatalf("找不到 %s", fn)
		}
		body := src[start:]
		if !strings.Contains(body, "lockUserRow(tx, uid)") {
			t.Errorf("%s 没有调用 lockUserRow（并发提交会丢更新）", fn)
		}
	}
}

// TestSkinGrantIsAtomic 锁定「发皮肤用原子追加，不再读-改-写」。
//
// 读-改-写会丢更新：两个事务同时读到 `["wood","mint"]`，
// 各自 append 一个皮肤，后写的把先写的整个覆盖掉。
func TestSkinGrantIsAtomic(t *testing.T) {
	b, err := os.ReadFile("skin_grant.go")
	if err != nil {
		t.Fatalf("读取 skin_grant.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "unlocked_skins || to_jsonb") {
		t.Error("发皮肤没有用原子追加（|| to_jsonb），并发下会丢皮肤")
	}
	if strings.Contains(src, "SELECT unlocked_skins FROM users") {
		t.Error("发皮肤仍在做「SELECT 整个数组」（读-改-写会丢更新）")
	}
}

// readCoverHandlerSource 读 cover_handler.go 的源码。
func readCoverHandlerSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("cover_handler.go")
	if err != nil {
		t.Fatalf("读取 cover_handler.go 失败: %v", err)
	}
	return string(b)
}

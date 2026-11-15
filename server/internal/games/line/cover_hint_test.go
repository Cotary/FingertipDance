package line

import (
	"testing"
)

// TestHintFromReferencePrefix 验证「玩家沿参考解走 → 剩余路线 = 参考解后缀」。
//
// 这是提示走查表的核心：O(1) 切片，零计算。
//
// 用真实的第 1 关参考解（来自内嵌关卡表），这样测的是**真数据**。
func TestHintFromReferencePrefix(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	sol, err := CoverLevels.ReferenceSolution(1)
	if err != nil {
		t.Fatalf("第 1 关参考解解码失败: %v", err)
	}
	if len(sol) < 4 {
		t.Skip("参考解太短，跳过")
	}

	// ① 玩家还没起步 → 整条参考解。
	//
	// 第 1 关是**自由起点**（startAt = -1）：空盘没有线头，
	// 参考解第 0 格就是「建议从哪格起手」，不能被掐掉。
	startAt1 := CoverLevels.Get(1).StartAt
	hint := HintFromReference(sol, startAt1, nil)
	if !hint.FromReference {
		t.Fatal("空路径应命中参考解")
	}
	if startAt1 < 0 {
		if len(hint.Cells) != len(sol) {
			t.Fatalf("自由起点空路径提示长度 = %d，期望 %d（整条参考解，含起手格）",
				len(hint.Cells), len(sol))
		}
		for i := range hint.Cells {
			if hint.Cells[i] != sol[i] {
				t.Fatalf("自由起点提示第 %d 格 = %d，期望 %d", i, hint.Cells[i], sol[i])
			}
		}
	}

	// ② 玩家走了前 k 格 → 剩余 = 参考解的 k.. 段（不含线头）
	k := 3
	hint2 := HintFromReference(sol, startAt1, sol[:k])
	if !hint2.FromReference {
		t.Fatal("沿参考解走应命中")
	}
	wantLen := len(sol) - k
	if len(hint2.Cells) != wantLen {
		t.Fatalf("提示长度 = %d，期望 %d", len(hint2.Cells), wantLen)
	}
	// 逐格核对：提示的第 i 格必须是参考解的第 k+i 格
	for i := range hint2.Cells {
		if hint2.Cells[i] != sol[k+i] {
			t.Fatalf("提示第 %d 格 = %d，期望 %d", i, hint2.Cells[i], sol[k+i])
		}
	}

	// ③ 玩家走岔了 → 不命中（客户端退回实时求解）
	bad := make([]int, k)
	copy(bad, sol[:k])
	bad[0] = sol[k] // 故意错开一位
	hint3 := HintFromReference(sol, startAt1, bad)
	if hint3.FromReference {
		t.Fatal("走岔后不应命中参考解")
	}
	if len(hint3.Cells) != 0 {
		t.Fatalf("走岔时提示应为空，实际 %d 格", len(hint3.Cells))
	}
}

// TestHintFromReferenceFixedStart 固定起点的空路径要掐掉起点那一格。
//
// 固定起点关卡里，玩家「还没起步」时线头**就已经在起点上**了。
// 若照抄整条参考解，客户端会把第一格画回他脚下 —— 提示链整体错一格。
func TestHintFromReferenceFixedStart(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}

	// 在真实关卡表里找一关固定起点的（第 1 关是自由起点，不能用）。
	idx := -1
	for i := 1; i <= CoverLevels.Count(); i++ {
		if e := CoverLevels.Get(i); e != nil && e.StartAt >= 0 {
			idx = i
			break
		}
	}
	if idx < 0 {
		t.Skip("关卡表里没有固定起点的关卡")
	}
	sol, err := CoverLevels.ReferenceSolution(idx)
	if err != nil {
		t.Fatalf("第 %d 关参考解解码失败: %v", idx, err)
	}

	hint := HintFromReference(sol, CoverLevels.Get(idx).StartAt, nil)
	if !hint.FromReference {
		t.Fatal("空路径应命中参考解")
	}
	if len(hint.Cells) != len(sol)-1 {
		t.Fatalf("固定起点空路径提示长度 = %d，期望 %d（整条参考解去掉线头）",
			len(hint.Cells), len(sol)-1)
	}
	if hint.Cells[0] != sol[1] {
		t.Fatalf("固定起点提示首格 = %d，期望 %d（起点之后那一格）", hint.Cells[0], sol[1])
	}
}

// TestHintFromReferenceFullWalk 走完全程 → 提示为空（没有下一步了）。
func TestHintFromReferenceFullWalk(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	sol, err := CoverLevels.ReferenceSolution(1)
	if err != nil {
		t.Fatalf("第 1 关参考解解码失败: %v", err)
	}
	hint := HintFromReference(sol, CoverLevels.Get(1).StartAt, sol)
	if !hint.FromReference {
		t.Fatal("走完全程仍应命中参考解")
	}
	if len(hint.Cells) != 0 {
		t.Fatalf("走完全程提示应为空，实际 %d 格", len(hint.Cells))
	}
}

// TestHintRouteIsRegistered 锁定「提示路由挂上了」。
func TestHintRouteIsRegistered(t *testing.T) {
	b, err := readFileInPackage(t, "..", "..", "..", "cmd", "http", "main.go")
	if err != nil {
		t.Fatalf("读取 main.go 失败: %v", err)
	}
	src := string(b)

	if !contains(src, "/cover/hint") {
		t.Error("main.go 里没有注册 /cover/hint 路由")
	}
	if !contains(src, "CoverHintHandler(coverLevelDB)") {
		t.Error("main.go 没有把 coverLevelDB 传给提示处理器")
	}
}

// contains 是 strings.Contains 的本地别名（避免为一个调用加 import）。
func contains(s, sub string) bool {
	return len(sub) == 0 || indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

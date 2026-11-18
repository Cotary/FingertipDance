package line

import (
	"testing"
)

// TestCoverLevelsLoad 验证内嵌的 cover 关卡表能加载。
func TestCoverLevelsLoad(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	if CoverLevels.Count() != 1000 {
		t.Fatalf("关卡数 = %d，期望 1000", CoverLevels.Count())
	}
	if CoverLevels.Version() == "" {
		t.Fatal("版本号不应为空")
	}
}

// TestCoverReferenceSolutionsValid 验证**全部 1000 关**的参考解都能通过完整规则校验。
//
// 这是 Go 侧与 TypeScript 侧「同一份规则」的交叉验证：
// Go 独立实现了冰块滑行 / 单向门 / 钥匙门 / 传送门 / 星星顺序，
// 如果两边对同一份数据的判定不一致，这里就会红。
//
// 全量跑（不是抽样）—— 因为规则判定漂移往往只出现在**少数关卡**上，
// 抽样会漏掉。1000 关的回放是 O(n)，总共几毫秒。
func TestCoverReferenceSolutionsValid(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	for idx := 1; idx <= CoverLevels.Count(); idx++ {
		lv := CoverLevels.Get(idx)
		if lv == nil {
			t.Fatalf("第 %d 关缺失", idx)
		}
		sol, err := CoverLevels.ReferenceSolution(idx)
		if err != nil {
			t.Fatalf("第 %d 关参考解解码失败: %v", idx, err)
		}
		grid, err := CoverLevels.Grid(idx)
		if err != nil {
			t.Fatalf("第 %d 关盘面解码失败: %v", idx, err)
		}
		cells := grid.Walkable()
		if len(sol) != len(cells) {
			t.Fatalf("第 %d 关参考解长度 %d != 可走格数 %d", idx, len(sol), len(cells))
		}
		if err := ValidateCoverPath(cells, grid, sol, lv.StartAt, lv.EndAt); err != nil {
			t.Fatalf("第 %d 关参考解校验失败: %v", idx, err)
		}
	}
}

// TestCoverRejectsIncompletePath 短路径（没铺满）必须被拒绝。
func TestCoverRejectsIncompletePath(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	lv := CoverLevels.Get(1)
	if lv == nil {
		t.Fatal("第 1 关缺失")
	}
	sol, err := CoverLevels.ReferenceSolution(1)
	if err != nil {
		t.Fatalf("参考解解码失败: %v", err)
	}
	// 去掉最后一格 → 少走一格，没铺满
	if err := CoverLevels.ValidatePath(1, sol[:len(sol)-1]); err == nil {
		t.Fatal("未铺满的路径应被拒绝")
	}
	// 交换中间两格 → 顺序错误（不是合法移动）
	if len(sol) >= 4 {
		bad := make([]int, len(sol))
		copy(bad, sol)
		bad[1], bad[2] = bad[2], bad[1]
		if err := CoverLevels.ValidatePath(1, bad); err == nil {
			t.Fatal("顺序错误的路径应被拒绝")
		}
	}
}

// TestCoverRejectsRepeat 重复走同一格（违反「不重复走」）必须被拒绝。
func TestCoverRejectsRepeat(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	lv := CoverLevels.Get(1)
	if lv == nil {
		t.Fatal("第 1 关缺失")
	}
	sol, err := CoverLevels.ReferenceSolution(1)
	if err != nil {
		t.Fatalf("参考解解码失败: %v", err)
	}
	if len(sol) < 3 {
		t.Skip("参考解太短，跳过")
	}
	bad := make([]int, len(sol))
	copy(bad, sol)
	bad[2] = bad[1] // 重复上一格
	if err := CoverLevels.ValidatePath(1, bad); err == nil {
		t.Fatal("重复走同一格应被拒绝")
	}
}

// TestCoverGridDecode 验证 grid 的位布局与 TS 侧一致。
func TestCoverGridDecode(t *testing.T) {
	// 手工构造 2x2 盘：
	//   (0,0)=普通 (1,0)=单向门朝右 (0,1)=星星(0) (1,1)=普通
	// 字节 = (type<<4) | (dir<<2) | group
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverOneway, CoverDirRight, 0),
		packCoverCell(CoverShard, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 2, H: 2, Bytes: bytes}
	if g.TypeAt(0) != CoverBrick {
		t.Errorf("格 0 类型 = %d，期望 %d", g.TypeAt(0), CoverBrick)
	}
	if g.TypeAt(1) != CoverOneway {
		t.Errorf("格 1 类型 = %d，期望 %d", g.TypeAt(1), CoverOneway)
	}
	if g.DirAt(1) != CoverDirRight {
		t.Errorf("格 1 方向 = %d，期望 %d", g.DirAt(1), CoverDirRight)
	}
	if g.TypeAt(2) != CoverShard {
		t.Errorf("格 2 类型 = %d，期望 %d", g.TypeAt(2), CoverShard)
	}
	if g.GroupAt(2) != 0 {
		t.Errorf("格 2 分组 = %d，期望 0", g.GroupAt(2))
	}
	cells := g.Walkable()
	if len(cells) != 4 {
		t.Errorf("可走格数 = %d，期望 4", len(cells))
	}
}

// TestCoverIceSlide 验证冰块沿**进入方向**滑行。
func TestCoverIceSlide(t *testing.T) {
	// 3x1 盘：普通 | 冰块 | 普通
	// 从 0 向右走进 1（冰块）→ 沿「进入方向」= 右 继续滑 → 吃掉 2
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 3, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 3)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	if len(consumed) != 2 {
		t.Fatalf("滑行消耗 %d 格，期望 2（冰块 + 终点）", len(consumed))
	}
	if consumed[0] != 1 || consumed[1] != 2 {
		t.Fatalf("滑行序列 = %v，期望 [1 2]", consumed)
	}

	// 从 2 向左走进 1（冰块）→ 沿左滑 → 吃掉 0
	visited2 := make([]bool, 3)
	visited2[2] = true
	consumed2 := coverStepMove(rs, 2, CoverDirLeft, visited2, 0, 0)
	if len(consumed2) != 2 || consumed2[0] != 1 || consumed2[1] != 0 {
		t.Fatalf("反向滑行序列 = %v，期望 [1 0]", consumed2)
	}
}

// TestCoverOnewayDirection 验证单向门只能沿箭头方向离开。
func TestCoverOnewayDirection(t *testing.T) {
	// 2x2：普通 | 单向门朝右
	//        普通 | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverOneway, CoverDirRight, 0),
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 2, H: 2, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)
	visited := make([]bool, 4)

	// 从格 1（单向门）向上离开 → 箭头朝右，不允许
	if coverStepMove(rs, 1, CoverDirUp, visited, 0, 0) != nil {
		t.Fatal("逆向离开单向门应被拒绝")
	}
	// 从格 1 向右离开 → 箭头朝右，允许（但格 1 在最右列，没有右邻居）
	// 所以用格 0 检验：从格 0 向右进入格 1 是允许的（进入不看箭头）
	if coverStepMove(rs, 0, CoverDirRight, visited, 0, 0) == nil {
		t.Fatal("向右进入单向门应被允许")
	}
}

// TestCoverKeyGate 验证没有钥匙时门不可进入。
func TestCoverKeyGate(t *testing.T) {
	// 3x1：钥匙(group 0) | 门(group 0) | 普通
	bytes := []byte{
		packCoverCell(CoverKey, 0, 0),
		packCoverCell(CoverGate, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 3, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)
	visited := make([]bool, 3)

	// 无钥匙：不能进入门
	if coverStepMove(rs, 0, CoverDirRight, visited, 0, 0) != nil {
		t.Fatal("没有钥匙时进入门应被拒绝")
	}
	// 有钥匙：可以
	if coverStepMove(rs, 0, CoverDirRight, visited, 1, 0) == nil {
		t.Fatal("持有对应钥匙时进入门应被允许")
	}
}

// TestCoverShardOrder 验证星星必须按编号顺序收集。
func TestCoverShardOrder(t *testing.T) {
	// 3x1：星星0 | 星星1 | 普通
	bytes := []byte{
		packCoverCell(CoverShard, 0, 0),
		packCoverCell(CoverShard, 0, 1),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 3, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	// 顺序正确：0 → 1 → 2
	if err := replayCoverPath(rs, []int{0, 1, 2}); err != nil {
		t.Fatalf("按序收集星星应通过: %v", err)
	}
	// 顺序错误：先碰 group 1
	if err := replayCoverPath(rs, []int{1, 0, 2}); err == nil {
		t.Fatal("乱序收集星星应被拒绝")
	}
}

// TestStarOfCover 验证星级阈值。
func TestStarOfCover(t *testing.T) {
	cases := []struct {
		undos int
		want  int
	}{
		{0, 3},
		{1, 2},
		{2, 2},
		{3, 1},
		{10, 1},
	}
	for _, c := range cases {
		if got := StarOfCover(c.undos); got != c.want {
			t.Errorf("StarOfCover(%d) = %d，期望 %d", c.undos, got, c.want)
		}
	}
}

// TestCoverIceSlideOnewayStopsBefore 验证滑行撞上箭头不一致的单向门时**停在门前**。
//
// 这是 2026-11-16 修复的核心场景：
// 之前滑行只判「已走 / 障碍 / 未开锁的门」，**漏掉了单向门箭头**，
// 于是「踩上冰块一路滑到底」会直接**穿过**反向的单向门。
func TestCoverIceSlideOnewayStopsBefore(t *testing.T) {
	// 4x1：普通 | 冰块 | 单向门(朝上) | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverOneway, CoverDirUp, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 4, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 4)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	if len(consumed) != 1 || consumed[0] != 1 {
		t.Fatalf("滑行应停在单向门前，实际消耗 %v，期望 [1]", consumed)
	}
	for _, c := range consumed {
		if c == 2 {
			t.Fatal("滑行不能穿过箭头不一致的单向门")
		}
	}
}

// TestCoverIceSlideOnewayMatchingDirection 验证箭头一致时滑行可以穿过单向门。
func TestCoverIceSlideOnewayMatchingDirection(t *testing.T) {
	// 4x1：普通 | 冰块 | 单向门(朝右) | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverOneway, CoverDirRight, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 4, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 4)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	if len(consumed) != 3 || consumed[0] != 1 || consumed[1] != 2 || consumed[2] != 3 {
		t.Fatalf("箭头一致时滑行应穿过单门，实际消耗 %v，期望 [1 2 3]", consumed)
	}
}

// TestCoverIceSlideOnewayFromBehind 验证反向滑行同样尊重单向门箭头。
func TestCoverIceSlideOnewayFromBehind(t *testing.T) {
	// 4x1：普通 | 单向门(朝右) | 冰块 | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverOneway, CoverDirRight, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 4, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 4)
	visited[3] = true
	consumed := coverStepMove(rs, 3, CoverDirLeft, visited, 0, 0)
	if len(consumed) != 1 || consumed[0] != 2 {
		t.Fatalf("反向滑行应停在单向门前，实际消耗 %v，期望 [2]", consumed)
	}
}

// TestCoverIceSlideKeyOpensGateMidSlide 验证滑行途中捡到的钥匙**立刻生效**。
//
// 「道具是行进中拿到的，不是障碍」—— 钥匙不该让滑行停下，
// 且同一段滑行后面的门就该被刚捡到的钥匙打开。
func TestCoverIceSlideKeyOpensGateMidSlide(t *testing.T) {
	// 5x1：普通 | 冰块 | 钥匙(0) | 门(0) | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverKey, 0, 0),
		packCoverCell(CoverGate, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 5, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 5)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	if len(consumed) != 4 {
		t.Fatalf("滑行消耗 %d 格，期望 4（冰块+钥匙+门+终点），实际 %v", len(consumed), consumed)
	}
}

// TestCoverIceSlideShardOrder 验证滑行途中星星必须按编号顺序，且乱序会挡住滑行。
func TestCoverIceSlideShardOrder(t *testing.T) {
	// 4x1：普通 | 冰块 | 星星(1) | 普通   —— 期望收集的是 0 号
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverShard, 0, 1),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 4, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 4)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	if len(consumed) != 1 || consumed[0] != 1 {
		t.Fatalf("乱序星星应挡住滑行，实际消耗 %v，期望 [1]", consumed)
	}

	// 编号正确时（0 号）应能滑过去
	bytes2 := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverShard, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g2 := &CoverGrid{W: 4, H: 1, Bytes: bytes2}
	rs2 := buildCoverRuleSet(g2.Walkable(), g2)
	visited2 := make([]bool, 4)
	visited2[0] = true
	consumed2 := coverStepMove(rs2, 0, CoverDirRight, visited2, 0, 0)
	if len(consumed2) != 3 {
		t.Fatalf("顺序正确的星星应被滑过，实际消耗 %v，期望 3 格", consumed2)
	}
}

// TestCoverMoveCarriesState 验证 coverMove 携带滑行后累积的钥匙掩码与星星进度。
func TestCoverMoveCarriesState(t *testing.T) {
	// 5x1：普通 | 冰块 | 钥匙(0) | 门(0) | 普通
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverKey, 0, 0),
		packCoverCell(CoverGate, 0, 0),
		packCoverCell(CoverBrick, 0, 0),
	}
	g := &CoverGrid{W: 5, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 5)
	visited[0] = true
	moves := coverCandidateMoves(rs, 0, visited, 0, 0)
	var right *coverMove
	for i := range moves {
		if moves[i].Dir == CoverDirRight {
			right = &moves[i]
			break
		}
	}
	if right == nil {
		t.Fatal("应存在向右的移动")
	}
	if right.KeyMask != 1 {
		t.Errorf("移动后钥匙掩码 = %d，期望 1", right.KeyMask)
	}
	if right.Key != 1 {
		t.Errorf("应报告拾取第 0 组钥匙，实际 %d", right.Key)
	}
}

// TestCoverIceSlideStopsAtPortal 验证滑行遇到传送门格时**停在门上**（传送门打断滑行）。
//
// 传送门不是墙 —— 它要被吃掉（滑行到它上面就停），
// 而不是「停在它前面」。玩家站在上面可以主动传送到搭档。
func TestCoverIceSlideStopsAtPortal(t *testing.T) {
	// 4x1：普通 | 冰块 | 传送门(0) | 传送门(0)   ← 同一 group → 配成一对
	bytes := []byte{
		packCoverCell(CoverBrick, 0, 0),
		packCoverCell(CoverIce, 0, 0),
		packCoverCell(CoverPortal, 0, 0),
		packCoverCell(CoverPortal, 0, 0),
	}
	g := &CoverGrid{W: 4, H: 1, Bytes: bytes}
	cells := g.Walkable()
	rs := buildCoverRuleSet(cells, g)

	visited := make([]bool, 4)
	visited[0] = true
	consumed := coverStepMove(rs, 0, CoverDirRight, visited, 0, 0)
	// 冰块 + 传送门（传送门被吃掉，滑行到此为止）
	if len(consumed) != 2 || consumed[0] != 1 || consumed[1] != 2 {
		t.Fatalf("滑行应停在传送门上，实际消耗 %v，期望 [1 2]", consumed)
	}
	if consumed[1] != 2 {
		t.Fatal("线头应停在传送门上")
	}

	// 站在传送门上 → 有传送边（跳到搭档）
	moves := coverCandidateMoves(rs, 2, visited, 0, 0)
	var portal *coverMove
	for i := range moves {
		if moves[i].ViaPortal {
			portal = &moves[i]
			break
		}
	}
	if portal == nil {
		t.Fatal("站在传送门上应有传送边")
	}
	if len(portal.Consumed) != 1 || portal.Consumed[0] != 3 {
		t.Errorf("传送应落到搭档格 3，实际 %v", portal.Consumed)
	}
}

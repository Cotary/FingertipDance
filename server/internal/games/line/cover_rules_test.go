package line

import (
	"encoding/base64"
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

// TestCoverReferenceSolutionsValid 验证**所有关卡**的参考解都能通过完整规则校验。
//
// 这是 Go 侧与 TypeScript 侧「同一份规则」的交叉验证：
// Go 独立实现了冰块滑行 / 单向门 / 钥匙门 / 传送门 / 星星顺序，
// 如果两边对同一份数据的判定不一致，这里就会红。
//
// 全量跑（不是抽样）—— 因为规则判定漂移往往只出现在**少数关卡**上，
// 抽样会漏掉。1000 关的回放是 O(n)，总共几毫秒。
//
// ## 传送门关卡现在也全量校验（2026-11-20）
//
// 关卡表已按新语义重新生成：传送门关卡的参考解是**专门拼接**出来的
// （跳跃边的两端就是传送门对），所以强制传送后依然能逐位回放。
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

// TestCoverSolutionCodecJumps 验证解的第 4 段（传送跳跃）的编解码。
//
// 「进入即传送」下，解里相邻两格可能**几何上不相邻** —— 那是传送跳跃。
// 2 bit 的方向编码表达不了这种步长，所以跳跃步单独记在第 4 段：
//
//	"起点,步数,base64(方向序列),stepIdx:targetFlat;stepIdx:targetFlat;…"
//
// 无跳跃的关卡仍然只有 3 段（旧格式照常能读）。
func TestCoverSolutionCodecJumps(t *testing.T) {
	w := 5

	// ① 3 段（无跳跃）：路径 0→1→2→7→12
	sol3 := "0,4,____"
	if _, err := DecodeCoverSolution(sol3, w); err == nil {
		t.Fatal("非法 base64 应被拒绝")
	}

	// ② 4 段（有一个跳跃）：手动构造 base64 方向序列。
	//
	// 方向编码：0=上 1=下 2=左 3=右，每 4 个方向打包成 1 字节（高位在前）。
	//
	// 路径（5 列）：0 → 1 → 2 → 17 → 18
	//   步 0：0→1   = 右（3）
	//   步 1：1→2   = 右（3）
	//   步 2：2→17  = **跳跃** → 占位方向 0（UP），目标记在第 4 段
	//   步 3：17→18 = 右（3）
	//
	// 方向序列 = [3, 3, 0, 3] → 一个字节 = 3<<6 | 3<<4 | 0<<2 | 3 = 0xF3
	dirs := []byte{0xF3}
	enc := "0,4," + base64.StdEncoding.EncodeToString(dirs) + ",2:17"
	got, err := DecodeCoverSolution(enc, w)
	if err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	want := []int{0, 1, 2, 17, 18}
	if len(got) != len(want) {
		t.Fatalf("解长度 = %d，期望 %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("第 %d 格 = %d，期望 %d", i, got[i], want[i])
		}
	}

	// ③ 跳跃记录格式非法 → 报错
	bad := "0,4," + base64.StdEncoding.EncodeToString(dirs) + ",xx"
	if _, err := DecodeCoverSolution(bad, w); err == nil {
		t.Fatal("非法跳跃记录应被拒绝")
	}
}

// TestCoverReferenceSolutionHasPortalJumps 验证传送门关卡的参考解**真的**用到了传送。
//
// 这是「参考解不是摆设」的检查：
//   - 传送门关卡的解里必须存在**非邻接步**（传送跳跃）；
//   - 跳跃的两端必须就是同一对传送门。
//
// 没有这条，生成器可能产出「有传送门但参考解从不传送」的关卡 ——
// 那种关卡在旧语义下能过校验，在新语义下会让玩家卡死。
func TestCoverReferenceSolutionHasPortalJumps(t *testing.T) {
	if err := CoverLevels.Load("testdata/nonexistent"); err != nil {
		t.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	portalLevels := 0
	jumpLevels := 0
	for idx := 1; idx <= CoverLevels.Count(); idx++ {
		sol, err := CoverLevels.ReferenceSolution(idx)
		if err != nil {
			t.Fatalf("第 %d 关参考解解码失败: %v", idx, err)
		}
		grid, err := CoverLevels.Grid(idx)
		if err != nil {
			t.Fatalf("第 %d 关盘面解码失败: %v", idx, err)
		}
		cells := grid.Walkable()
		rs := buildCoverRuleSet(cells, grid)

		hasPortal := false
		for i := range rs.TypeOf {
			if int(rs.TypeOf[i]) == CoverPortal {
				hasPortal = true
				break
			}
		}
		if !hasPortal {
			continue
		}
		portalLevels++

		// 局部编号 ↔ 拍平索引
		localOf := make(map[int]int, len(cells))
		for i, c := range cells {
			localOf[c] = i
		}

		jumps := 0
		for i := 1; i < len(sol); i++ {
			a := sol[i-1]
			b := sol[i]
			dx := abs(a%grid.W - b%grid.W)
			dy := abs(a/grid.W - b/grid.W)
			if dx+dy == 1 {
				continue
			}
			jumps++
			la, ok1 := localOf[a]
			lb, ok2 := localOf[b]
			if !ok1 || !ok2 {
				t.Fatalf("第 %d 关：跳跃端点不在可走格上", idx)
			}
			if int(rs.TypeOf[la]) != CoverPortal || int(rs.TypeOf[lb]) != CoverPortal {
				t.Fatalf("第 %d 关：跳跃两端不是传送门", idx)
			}
			if rs.PortalOf[la] != lb {
				t.Fatalf("第 %d 关：跳跃两端不是同一对传送门", idx)
			}
		}
		if jumps == 0 {
			t.Fatalf("第 %d 关：含传送门但参考解从未传送", idx)
		}
		jumpLevels++
	}
	if portalLevels == 0 {
		t.Fatal("关卡表里没有任何传送门关卡")
	}
	if jumpLevels != portalLevels {
		t.Fatalf("含传送门的关卡 %d 个，用到传送的 %d 个", portalLevels, jumpLevels)
	}
	t.Logf("传送门关卡 %d 个，全部在参考解里用到了传送", portalLevels)
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

// TestCoverIceSlideTransportsAtPortal 验证滑行撞上传送门时**立刻传走**。
//
// 2026-11-20 语义变更：传送是「进入即发生」，所以滑进入口的那一步
// 就把出口一起吃掉，线头落在出口上。旧行为是「停在门上、等玩家主动传」，
// 那个中间态已经取消 —— 它让玩家以为传送门只是块砖。
func TestCoverIceSlideTransportsAtPortal(t *testing.T) {
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
	// 冰块(1) → 进传送门(2) → 连带出口(3)
	want := []int{1, 2, 3}
	if len(consumed) != len(want) {
		t.Fatalf("滑行应连带出口，实际消耗 %v，期望 %v", consumed, want)
	}
	for i := range want {
		if consumed[i] != want[i] {
			t.Fatalf("滑行应连带出口，实际消耗 %v，期望 %v", consumed, want)
		}
	}
	if consumed[len(consumed)-1] != 3 {
		t.Fatal("线头应落在出口")
	}

	// 传送门**不再提供额外边**
	for _, mv := range coverCandidateMoves(rs, 2, visited, 0, 0) {
		if mv.ViaPortal {
			t.Fatal("传送门不应再有额外边")
		}
	}
}

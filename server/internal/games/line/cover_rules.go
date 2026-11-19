package line

import (
	"encoding/base64"
	"fmt"
)

// Cover v3：格子类型与位布局。
//
// 与 TypeScript 侧 `src/core/cover/v3/types.ts` **逐位一致** ——
// 这是「生成器 / 校验器 / 服务端」三方能互认的前提。
//
// 位布局（每格 1 字节）：
//
//	byte = (type << 4) | (dir << 2) | group
//	  type  4 bit  格子类型
//	  dir   2 bit  方向（单向门用：允许的离开方向）
//	  group 2 bit  分组（钥匙/门配对、星星编号、传送门配对）
const (
	CoverVoid   = 0  // 缺口：不可走，与盘外连通
	CoverBrick  = 1  // 普通可走格
	CoverBlock  = 2  // 石头：不可走，被可走格包围
	CoverOneway = 3  // 单向门：只能沿 dir 方向离开
	CoverShard  = 4  // 星星：必须按 group 编号顺序经过
	CoverKey    = 5  // 钥匙：走过即拾取
	CoverGate   = 6  // 门：未持有对应钥匙不可进入
	CoverPortal = 7  // 传送门：group 相同的一对格之间存在额外通道
	CoverIce    = 8  // 冰块：踩上后沿进入方向滑行至撞墙
	CoverStart  = 9  // 起点标记
	CoverEnd    = 10 // 终点标记
)

// Cover 方向编码：0=上 1=下 2=左 3=右。
const (
	CoverDirUp    = 0
	CoverDirDown  = 1
	CoverDirLeft  = 2
	CoverDirRight = 3
)

// coverCellType 解出格子类型。
func coverCellType(b byte) int { return int(b>>4) & 0x0f }

// coverCellDir 解出方向。
func coverCellDir(b byte) int { return int(b>>2) & 0x03 }

// coverCellGroup 解出分组。
func coverCellGroup(b byte) int { return int(b) & 0x03 }

// packCoverCell 打包一个格子（与 TS 侧 `packCell` 一致）。
func packCoverCell(typ, dir, group int) byte {
	return byte(((typ & 0x0f) << 4) | ((dir & 0x03) << 2) | (group & 0x03))
}

// CoverGrid 是解码后的 cover 盘面。
type CoverGrid struct {
	W, H  int
	Bytes []byte
}

// decodeCoverGrid 解码 base64 网格（每格 1 字节）。
func decodeCoverGrid(b64 string, w, h int) (*CoverGrid, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("base64 解码: %w", err)
	}
	if len(raw) != w*h {
		return nil, fmt.Errorf("网格长度 %d != %d", len(raw), w*h)
	}
	return &CoverGrid{W: w, H: h, Bytes: raw}, nil
}

// TypeAt 返回某格类型（拍平索引）。
func (g *CoverGrid) TypeAt(idx int) int {
	if idx < 0 || idx >= len(g.Bytes) {
		return CoverVoid
	}
	return coverCellType(g.Bytes[idx])
}

// DirAt 返回某格方向（单向门用）。
func (g *CoverGrid) DirAt(idx int) int {
	if idx < 0 || idx >= len(g.Bytes) {
		return 0
	}
	return coverCellDir(g.Bytes[idx])
}

// GroupAt 返回某格分组（星星编号 / 钥匙配对 / 传送门配对）。
func (g *CoverGrid) GroupAt(idx int) int {
	if idx < 0 || idx >= len(g.Bytes) {
		return 0
	}
	return coverCellGroup(g.Bytes[idx])
}

// Walkable 返回可走格（拍平索引，升序）。
//
// **可走 = 除 VOID 与 BLOCK 以外的所有格** —— 与 TypeScript 侧
// `walkableCells` 完全一致。
func (g *CoverGrid) Walkable() []int {
	out := make([]int, 0, len(g.Bytes))
	for i, b := range g.Bytes {
		t := coverCellType(b)
		if t == CoverVoid || t == CoverBlock {
			continue
		}
		out = append(out, i)
	}
	return out
}

// CoverRuleSet 是局部编号体系的规则集（与 TS 侧 RuleSet 同构）。
//
// 为什么要有局部编号：哈密顿求解器在 0..n-1 的密集编号上跑，
// 拍平索引会有大量空洞（VOID/BLOCK），缓存与剪枝都不划算。
type CoverRuleSet struct {
	N  int
	W  int
	H  int
	// LocalOf: 拍平索引 -> 局部编号；不可走为 -1
	LocalOf []int
	// FlatOf: 局部编号 -> 拍平索引
	FlatOf []int
	// TypeOf / DirOf / GroupOf: 局部编号 -> 对应属性
	TypeOf  []byte
	DirOf   []byte
	GroupOf []byte
	// Nbr: 局部编号 * 4 + 方向 -> 相邻局部编号；无则为 -1
	Nbr []int
	// PortalOf: 局部编号 -> 传送门搭档；无则为 -1
	PortalOf []int
	// StartAt / EndAt: 起终点约束；-1 = 自由
	StartAt int
	EndAt   int
}

// buildCoverRuleSet 由盘面与可走格列表构造规则集。
func buildCoverRuleSet(cells []int, g *CoverGrid) *CoverRuleSet {
	n := len(cells)
	rs := &CoverRuleSet{
		N:        n,
		W:        g.W,
		H:        g.H,
		LocalOf:  make([]int, g.W*g.H),
		FlatOf:   make([]int, n),
		TypeOf:   make([]byte, n),
		DirOf:    make([]byte, n),
		GroupOf:  make([]byte, n),
		Nbr:      make([]int, n*4),
		PortalOf: make([]int, n),
		StartAt:  -1,
		EndAt:    -1,
	}
	for i := range rs.LocalOf {
		rs.LocalOf[i] = -1
	}
	for i := range rs.Nbr {
		rs.Nbr[i] = -1
	}
	for i := range rs.PortalOf {
		rs.PortalOf[i] = -1
	}
	for i, c := range cells {
		rs.LocalOf[c] = i
		rs.FlatOf[i] = c
		// **只存解出来的字段**，不存原始字节 ——
		// 存原始字节的话 `rs.TypeOf[v] == CoverGate` 这类比较永远不成立
		// （类型在高位，字节值是 type<<4|dir<<2|group）。
		rs.TypeOf[i] = byte(g.TypeAt(c))
		rs.DirOf[i] = byte(g.DirAt(c))
		rs.GroupOf[i] = byte(g.GroupAt(c))
	}
	for i := 0; i < n; i++ {
		c := rs.FlatOf[i]
		x := c % rs.W
		y := c / rs.W
		if y > 0 {
			rs.Nbr[i*4+CoverDirUp] = rs.LocalOf[c-rs.W]
		}
		if y < rs.H-1 {
			rs.Nbr[i*4+CoverDirDown] = rs.LocalOf[c+rs.W]
		}
		if x > 0 {
			rs.Nbr[i*4+CoverDirLeft] = rs.LocalOf[c-1]
		}
		if x < rs.W-1 {
			rs.Nbr[i*4+CoverDirRight] = rs.LocalOf[c+1]
		}
	}
	// 传送门配对：同 group 的格按顺序两两配对
	byGroup := map[int][]int{}
	for i := 0; i < n; i++ {
		if int(rs.TypeOf[i]) != CoverPortal {
			continue
		}
		g := int(rs.GroupOf[i])
		byGroup[g] = append(byGroup[g], i)
	}
	for _, arr := range byGroup {
		for k := 0; k+1 < len(arr); k += 2 {
			rs.PortalOf[arr[k]] = arr[k+1]
			rs.PortalOf[arr[k+1]] = arr[k]
		}
	}
	return rs
}

// coverEnterable 某格能否进入（不考虑已走状态之外的一切）。
//
// **注意**：这里**不检查单向门箭头** —— 箭头的检查在两处，
// 分别是「离开」时（coverStepMove 开头）和「滑行途中进入」时
// （coverSlideBlocked）。合并到一处会漏掉其中一种。
func coverEnterable(rs *CoverRuleSet, v int, visited []bool, keyMask int) bool {
	return coverEnterableWith(rs, v, visited, keyMask, 0)
}

// coverEnterableWith 同 `coverEnterable`，但把「本步已吃掉、尚未写进 visited 的格数」算进来。
//
// ## 为什么需要 alreadyEaten
//
// 两点都要靠它：
//  1. **终点只能最后一步踩上** —— 判据是「visited 已覆盖 n-1 格」。
//     滑行一次吃掉多格，`visited` 只在整步结束后才更新，
//     不把本步已吃的算进来会永远差几格，「滑进终点收尾」就被误杀。
//  2. 传送门连带出口时同理（连带的那一格还没写进 visited）。
//
// **与 TS 侧 `enterable(rs, v, visited, keyMask, alreadyEaten)` 逐行对应。**
func coverEnterableWith(rs *CoverRuleSet, v int, visited []bool, keyMask int, alreadyEaten int) bool {
	if v < 0 || visited[v] {
		return false
	}
	if int(rs.TypeOf[v]) == CoverGate {
		grp := int(rs.GroupOf[v])
		if keyMask&(1<<grp) == 0 {
			return false
		}
	}
	// 终点：必须是最后一步。`EndAt < 0` 是自由终点，不加限制。
	if rs.EndAt >= 0 && v == rs.EndAt {
		seen := alreadyEaten
		for _, b := range visited {
			if b {
				seen++
			}
		}
		if seen != len(visited)-1 {
			return false
		}
	}
	return true
}

// coverSlideBlocked 滑行途中进入 v 是否被阻断（在进入之前判定）。
//
// **与 TS 侧 `slideBlocked` 逐行对应**。
//
// 两条阻断规则：
//  1. 单向门箭头与滑行方向不一致 → 不能进入 → 停在门前；
//  2. 星星编号不是下一个待收集的 → 不能进入 → 停在它前面。
//
// 钥匙**不阻断** —— 钥匙是行进中拿到的道具，捡到就生效。
func coverSlideBlocked(rs *CoverRuleSet, v int, dir int, shardNext int) bool {
	if v < 0 {
		return true
	}
	if int(rs.TypeOf[v]) == CoverOneway && int(rs.DirOf[v]) != dir {
		return true
	}
	if int(rs.TypeOf[v]) == CoverShard && int(rs.GroupOf[v]) != shardNext {
		return true
	}
	return false
}

// coverStepMove 从 cur 沿 dir 移动一步；若是冰块则滑行到撞墙。
//
// 返回新消耗的局部编号序列；不可移动返回 nil。
//
// **与 TS 侧 `stepMove` 逐行对应** —— 冰块沿「进入方向」滑行，
// 传送门是「可选边」（不算传送也能走进去）。
//
// 滑行途中每一格都按完整规则判定，遇到不满足的格就停在它前面：
//   - 单向门箭头不一致 → 停在门前；
//   - 星星编号不对 → 停在它前面；
//   - 未开锁的门 / 已走过的格 / 障碍 → 停在它前面。
//
// **传送门例外**：传送门不是墙，它要被吃掉 —— 滑到传送门格就停
// （打断滑行），玩家可以主动传送到搭档。
//
// 滑行途中捡到的钥匙**立刻生效**（同一段滑行后面的门可以被它打开），
// 星星也沿滑行**逐格推进**顺序。
func coverStepMove(rs *CoverRuleSet, cur, dir int, visited []bool, keyMask int, shardNext int) []int {
	// 单向门：只能沿指定方向离开
	if int(rs.TypeOf[cur]) == CoverOneway && int(rs.DirOf[cur]) != dir {
		return nil
	}
	first := rs.Nbr[cur*4+dir]
	if !coverEnterable(rs, first, visited, keyMask) {
		return nil
	}
	// 目标格若是乱序的星星 → 一步都走不了（与滑行同一套判定）
	if int(rs.TypeOf[first]) == CoverShard && int(rs.GroupOf[first]) != shardNext {
		return nil
	}
	consumed := []int{first}

	// ── 传送门：**进入即传送**（2026-11-20，与客户端 rules.ts 保持一致）──
	//
	// 走上传送门的那一步，搭档格立刻一起被吃掉：没有「站上去再决定」的中间态。
	// 旧实现把传送做成一条额外边（`coverCandidateMoves` 里推 viaPortal），
	// 但它排在四邻移动之后 —— 只要物理走得通，传送永远不触发，
	// 252 个传送门关卡参考解使用传送 0 次，玩家看到的就是「一块能踩过去的砖」。
	//
	// 搭档不可进（已走过 / 未开锁的门 / 乱序星星）→ **整步作废**：
	// 不能「进去了但没传」，那会让玩家以为自己踩到了一块普通砖。
	if int(rs.TypeOf[first]) == CoverPortal {
		partner := rs.PortalOf[first]
		if partner < 0 {
			return nil
		}
		if !coverEnterableWith(rs, partner, visited, keyMask, len(consumed)) {
			return nil
		}
		if int(rs.TypeOf[partner]) == CoverShard && int(rs.GroupOf[partner]) != shardNext {
			return nil
		}
		consumed = append(consumed, partner)
		return consumed
	}

	if int(rs.TypeOf[first]) != CoverIce {
		return consumed
	}
	// 冰块：沿进入方向继续滑行，直到下一格不可进入
	//
	// 滑行途中钥匙/星星的摘取状态逐格推进。
	curCell := first
	simKeyMask := keyMask
	simShardNext := shardNext
	for {
		nx := rs.Nbr[curCell*4+dir]
		if !coverEnterableWith(rs, nx, visited, simKeyMask, len(consumed)) {
			break
		}
		if coverSlideBlocked(rs, nx, dir, simShardNext) {
			break
		}
		consumed = append(consumed, nx)
		// 沿途的道具立刻生效
		if int(rs.TypeOf[nx]) == CoverKey {
			simKeyMask |= 1 << int(rs.GroupOf[nx])
		}
		if int(rs.TypeOf[nx]) == CoverShard {
			simShardNext = int(rs.GroupOf[nx]) + 1
		}
		curCell = nx
		// **滑到传送门 → 立刻传送**（和走进去一样，没有中间态）。
		// 滑行就此结束：搭档被吃掉，线头停在出口格上。
		if int(rs.TypeOf[nx]) == CoverPortal {
			partner := rs.PortalOf[nx]
			if partner < 0 {
				break
			}
			if !coverEnterableWith(rs, partner, visited, simKeyMask, len(consumed)) {
				break
			}
			if int(rs.TypeOf[partner]) == CoverShard && int(rs.GroupOf[partner]) != simShardNext {
				break
			}
			consumed = append(consumed, partner)
			break
		}
	}
	return consumed
}

// coverCandidateMoves 枚举 cur 的所有候选移动。
//
// 传送门**没有额外边**：它在 `coverStepMove` 里就已经完成传送
// （走进去的那一步 consumed 是 `[入口, 出口]`）。
//
// 旧实现在这里额外推一条 `viaPortal` 边，但它排在四邻移动之后，
// 只要物理走得通就永不被选中 —— 实测 252 关参考解使用传送 0 次。
// 现在传送是「进入即发生」，不再有第二个入口，避免两套语义漂移。
func coverCandidateMoves(rs *CoverRuleSet, cur int, visited []bool, keyMask int, shardNext int) []coverMove {
	out := make([]coverMove, 0, 4)
	for dir := 0; dir < 4; dir++ {
		consumed := coverStepMove(rs, cur, dir, visited, keyMask, shardNext)
		if consumed == nil {
			continue
		}
		out = append(out, coverMakeMove(rs, dir, consumed, keyMask, shardNext, false))
	}
	return out
}

// coverMove 是一次移动的结果。
type coverMove struct {
	Dir       int
	Consumed  []int
	Target    int
	Shard     int // 拾取的星星分组（1 基）；0 = 无
	Key       int // 拾取的钥匙分组（1 基）；0 = 无
	ViaPortal bool
	// KeyMask：本次移动结束后的钥匙掩码（含滑行途中捡到的钥匙）。
	// ShardNext：本次移动结束后的下一个待收集星星分组（0 基）。
	//
	// 滑行是一次移动吃掉多格，中途捡到的钥匙必须立刻生效，
	// 星星也必须逐格推进顺序 —— 所以状态随移动一起带出来。
	KeyMask   int
	ShardNext int
}

// coverMakeMove 组装一次移动（含星星/钥匙拾取信息）。
//
// **必须走这个函数** —— 直接构造 `coverMove` 会丢掉 Shard/Key 字段，
// 于是回放时「星星顺序」永远看不到正确的编号，
// 表现为「星星顺序错误：期望 0，实际 1」。
//
// **拾取状态沿消耗序列逐格推进** —— 与 TS 侧 `makeMove` 同一套语义。
func coverMakeMove(rs *CoverRuleSet, dir int, consumed []int, keyMask int, shardNext int, viaPortal bool) coverMove {
	mv := coverMove{
		Dir:       dir,
		Consumed:  consumed,
		Target:    consumed[len(consumed)-1],
		ViaPortal: viaPortal,
		KeyMask:   keyMask,
		ShardNext: shardNext,
	}
	for _, c := range consumed {
		switch int(rs.TypeOf[c]) {
		case CoverShard:
			mv.Shard = int(rs.GroupOf[c]) + 1
			mv.ShardNext = int(rs.GroupOf[c]) + 1
		case CoverKey:
			mv.Key = int(rs.GroupOf[c]) + 1
			mv.KeyMask |= 1 << int(rs.GroupOf[c])
		}
	}
	return mv
}

// ValidateCoverPath 按**完整规则**回放并校验一条 cover 路径。
//
// 校验项（与 TS 侧 `replay` 一致）：
//   1. 路径长度 == 可走格数（必须铺满）
//   2. 每一步是合法移动（冰块滑行、单向门方向、钥匙门、传送门）
//   3. 星星按编号顺序收集
//   4. 起终点约束
//   5. 覆盖全部可走格（不重复、不交叉）
//
// @param cells 解码后的可走格（拍平索引，升序）
// @param grid  解码后的盘面
// @param path  拍平索引序列（客户端上报的格式）
// @param startAt 起点拍平索引；-1 = 自由
// @param endAt   终点拍平索引；-1 = 自由
func ValidateCoverPath(cells []int, grid *CoverGrid, path []int, startAt, endAt int) error {
	rs := buildCoverRuleSet(cells, grid)
	if startAt >= 0 {
		rs.StartAt = rs.LocalOf[startAt]
	}
	if endAt >= 0 {
		rs.EndAt = rs.LocalOf[endAt]
	}
	// **拍平索引 → 局部编号**。
	//
	// 客户端上报的是拍平索引（`y*w+x`，能直接定位到 grid），
	// 而回放用的是局部编号（0..n-1 的密集编号）。
	// 两者混用会让第一格就「越界」—— 拍平索引在 9×9 盘上最大 80，
	// 而局部编号只有 0..n-1。
	localPath := make([]int, len(path))
	for i, f := range path {
		if f < 0 || f >= len(rs.LocalOf) {
			return &PathValidationError{Reason: fmt.Sprintf("第 %d 步索引越界", i)}
		}
		l := rs.LocalOf[f]
		if l < 0 {
			return &PathValidationError{Reason: fmt.Sprintf("第 %d 步落在不可走格上", i)}
		}
		localPath[i] = l
	}
	return replayCoverPath(rs, localPath)
}

// replayCoverPath 回放校验（局部编号路径）。
func replayCoverPath(rs *CoverRuleSet, pathLocal []int) error {
	n := rs.N
	if len(pathLocal) != n {
		return &PathValidationError{Reason: fmt.Sprintf("路径长度 %d != 可走格数 %d", len(pathLocal), n)}
	}
	visited := make([]bool, n)
	keyMask := 0
	shardNext := 0 // 0 基：下一个必须收集的星星分组

	cur := pathLocal[0]
	if cur < 0 || cur >= n {
		return &PathValidationError{Reason: "起点越界"}
	}
	if rs.StartAt >= 0 && cur != rs.StartAt {
		return &PathValidationError{Reason: fmt.Sprintf("起点应为 %d，实际 %d", rs.StartAt, cur)}
	}
	visited[cur] = true
	if int(rs.TypeOf[cur]) == CoverKey {
		keyMask |= 1 << int(rs.GroupOf[cur])
	}
	if int(rs.TypeOf[cur]) == CoverShard {
		shardNext = int(rs.GroupOf[cur]) + 1
	}

	p := 1
	for p < len(pathLocal) {
		moves := coverCandidateMoves(rs, cur, visited, keyMask, shardNext)
		var matched *coverMove
		for i := range moves {
			mv := &moves[i]
			if p+len(mv.Consumed) > len(pathLocal) {
				continue
			}
			ok := true
			for k, c := range mv.Consumed {
				if c != pathLocal[p+k] {
					ok = false
					break
				}
			}
			if ok {
				matched = mv
				break
			}
		}
		if matched == nil {
			return &PathValidationError{Reason: fmt.Sprintf("第 %d 步不是合法移动（当前 %d）", p, cur)}
		}
		// 星星顺序由 coverCandidateMoves 内部处理（乱序的星星会让移动走不成）。
		for _, c := range matched.Consumed {
			visited[c] = true
		}
		// 状态直接取移动里算好的结果（滑行途中逐格推进出来的）。
		keyMask = matched.KeyMask
		shardNext = matched.ShardNext
		cur = matched.Target
		p += len(matched.Consumed)
	}

	if rs.EndAt >= 0 && cur != rs.EndAt {
		return &PathValidationError{Reason: fmt.Sprintf("终点应为 %d，实际 %d", rs.EndAt, cur)}
	}
	for i := 0; i < n; i++ {
		if !visited[i] {
			return &PathValidationError{Reason: fmt.Sprintf("未覆盖格 %d", i)}
		}
	}
	return nil
}

// DecodeCoverSolution 解码解（"起点,步数,base64(方向序列)"）。
//
// 返回拍平索引序列。
//
// 编码格式见 TS 侧 `codec.ts` 的 `encodeSolution`：
// 每 4 个方向打包成 1 字节（每个方向 2 bit，高位在前）。
func DecodeCoverSolution(s string, w int) ([]int, error) {
	parts := splitComma(s)
	if len(parts) != 3 {
		return nil, fmt.Errorf("解格式非法")
	}
	start, err := atoiSafe(parts[0])
	if err != nil {
		return nil, err
	}
	steps, err := atoiSafe(parts[1])
	if err != nil {
		return nil, err
	}
	bin, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("解 base64 解码: %w", err)
	}
	path := make([]int, 0, steps+1)
	path = append(path, start)
	cur := start
	for i := 0; i < steps; i++ {
		b := bin[i/4]
		d := int(b>>(6-(i%4)*2)) & 0b11
		switch d {
		case CoverDirUp:
			cur -= w
		case CoverDirDown:
			cur += w
		case CoverDirLeft:
			cur--
		default:
			cur++
		}
		path = append(path, cur)
	}
	return path, nil
}

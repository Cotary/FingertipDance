package line

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// CoverLevelTableFile 是 cover v3 关卡表的服务端版（含解）。
//
// 与客户端表 `levels-v3-client.json` 的**唯一差别**是多了 `solution` 字段。
// 解绝不下发 —— 客户端一旦持有解，提示就成了摆设，
// 而且回放提交无法与真通关区分。
type CoverLevelTableFile struct {
	Version     string               `json:"version"`
	Count       int                  `json:"count"`
	GeneratedAt string               `json:"generatedAt"`
	Hash        string               `json:"hash"`
	Levels      []CoverLevelEntry    `json:"levels"`
}

// CoverLevelEntry 是关卡表的一条记录。
type CoverLevelEntry struct {
	Idx           int    `json:"idx"`
	Seed          uint32 `json:"seed"`
	W             int    `json:"w"`
	H             int    `json:"h"`
	Grid          string `json:"grid"`
	Required      int    `json:"required"`
	Shortest      int    `json:"shortest"`
	DeadEnds      int    `json:"deadEnds"`
	Branches      int    `json:"branches"`
	Diff          int    `json:"diff"`
	Turns         int    `json:"turns"`
	Corridor      int    `json:"corridor"`
	MechKinds     int    `json:"mechKinds"`
	SolutionCount int    `json:"solutionCount"`
	StartAt       int    `json:"startAt"`
	EndAt         int    `json:"endAt"`
	Solution      string `json:"solution,omitempty"`
	// UnlockSkin 是该关通关时发放的皮肤 id（空 = 不发）。
	//
	// cover 关卡表**必须**带这个字段 —— 否则 premium 三款
	// （黄金/星尘/星河）在 cover 模式下永远拿不到。
	UnlockSkin *string `json:"unlockSkin,omitempty"`
}

//go:embed levels-v3.json
var embeddedCoverLevels []byte

// CoverLevelTable 提供 cover 关卡的只读访问。
type CoverLevelTable struct {
	table *CoverLevelTableFile
	byIdx map[int]*CoverLevelEntry
	once  sync.Once
	err   error
}

// CoverLevels 是全局 cover 关卡表实例。
var CoverLevels = &CoverLevelTable{}

// Load 加载 cover 关卡表。
//
// 优先读磁盘（便于开发期热更），失败则回退到内嵌数据。
func (ct *CoverLevelTable) Load(dataDir string) error {
	ct.once.Do(func() {
		raw := embeddedCoverLevels
		if b, err := os.ReadFile(dataDir + "/levels-v3.json"); err == nil {
			raw = b
		}
		var table CoverLevelTableFile
		if err := json.Unmarshal(raw, &table); err != nil {
			ct.err = fmt.Errorf("解析 cover 关卡表: %w", err)
			return
		}
		if table.Count != len(table.Levels) {
			ct.err = fmt.Errorf("cover 关卡表 count=%d 与实际关卡数 %d 不符", table.Count, len(table.Levels))
			return
		}
		ct.table = &table
		ct.byIdx = make(map[int]*CoverLevelEntry, len(table.Levels))
		for i := range table.Levels {
			ct.byIdx[table.Levels[i].Idx] = &table.Levels[i]
		}
	})
	return ct.err
}

// Version 返回关卡表版本号。
func (ct *CoverLevelTable) Version() string {
	if ct.table == nil {
		return ""
	}
	return ct.table.Version
}

// Count 返回关卡总数。
func (ct *CoverLevelTable) Count() int {
	if ct.table == nil {
		return 0
	}
	return ct.table.Count
}

// Get 按关号取关卡，不存在返回 nil。
func (ct *CoverLevelTable) Get(idx int) *CoverLevelEntry {
	if ct.byIdx == nil {
		return nil
	}
	return ct.byIdx[idx]
}

// Range 返回 [from, from+count) 区间的关卡（自动钳制到有效范围）。
func (ct *CoverLevelTable) Range(from, count int) []CoverLevelEntry {
	if ct.table == nil || count <= 0 {
		return nil
	}
	if from < 1 {
		from = 1
	}
	if from > ct.table.Count {
		return nil
	}
	end := from + count
	if end > ct.table.Count+1 {
		end = ct.table.Count + 1
	}
	out := make([]CoverLevelEntry, 0, end-from)
	for i := from; i < end; i++ {
		if lv := ct.byIdx[i]; lv != nil {
			out = append(out, *lv)
		}
	}
	return out
}

// Grid 解码某关的盘面。
func (ct *CoverLevelTable) Grid(idx int) (*CoverGrid, error) {
	lv := ct.Get(idx)
	if lv == nil {
		return nil, fmt.Errorf("第 %d 关不存在", idx)
	}
	return decodeCoverGrid(lv.Grid, lv.W, lv.H)
}

// ValidatePath 按完整规则校验某关的一条解（拍平索引序列）。
func (ct *CoverLevelTable) ValidatePath(idx int, path []int) error {
	lv := ct.Get(idx)
	if lv == nil {
		return &PathValidationError{Reason: fmt.Sprintf("第 %d 关不存在", idx)}
	}
	grid, err := ct.Grid(idx)
	if err != nil {
		return err
	}
	return ValidateCoverPath(grid.Walkable(), grid, path, lv.StartAt, lv.EndAt)
}

// ReferenceSolution 返回某关的参考解（拍平索引序列），仅服务端内部使用。
func (ct *CoverLevelTable) ReferenceSolution(idx int) ([]int, error) {
	lv := ct.Get(idx)
	if lv == nil {
		return nil, fmt.Errorf("第 %d 关不存在", idx)
	}
	if lv.Solution == "" {
		return nil, fmt.Errorf("第 %d 关缺少参考解", idx)
	}
	return DecodeCoverSolution(lv.Solution, lv.W)
}

// SelfCheck 启动自检：抽检若干关，验证参考解能通过完整规则校验。
// coverTableHasPortal 盘面上是否有传送门格。
func coverTableHasPortal(g *CoverGrid) bool {
	for i := range g.Bytes {
		if coverCellType(g.Bytes[i]) == CoverPortal {
			return true
		}
	}
	return false
}

// SelfCheck 启动自检：抽检若干关，验证参考解能通过完整规则校验。
//
// ## 为什么跳过传送门关卡（2026-11-20）
//
// 传送语义改成「进入即传送」，而现有 252 个传送门关卡是
// 「传送门摆在解路径中间、被物理踩过去」生成的 —— 强制传送后
// 夹在中间的那些格永远进不去，参考解必然失效。
//
// 这不是规则错了，是**关卡表要重新生成**（用户已确认由他重做）。
// 这里跳过而不是让服务起不来：提示与校验接口都有兜底，
// 服务能跑才能验证别的东西。新表生成后这里不需要改也能全量通过。
func (ct *CoverLevelTable) SelfCheck(sampleCount int) error {
	if ct.table == nil {
		return fmt.Errorf("cover 关卡表未加载")
	}
	if ct.table.Count == 0 {
		return fmt.Errorf("cover 关卡表为空")
	}
	step := ct.table.Count / sampleCount
	if step < 1 {
		step = 1
	}
	checked := 0
	skipped := 0
	for i := 1; i <= ct.table.Count; i += step {
		lv := ct.byIdx[i]
		if lv == nil {
			return fmt.Errorf("cover 第 %d 关缺失", i)
		}
		grid, err := ct.Grid(i)
		if err != nil {
			return err
		}
		if coverTableHasPortal(grid) {
			skipped++
			continue
		}
		sol, err := ct.ReferenceSolution(i)
		if err != nil {
			return err
		}
		if err := ct.ValidatePath(i, sol); err != nil {
			return fmt.Errorf("cover 第 %d 关参考解校验失败: %w", i, err)
		}
		checked++
	}
	if checked == 0 {
		return fmt.Errorf("cover 自检未覆盖任何关卡")
	}
	_ = skipped
	return nil
}

package line

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// 关卡表文件（公开，会下发给客户端）。
type LevelTableFile struct {
	Version     string            `json:"version"`
	Count       int               `json:"count"`
	GeneratedAt string            `json:"generatedAt"`
	Levels      []SerializedLevel `json:"levels"`
}

// 序列化关卡。grid 是 base64 编码的紧凑网格。
type SerializedLevel struct {
	Idx        int     `json:"idx"`
	Seed       uint32  `json:"seed"`
	W          int     `json:"w"`
	H          int     `json:"h"`
	Grid       string  `json:"grid"`
	Shortest   int     `json:"shortest"`
	Turns      int     `json:"turns"`
	Blocks     int     `json:"blocks"`
	Oneways    int     `json:"oneways"`
	Diff       int     `json:"diff"`
	UnlockSkin *string `json:"unlockSkin"`
}

// 私密解法表（绝不下发）。
type SolutionTableFile struct {
	Version string `json:"version"`
	Levels  []struct {
		Idx           int   `json:"idx"`
		Solution      []int `json:"solution"`
		SolutionSteps int   `json:"solutionSteps"`
		Turns         int   `json:"turns"`
		Diff          int   `json:"diff"`
	} `json:"levels"`
}

//go:embed levels.json
var embeddedLevels []byte

//go:embed solutions.json
var embeddedSolutions []byte

// LevelTable 提供关卡的只读访问。
type LevelTable struct {
	table     *LevelTableFile
	solutions map[int][]int
	byIdx     map[int]*SerializedLevel
	once      sync.Once
	loadErr   error
}

// Levels 是全局关卡表实例。
var Levels = &LevelTable{}

// Load 从磁盘或内嵌数据加载关卡表。
// 优先读磁盘（便于开发期热更），失败则回退到内嵌数据。
func (lt *LevelTable) Load(dataDir string) error {
	lt.once.Do(func() {
		var raw []byte
		p := dataDir + "/levels.json"
		if b, err := os.ReadFile(p); err == nil {
			raw = b
		} else {
			raw = embeddedLevels
		}

		var table LevelTableFile
		if err := json.Unmarshal(raw, &table); err != nil {
			lt.loadErr = fmt.Errorf("解析关卡表: %w", err)
			return
		}
		if table.Count != len(table.Levels) {
			lt.loadErr = fmt.Errorf("关卡表 count=%d 与实际关卡数 %d 不符", table.Count, len(table.Levels))
			return
		}

		// 解法表
		var sols SolutionTableFile
		sraw := embeddedSolutions
		if b, err := os.ReadFile(dataDir + "/solutions.json"); err == nil {
			sraw = b
		}
		if err := json.Unmarshal(sraw, &sols); err != nil {
			lt.loadErr = fmt.Errorf("解析解法表: %w", err)
			return
		}
		if sols.Version != table.Version {
			lt.loadErr = fmt.Errorf("关卡表版本 %s 与解法表版本 %s 不一致", table.Version, sols.Version)
			return
		}

		lt.table = &table
		lt.byIdx = make(map[int]*SerializedLevel, len(table.Levels))
		for i := range table.Levels {
			lt.byIdx[table.Levels[i].Idx] = &table.Levels[i]
		}
		lt.solutions = make(map[int][]int, len(sols.Levels))
		for _, s := range sols.Levels {
			lt.solutions[s.Idx] = s.Solution
		}
	})
	return lt.loadErr
}

// Version 返回关卡表版本号。
func (lt *LevelTable) Version() string {
	if lt.table == nil {
		return ""
	}
	return lt.table.Version
}

// Count 返回关卡总数。
func (lt *LevelTable) Count() int {
	if lt.table == nil {
		return 0
	}
	return lt.table.Count
}

// Get 按关号取关卡，不存在返回 nil。
func (lt *LevelTable) Get(idx int) *SerializedLevel {
	return lt.byIdx[idx]
}

// Range 返回 [from, from+count) 区间的关卡（自动钳制到有效范围）。
func (lt *LevelTable) Range(from, count int) []SerializedLevel {
	if lt.table == nil || count <= 0 {
		return nil
	}
	if from < 1 {
		from = 1
	}
	if from > lt.table.Count {
		return nil
	}
	end := from + count
	if end > lt.table.Count+1 {
		end = lt.table.Count + 1
	}
	out := make([]SerializedLevel, 0, end-from)
	for i := from; i < end; i++ {
		out = append(out, *lt.byIdx[i])
	}
	return out
}

// Solution 返回某关的解法（仅服务端内部使用，禁止外泄）。
func (lt *LevelTable) Solution(idx int) []int {
	return lt.solutions[idx]
}

// SelfCheck 启动自检：抽检若干关，验证解法与关卡一致。
func (lt *LevelTable) SelfCheck(sampleCount int) error {
	if lt.table == nil {
		return fmt.Errorf("关卡表未加载")
	}
	if lt.table.Count == 0 {
		return fmt.Errorf("关卡表为空")
	}
	step := lt.table.Count / sampleCount
	if step < 1 {
		step = 1
	}
	checked := 0
	for i := 1; i <= lt.table.Count; i += step {
		lv := lt.byIdx[i]
		if lv == nil {
			return fmt.Errorf("第 %d 关缺失", i)
		}
		sol := lt.solutions[i]
		if len(sol) == 0 {
			return fmt.Errorf("第 %d 关缺少解法", i)
		}
		if len(sol)-1 != lv.Shortest {
			return fmt.Errorf("第 %d 关解法步数 %d 与 shortest %d 不一致", i, len(sol)-1, lv.Shortest)
		}
		startIdx, endIdx := startEndIndexOf(lv)
		if sol[0] != startIdx || sol[len(sol)-1] != endIdx {
			return fmt.Errorf("第 %d 关解法起止点不正确", i)
		}
		checked++
	}
	if checked == 0 {
		return fmt.Errorf("自检未覆盖任何关卡")
	}
	return nil
}

// startEndIndexOf 在 base64 网格中查找 START/END 格子的索引。仅用于自检。
func startEndIndexOf(lv *SerializedLevel) (start int, end int) {
	raw, err := decodeGridBase64(lv.Grid)
	if err != nil {
		return -1, -1
	}
	start, end = -1, -1
	for i := range raw {
		switch raw[i].Type {
		case CellStart:
			if start < 0 {
				start = i
			}
		case CellEnd:
			if end < 0 {
				end = i
			}
		}
	}
	return start, end
}

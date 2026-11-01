package line

import (
	"fmt"
)

// 方向增量，与 TypeScript 侧 DX/DY 一致。
var dirDX = [4]int{0, 0, -1, 1}
var dirDY = [4]int{-1, 1, 0, 0}

// PathValidationError 描述路径校验失败的原因。
type PathValidationError struct {
	Reason string
}

// Error 实现 error 接口。
func (e *PathValidationError) Error() string { return e.Reason }

// ValidatePath 校验一条路径是否合法。
// 规则与 TypeScript 侧 isPathLegal（core/solver.ts）完全一致，见 02-关卡格式与算法规格.md §5.4。
// @param cells 解码后的格子数组
// @param w 棋盘列数
// @param path 格子索引序列
func ValidatePath(cells []Cell, w int, path []int) error {
	if len(path) < 2 {
		return &PathValidationError{Reason: "路径长度不足"}
	}
	if len(path) > 200 {
		return &PathValidationError{Reason: "路径过长"}
	}

	// 找到起点与终点
	startIdx, endIdx := -1, -1
	for i, c := range cells {
		switch c.Type {
		case CellStart:
			startIdx = i
		case CellEnd:
			endIdx = i
		}
	}
	if startIdx < 0 || endIdx < 0 {
		return &PathValidationError{Reason: "关卡缺少起点或终点"}
	}
	if path[0] != startIdx {
		return &PathValidationError{Reason: "路径起点不匹配"}
	}
	if path[len(path)-1] != endIdx {
		return &PathValidationError{Reason: "路径终点不匹配"}
	}

	for i, idx := range path {
		if idx < 0 || idx >= len(cells) {
			return &PathValidationError{Reason: fmt.Sprintf("第 %d 步索引越界", i)}
		}
		cell := cells[idx]

		// 起点终点不能出现在中间
		if i > 0 && i < len(path)-1 {
			if cell.Type == CellStart || cell.Type == CellEnd {
				return &PathValidationError{Reason: fmt.Sprintf("第 %d 步经过起点或终点", i)}
			}
		}
		if cell.Type == CellBlock {
			return &PathValidationError{Reason: fmt.Sprintf("第 %d 步穿过阻挡块", i)}
		}

		if i > 0 {
			prev := path[i-1]
			dx := (idx % w) - (prev % w)
			dy := (idx / w) - (prev / w)
			if abs(dx)+abs(dy) != 1 {
				return &PathValidationError{Reason: fmt.Sprintf("第 %d 步与上一步不相邻", i)}
			}
			enterDir := dirOfDelta(dx, dy)
			if cell.Type == CellOneway && int(cell.Dir) != enterDir {
				return &PathValidationError{Reason: fmt.Sprintf("第 %d 步违背单向块方向", i)}
			}
		}
	}
	return nil
}

// dirOfDelta 由坐标差求方向。
func dirOfDelta(dx, dy int) int {
	switch {
	case dy == -1:
		return DirUp
	case dy == 1:
		return DirDown
	case dx == -1:
		return DirLeft
	default:
		return DirRight
	}
}

// abs 返回绝对值。
func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

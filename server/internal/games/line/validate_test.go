package line

import "testing"

func TestValidatePath(t *testing.T) {
	// 2x2: START(0) BRICK(1) / END(2) BRICK(3)
	cells := []Cell{
		{Type: CellStart},
		{Type: CellBrick},
		{Type: CellEnd},
		{Type: CellBrick},
	}
	if err := ValidatePath(cells, 2, []int{0, 1, 3, 2}); err != nil {
		t.Fatalf("合法路径应通过: %v", err)
	}
	if err := ValidatePath(cells, 2, []int{0, 3, 2}); err == nil {
		t.Fatal("非相邻路径应被拒绝")
	}
	if err := ValidatePath(cells, 2, []int{1, 3, 2}); err == nil {
		t.Fatal("起点不匹配应被拒绝")
	}
}

func TestValidatePathBlock(t *testing.T) {
	cells := []Cell{
		{Type: CellStart},
		{Type: CellBlock},
		{Type: CellEnd},
		{Type: CellBrick},
	}
	if err := ValidatePath(cells, 2, []int{0, 1, 2}); err == nil {
		t.Fatal("穿过阻挡块应被拒绝")
	}
}

func TestValidatePathOneway(t *testing.T) {
	// 格子 1 是单向块，箭头朝左（只能向左进入）
	cells := []Cell{
		{Type: CellStart},
		{Type: CellOneway, Dir: DirLeft},
		{Type: CellEnd},
		{Type: CellBrick},
	}
	// 从 0 进入 1 的方向是 RIGHT（向右走）→ 箭头朝左意味着只能向左进入 → 不合法
	if err := ValidatePath(cells, 2, []int{0, 1, 3, 2}); err == nil {
		t.Fatal("违背单向块方向应被拒绝")
	}
	// 反向：格子 1 箭头朝右，从 0 向右进入 1 合法
	cells[1].Dir = DirRight
	if err := ValidatePath(cells, 2, []int{0, 1, 3, 2}); err != nil {
		t.Fatalf("方向正确的单向块应通过: %v", err)
	}
}

func TestValidatePathStartInMiddle(t *testing.T) {
	cells := []Cell{
		{Type: CellStart},
		{Type: CellBrick},
		{Type: CellEnd},
		{Type: CellBrick},
	}
	if err := ValidatePath(cells, 2, []int{0, 1, 0, 3, 2}); err == nil {
		t.Fatal("中间经过起点应被拒绝")
	}
}

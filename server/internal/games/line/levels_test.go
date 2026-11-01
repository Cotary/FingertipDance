package line

import (
	"testing"
)

func TestLoadAndSelfCheck(t *testing.T) {
	if err := Levels.Load("../../data"); err != nil {
		t.Fatalf("加载关卡表失败: %v", err)
	}
	if Levels.Count() != 1000 {
		t.Fatalf("期望 1000 关，实际 %d", Levels.Count())
	}
	if err := Levels.SelfCheck(50); err != nil {
		t.Fatalf("自检失败: %v", err)
	}
}

func TestRange(t *testing.T) {
	if err := Levels.Load("../../data"); err != nil {
		t.Fatalf("加载失败: %v", err)
	}
	got := Levels.Range(1, 50)
	if len(got) != 50 {
		t.Fatalf("期望 50 关，实际 %d", len(got))
	}
	if got[0].Idx != 1 {
		t.Fatalf("首关关号应为 1，实际 %d", got[0].Idx)
	}
	// 越界钳制
	if len(Levels.Range(990, 50)) != 11 {
		t.Fatalf("末尾区间应返回 11 关")
	}
	if Levels.Range(2000, 50) != nil {
		t.Fatalf("超出范围的请求应返回 nil")
	}
}

func TestDecodeGrid(t *testing.T) {
	if err := Levels.Load("../../data"); err != nil {
		t.Fatalf("加载失败: %v", err)
	}
	lv := Levels.Get(1)
	if lv == nil {
		t.Fatal("第 1 关不存在")
	}
	cells, err := decodeGridBase64(lv.Grid)
	if err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if len(cells) != lv.W*lv.H {
		t.Fatalf("格子数应为 %d，实际 %d", lv.W*lv.H, len(cells))
	}
}

func TestVersionConsistency(t *testing.T) {
	if err := Levels.Load("../../data"); err != nil {
		t.Fatalf("加载失败: %v", err)
	}
	if Levels.Version() == "" {
		t.Fatal("版本号不应为空")
	}
}

// TestSolutionsPassValidatePath 交叉验证：TypeScript 生成的解法必须能通过 Go 侧路径校验。
// 这验证了「Go ValidatePath 与 TS isPathLegal 规则一致」这一防作弊前提。
func TestSolutionsPassValidatePath(t *testing.T) {
	if err := Levels.Load("../../data"); err != nil {
		t.Fatalf("加载失败: %v", err)
	}
	// 抽检 100 关（均匀分布）
	step := Levels.Count() / 100
	if step < 1 {
		step = 1
	}
	checked := 0
	for i := 1; i <= Levels.Count(); i += step {
		lv := Levels.Get(i)
		if lv == nil {
			t.Fatalf("第 %d 关缺失", i)
		}
		sol := Levels.Solution(i)
		if len(sol) == 0 {
			t.Fatalf("第 %d 关缺少解法", i)
		}
		cells, err := decodeGridBase64(lv.Grid)
		if err != nil {
			t.Fatalf("第 %d 关解码失败: %v", i, err)
		}
		if err := ValidatePath(cells, lv.W, sol); err != nil {
			t.Fatalf("第 %d 关的 TS 解法未通过 Go 校验（两侧规则不一致！）: %v", i, err)
		}
		if len(sol)-1 != lv.Shortest {
			t.Fatalf("第 %d 关解法步数与 shortest 不一致", i)
		}
		checked++
	}
	if checked < 100 {
		t.Fatalf("交叉验证应覆盖约 100 关，实际 %d", checked)
	}
}

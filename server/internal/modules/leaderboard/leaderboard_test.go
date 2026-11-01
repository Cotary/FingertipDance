package leaderboard

import "testing"

func TestComputeScore(t *testing.T) {
	// 关卡数越多分数越高
	if ComputeScore(10, 5000) <= ComputeScore(9, 1000) {
		t.Fatal("关卡数应主导分数")
	}
	// 同关卡数时用时少者分数高
	if ComputeScore(10, 3000) <= ComputeScore(10, 5000) {
		t.Fatal("同关卡数应按用时少者靠前")
	}
	// 用时被钳制，不会溢出到影响关卡维度
	s := ComputeScore(1, 999999999)
	if s <= 0 {
		t.Fatalf("分数不应为负: %d", s)
	}
	if s >= ComputeScore(2, 0) {
		t.Fatal("钳制后 1 关的分数仍应低于 2 关")
	}
}

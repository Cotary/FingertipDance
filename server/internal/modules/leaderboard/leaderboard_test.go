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

// 分页窗口的归一化。
//
// 这几个数直接进 Redis 的 ZREVRANGE：负 offset 在 Redis 里是「从末尾数」，
// 传 -1 会把榜尾那条当成第一页；limit 不封顶则一次拉整张表。
func TestClampRankWindow(t *testing.T) {
	cases := []struct {
		inOff, inLimit, wantOff, wantLimit int
	}{
		{0, 50, 0, 50},
		{-10, 50, 0, 50},
		{100, 0, 100, DefaultPageSize},
		{100, -5, 100, DefaultPageSize},
		{0, 9999, 0, MaxPageSize},
		{200, 20, 200, 20},
	}
	for _, c := range cases {
		off, limit := clampRankWindow(c.inOff, c.inLimit)
		if off != c.wantOff || limit != c.wantLimit {
			t.Errorf("clampRankWindow(%d,%d) = (%d,%d)，期望 (%d,%d)",
				c.inOff, c.inLimit, off, limit, c.wantOff, c.wantLimit)
		}
	}
}

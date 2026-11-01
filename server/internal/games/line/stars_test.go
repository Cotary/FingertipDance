package line

import "testing"

func TestStarOf(t *testing.T) {
	cases := []struct {
		steps, shortest, want int
	}{
		{115, 100, 3},
		{116, 100, 2},
		{150, 100, 2},
		{151, 100, 1},
		{10, 0, 1},
	}
	for _, c := range cases {
		if got := StarOf(c.steps, c.shortest); got != c.want {
			t.Errorf("StarOf(%d,%d)=%d want %d", c.steps, c.shortest, got, c.want)
		}
	}
}

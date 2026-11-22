package line

import (
	"strings"
	"testing"
)

// 跳关每日额度的服务端兜底。
//
// ## 为什么这几条用源码断言而不是跑 HTTP
//
// 这条路径要真库（`skips` 表 + `platform_config` + 用户行锁），
// 而本包的单测一直不连库（见 `cover_validation_test.go` 的同类断言）。
// 真库验证放在手工端到端里做（改本地存储后连续跳关，第 N+1 次被拒）。
//
// 这里锁的是**三条会被人改回去的规矩**。

// TestCoverSkipReadsDailyLimit 锁定「次数上限来自平台配置，且读不到就放行」。
//
// 反例（曾经的想法）是「读不到配置按 1 次算」——配置库抖一下，
// 所有玩家当天就只剩一次跳关机会，而且没人知道为什么。
func TestCoverSkipReadsDailyLimit(t *testing.T) {
	b, err := readFileInPackage(t, "cover_skip.go")
	if err != nil {
		t.Fatalf("读取 cover_skip.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "cfg.Ad.SkipDailyLimit") {
		t.Error("跳关没有读 platform_config 的 skipDailyLimit")
	}
	if !strings.Contains(src, "if limit > 0 {") {
		t.Error("limit <= 0 时必须视为不限（配置读不到不能拒绝玩家）")
	}
}

// TestCoverSkipCountsWholeDay 锁定「按当天 + 模式计数」。
//
// 只按 `level_idx` 判的话（原来的幂等插入）限制的是「同一关一天跳一次」，
// 玩家换一关就能继续跳 —— 那不是额度，是防重复提交。
func TestCoverSkipCountsWholeDay(t *testing.T) {
	b, err := readFileInPackage(t, "cover_skip.go")
	if err != nil {
		t.Fatalf("读取 cover_skip.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "count(*) FROM skips WHERE uid=$1 AND mode=$2 AND day=$3") {
		t.Error("每日额度必须按 (uid, mode, day) 数 skips 行数")
	}
}

// TestCoverSkipChecksQuotaBeforeInsert 锁定「先判额度、再落记录」。
//
// 顺序反了的话，超限那次也会写进 `skips`（然后才报错），
// 而 `skips` 是额度的计数来源 —— 玩家越点，明天的基准越高。
// 注意 `ON CONFLICT DO NOTHING` 只在同关重复时挡住，换关挡不住。
func TestCoverSkipChecksQuotaBeforeInsert(t *testing.T) {
	b, err := readFileInPackage(t, "cover_skip.go")
	if err != nil {
		t.Fatalf("读取 cover_skip.go 失败: %v", err)
	}
	src := string(b)

	quota := strings.Index(src, "SELECT count(*) FROM skips")
	insert := strings.Index(src, "INSERT INTO skips")
	if quota < 0 || insert < 0 {
		t.Fatal("没找到额度查询或跳过写入")
	}
	if quota > insert {
		t.Error("额度查询必须在 INSERT 之前（否则超限那次也会被计数）")
	}
}

package line

import (
	"strings"
	"testing"
)

// 看广告次数的落库。
//
// `users.ad_watch_cnt` 从 001 就存在，后台玩家详情页一直在读，
// 但此前**全仓没有一处写过它** —— 界面那个「看广告次数」是死的 0。
//
// 同样是源码断言（不连库），锁住两条容易被人改回去的写法。

// TestAdWatchIncrementsColumn 锁定「是 UPDATE 自增，不是读-改-写」。
//
// 读出来 `+1` 再写回，两个并发的「看完」会互相覆盖，
// 表现是连看两次只加了一次 —— 而这种事几乎不会有人发现。
func TestAdWatchIncrementsColumn(t *testing.T) {
	b, err := readFileInPackage(t, "ad_watch.go")
	if err != nil {
		t.Fatalf("读取 ad_watch.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "ad_watch_cnt = ad_watch_cnt + 1") {
		t.Error("计数必须是列自增（ad_watch_cnt = ad_watch_cnt + 1），不能读-改-写")
	}
	// RETURNING 顺手把新值带回：客户端要显示「看广告次数」，不该再拉一次 profile
	if !strings.Contains(src, "RETURNING ad_watch_cnt") {
		t.Error("应 RETURNING 新值，省掉客户端一次 profile 请求")
	}
}

// TestAdWatchIsStandalone 锁定「不塞进通关事务」。
//
// 塞进 `applyCoverProgress` 的话，路径非法 / 用时异常那一笔会整笔回滚，
// 而广告其实已经看完（平台那边真扣了曝光）—— 越是被判作弊的请求越不计数。
func TestAdWatchIsStandalone(t *testing.T) {
	b, err := readFileInPackage(t, "ad_watch.go")
	if err != nil {
		t.Fatalf("读取 ad_watch.go 失败: %v", err)
	}
	src := string(b)

	if strings.Contains(src, "db.Begin()") {
		t.Error("广告计数不该开事务 —— 它在通关之外，回滚没有意义")
	}
}

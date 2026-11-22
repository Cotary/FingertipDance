package profile

import (
	"os"
	"strings"
	"testing"
)

// 战绩口径：累计重来必须来自 `SUM(level_records.undos)`。
//
// ## 为什么锁这条
//
// 客户端原来自己数「点了几次重来按钮」—— 那和「悔棋了几次」是两个东西：
// 撤销 20 步再重开，真实的悔棋是 20，按钮只记 1。
// 更麻烦的是后台玩家详情页用的是 `SUM(undos)`，两边对不上时，
// 同一个玩家在游戏里和后台会显示两个「累计重来」。
//
// 所以这里断言：服务端算了这个数，而且**按 cover 模式**算（与后台同一口径）。
func TestTotalRetriesComesFromUndos(t *testing.T) {
	src := readSource(t)

	if !strings.Contains(src, "COALESCE(SUM(undos),0)") {
		t.Error("累计重来必须由 SUM(level_records.undos) 推导")
	}
	if !strings.Contains(src, "FROM level_records WHERE uid=$1 AND mode=$2") {
		t.Error("必须按 mode 过滤（后台玩家详情页用的是 cover 模式 = 1）")
	}
	if !strings.Contains(src, `"totalRetries":`) {
		t.Error("登录 / 资料响应里要带上 totalRetries，客户端才有东西可同步")
	}
}

// 「看广告次数」必须真的从库里读出来，而不是让客户端自报。
func TestProfileReturnsAdWatchCnt(t *testing.T) {
	src := readSource(t)

	if !strings.Contains(src, "ad_watch_cnt FROM users WHERE id=$1") {
		t.Error("资料接口应从 users.ad_watch_cnt 读累计广告次数")
	}
	if !strings.Contains(src, `"adWatchCnt":`) {
		t.Error("资料响应里要带 adWatchCnt")
	}
}

// 更新资料时，空字段不能覆盖已有值。
//
// 「只想换头像」如果顺带把昵称清空，好友榜上会变成一排「玩家」。
func TestUpdateProfileKeepsEmptyFields(t *testing.T) {
	src := readSource(t)

	if !strings.Contains(src, "CASE WHEN $1 = '' THEN nickname ELSE $1 END") {
		t.Error("昵称为空时应保留原值")
	}
	if !strings.Contains(src, "CASE WHEN $2 = '' THEN avatar") {
		t.Error("头像为空时应保留原值")
	}
}

func readSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("profile.go")
	if err != nil {
		t.Fatalf("读取 profile.go 失败: %v", err)
	}
	return string(b)
}

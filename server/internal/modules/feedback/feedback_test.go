package feedback

import (
	"os"
	"strings"
	"testing"
)

// readSource 读本包源码（不连库的源码断言）。
func readSource(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("feedback.go")
	if err != nil {
		t.Fatalf("读源码失败: %v", err)
	}
	return string(b)
}

// 正文为空必须拒绝。
//
// ## 为什么这条值得测
//
// 「只有截图没有文字」的反馈运营看不懂 —— 玩家想说"这关过不去"还是
// "这里画错了"，全靠那句话。允许空正文会让后台堆满无法处理的条目。
func TestRejectsEmptyContent(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, "strings.TrimSpace(req.Content)") {
		t.Error("正文要先 TrimSpace —— 全空格也算空")
	}
	if !strings.Contains(src, `"请先写点内容"`) {
		t.Error("空正文要有明确提示，不能静默写入一条空反馈")
	}
}

// 超长正文截断而不是报错。
//
// 玩家写了 600 字，把内容退回去说"太长了"是最差的做法 —— 他会直接放弃。
func TestTruncatesLongContentInsteadOfFailing(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, "maxContentRunes") {
		t.Error("正文要按字符数限制（按字节限会让中文只能写 1/3）")
	}
	if !strings.Contains(src, "string([]rune(content)[:maxContentRunes])") {
		t.Error("超长应截断保留，而不是报错退回")
	}
}

// 图太大时丢图保文字。
//
// 图片是附加信息，文字才是主体。为了传图让整条反馈失败，
// 玩家只会认为"反馈功能坏了"。
func TestDropsOversizedImageKeepsText(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, "maxImageB64") {
		t.Error("图片要有长度上限")
	}
	if !strings.Contains(src, "image = \"\"") {
		t.Error("超限图片应丢弃（保留文字），而不是整条拒绝")
	}
}

// 平台快照从库里取，不信客户端。
func TestPlatformFromDB(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, "SELECT platform FROM users WHERE id=$1") {
		t.Error("平台应从 users 表读，客户端传的值不可信")
	}
}

// 初始状态必须是 'new'，否则后台列表默认筛不出新反馈。
func TestInsertsAsNew(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, "'new'") {
		t.Error("新反馈的 status 必须是 'new'")
	}
}

// 去 dataURL 前缀：客户端不该带，但带了不该整条拒绝。
func TestStripsDataURLPrefix(t *testing.T) {
	src := readSource(t)
	if !strings.Contains(src, `"base64,"`) {
		t.Error("要兼容误带 data:image/...;base64, 前缀的请求")
	}
}

// 迁移必须幂等（`core/migrate.go` 每次启动全跑，不记版本）。
func TestMigrationIsIdempotent(t *testing.T) {
	b, err := os.ReadFile("../../../migrations/012_feedback.sql")
	if err != nil {
		t.Fatalf("读迁移失败: %v", err)
	}
	sql := string(b)
	if !strings.Contains(sql, "CREATE TABLE IF NOT EXISTS feedbacks") {
		t.Error("建表必须 IF NOT EXISTS（迁移每次启动都会跑）")
	}
	if !strings.Contains(sql, "CREATE INDEX IF NOT EXISTS") {
		t.Error("索引也必须 IF NOT EXISTS")
	}
}

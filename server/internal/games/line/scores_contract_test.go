package line

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestScoresTableHasModeAndUndos 锁定 `scores` 表必须有 `mode` 与 `undos` 两列。
//
// ## 背景（2026-11-06 本地联调发现）
//
// `/api/cover/challenge` 100% 报 500：
//
//	ERROR: column "undos" does not exist (SQLSTATE 42703)
//
// 根因是 `scores` 表建出来的时候（001_init.sql）只有
// `(uid, level_idx, steps, time_ms)`，而 cover 的挑战要按 **undos** 排序
// 查历史最佳 —— 列不存在，查询直接报错。
//
// 这个测试读迁移文件本身（不连库），
// 保证「迁移文件里必须有这两列」这件事不会在重构中被删掉。
func TestScoresTableHasModeAndUndos(t *testing.T) {
	mig := filepath.Join("..", "..", "..", "migrations", "004_cover_scores.sql")
	b, err := os.ReadFile(mig)
	if err != nil {
		t.Fatalf("读取迁移文件失败: %v", err)
	}
	sql := string(b)
	for _, col := range []string{"undos", "mode"} {
		if !strings.Contains(sql, "ADD COLUMN IF NOT EXISTS "+col) {
			t.Errorf("迁移 004 缺少 `ADD COLUMN IF NOT EXISTS %s`", col)
		}
	}
}

// TestScoresWritesCarryMode 锁定所有写 `scores` 的语句都带 `mode` 与 `undos`。
//
// ## 为什么必须带
//
// 经典模式与 cover 模式**共用同一套关号空间**（都是 1..1000），
// 查历史最佳时按 `mode` 过滤。不写 mode 的话两种模式的流水会混在一起 ——
// cover 的 steps 恒为 required−1，会把经典的 steps 最佳值拉到 required−1。
func TestScoresWritesCarryMode(t *testing.T) {
	files := []string{"progress.go", "challenge.go", "cover_handler.go"}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", f, err)
		}
		src := string(b)
		idx := strings.Index(src, "INSERT INTO scores")
		if idx < 0 {
			t.Errorf("%s 没有写 scores", f)
			continue
		}
		// 列清单在 INSERT 语句里，截到 VALUES 之前
		frag := src[idx:]
		if end := strings.Index(frag, "VALUES"); end > 0 {
			frag = frag[:end]
		}
		if !strings.Contains(frag, "mode") {
			t.Errorf("%s 写 scores 时缺少 mode 列", f)
		}
		if !strings.Contains(frag, "undos") {
			t.Errorf("%s 写 scores 时缺少 undos 列", f)
		}
	}
}

// TestScoresBestQueryFiltersMode 锁定查历史最佳时按 `mode` **和 `uid`** 过滤。
//
// 不加 mode 过滤：两种模式的成绩会互相污染 ——
// 经典的 steps 最佳值会被 cover 的 required−1 拉低，
// cover 的 undos 最佳值会被经典的 0 拉低（永远显示 0 次重来）。
//
// 不加 uid 过滤：查出来的是**全服**最佳 ——
// 第一个玩家清了这关之后，后面所有人都是 false，
// 「刷新纪录」这个功能对所有人永久失效。
func TestScoresBestQueryFiltersMode(t *testing.T) {
	cases := []struct {
		file string
		desc string
	}{
		{"challenge.go", "经典挑战查历史最佳"},
		{"cover_handler.go", "cover 挑战查历史最佳"},
	}
	for _, c := range cases {
		b, err := os.ReadFile(c.file)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", c.file, err)
		}
		src := string(b)
		idx := strings.Index(src, "FROM scores")
		if idx < 0 {
			t.Errorf("%s 没有查 scores", c.file)
			continue
		}
		frag := src[idx:]
		if end := strings.Index(frag, "LIMIT"); end > 0 {
			frag = frag[:end]
		}
		if !strings.Contains(frag, "mode=$") {
			t.Errorf("%s 查历史最佳未按 mode 过滤：%s", c.desc, strings.TrimSpace(frag))
		}
		if !strings.Contains(frag, "uid=$") {
			t.Errorf("%s 查历史最佳未按 uid 过滤（会变成全服最佳，isNewBest 对所有人永久失效）：%s",
				c.desc, strings.TrimSpace(frag))
		}
	}
}

// TestScoresBestQueriedBeforeInsert 锁定「查历史最佳」必须在「写流水」**之前**。
//
// ## 为什么顺序重要
//
// 先写再查的话，本次提交的这一行也在「历史最佳」里，
// 于是 `req.X < best.X` 永远为 false → `isNewBest` 恒为 false，
// 玩家永远看不到「刷新纪录」。
//
// 实际症状（2026-11-06 联调）：
// 连续提交 undos = 5 / 2 / 4，三次的 isNewBest 全是 false，
// 而 undos=2 那次本该刷新纪录。
func TestScoresBestQueriedBeforeInsert(t *testing.T) {
	cases := []struct {
		file string
		fn   string
		desc string
	}{
		{"challenge.go", "func ChallengeHandler", "经典挑战"},
		{"cover_handler.go", "func CoverChallengeHandler", "cover 挑战"},
	}
	for _, c := range cases {
		b, err := os.ReadFile(c.file)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", c.file, err)
		}
		src := string(b)

		// 只看该 handler 函数体内的语句 ——
		// cover_handler.go 里有两个写 scores 的地方（进度上报 + 挑战），
		// 不切函数范围会匹配错。
		fnIdx := strings.Index(src, c.fn)
		if fnIdx < 0 {
			t.Errorf("%s 找不到 %s", c.file, c.fn)
			continue
		}
		body := src[fnIdx:]

		insIdx := strings.Index(body, "INSERT INTO scores")
		selIdx := strings.Index(body, "FROM scores")
		if insIdx < 0 || selIdx < 0 {
			t.Errorf("%s 应同时有写 scores 与查 scores", c.desc)
			continue
		}
		if selIdx > insIdx {
			t.Errorf("%s：查历史最佳(位置 %d) 必须早于写流水(位置 %d)，否则 isNewBest 恒为 false",
				c.desc, selIdx, insIdx)
		}
	}
}

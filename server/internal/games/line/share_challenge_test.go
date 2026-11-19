package line

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestChallengeOutcomeComesFromServer 锁定「挑战胜负由服务端判定」。
//
// ## 这条测试守的是什么
//
// 在此之前，胜负是**客户端**按分享链接里的 `undos` 参数自己比的：
//
//	?l=47&undos=0   →  客户端读 undos=0  →  myUndos <= 0  →  宣布「挑战成功」
//
// 而 query 是链接的一部分，好友把 `undos` 改成 0 就赢了。胜负成了一个
// 由 URL 参数决定的量 —— 那它根本不是成绩。
//
// 现在对手成绩只能从 `challenges` 表里按 token 取。
// 这条测试盯住三件事：
//
//  1. 结算响应里的 `challenge.win` 必须来自 `resolveChallenge`（服务端）；
//  2. `resolveChallenge` 的对手分必须来自 `SELECT ... FROM challenges`；
//  3. 判定里**不能**出现 `challenge.fromUndos` 这类来自请求的对手分。
func TestChallengeOutcomeComesFromServer(t *testing.T) {
	b, err := os.ReadFile("cover_handler.go")
	if err != nil {
		t.Fatalf("读取 cover_handler.go 失败: %v", err)
	}
	src := string(b)

	// ① 结算响应里必须有 challenge 字段
	if !strings.Contains(src, `resp["challenge"] = challengeOut`) {
		t.Error("CoverChallengeHandler 的响应里没有 challenge 字段 —— 客户端拿不到服务端判定")
	}

	// ② 对手分必须从 challenges 表查
	fnIdx := strings.Index(src, "func resolveChallenge")
	if fnIdx < 0 {
		t.Fatal("找不到 resolveChallenge —— 挑战判定必须有独立的服务端实现")
	}
	body := src[fnIdx:]
	if end := strings.Index(body, "\n// "); end > 0 {
		body = body[:end]
	}
	if !strings.Contains(body, "FROM challenges") {
		t.Error("resolveChallenge 没有从 challenges 表读对手成绩 —— 说明对手分可能来自请求参数")
	}
	if !strings.Contains(body, "from_undos") {
		t.Error("resolveChallenge 没有读 from_undos 列")
	}
}

// TestChallengeIgnoresClientScore 锁定请求体里不接收「对手成绩」。
//
// 请求结构 `coverLevelReq` 里只能有**自己的**分数与 token，
// 不能有 `fromUndos` / `rivalUndos` 这种字段 ——
// 一旦有了，客户端就能直接告诉服务端「我对手是 99 次重来」。
func TestChallengeIgnoresClientScore(t *testing.T) {
	b, err := os.ReadFile("cover_handler.go")
	if err != nil {
		t.Fatalf("读取 cover_handler.go 失败: %v", err)
	}
	src := string(b)

	start := strings.Index(src, "type coverLevelReq struct")
	if start < 0 {
		t.Fatal("找不到 coverLevelReq")
	}
	end := strings.Index(src[start:], "}")
	if end < 0 {
		t.Fatal("coverLevelReq 结构体未闭合")
	}
	structSrc := src[start : start+end]

	// 只看**字段声明行**（含 json tag 的那几行），不扫注释 ——
	// 结构体上方的大段注释里正是在解释「为什么不能有 fromUndos」，
	// 直接全文匹配会把解释本身当成罪证。
	for _, line := range strings.Split(structSrc, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.Contains(trimmed, "json:") {
			continue
		}
		for _, forbidden := range []string{"fromUndos", "rivalUndos", "opponent", "fromName"} {
			if strings.Contains(trimmed, forbidden) {
				t.Errorf("coverLevelReq 不应有字段 %q —— 对手信息只能由服务端按 token 查", forbidden)
			}
		}
	}
	if !strings.Contains(structSrc, "Token") {
		t.Error("coverLevelReq 缺少 Token 字段，挑战局无法关联到服务端记录")
	}
}

// TestShareChallengeTokenIsUnguessable 锁定 token 是足够长的随机串。
//
// token 会出现在分享链接里。可枚举的 id（1、2、3…）等于把全部挑战
// 摊开给人翻；太短则在生日界下容易被撞出来。
func TestShareChallengeTokenIsUnguessable(t *testing.T) {
	b, err := os.ReadFile("share_challenge.go")
	if err != nil {
		t.Fatalf("读取 share_challenge.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "crypto/rand") {
		t.Error("token 必须来自 crypto/rand —— math/rand 是可预测的")
	}
	// 20 字节 = 160 bit。少于 16 字节（128 bit）就偏薄了。
	if !strings.Contains(src, "challengeTokenBytes = 20") {
		t.Error("token 熵不足：期望 20 字节（160 bit）")
	}
	if !strings.Contains(src, "base32") {
		t.Error("token 应使用 base32 —— base64 的 +/= 在 URL query 里要额外转义")
	}
}

// TestChallengeMigrationIsIdempotent 锁定迁移可重复执行。
//
// core/migrate.go **不记已执行版本**，每次启动都把所有 .sql 逐条 Exec。
// 所以任何一句不带 IF NOT EXISTS 的 DDL 都会让第二次启动直接失败，
// 整个服务起不来。
func TestChallengeMigrationIsIdempotent(t *testing.T) {
	p := filepath.Join("..", "..", "..", "migrations", "007_share_challenge.sql")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读取迁移失败: %v", err)
	}
	sql := string(b)

	// 所有 CREATE 都必须带 IF NOT EXISTS
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(strings.ToUpper(trimmed), "CREATE ") {
			continue
		}
		if !strings.Contains(strings.ToUpper(trimmed), "IF NOT EXISTS") {
			t.Errorf("迁移含非幂等 DDL（第二次启动会失败）：%s", trimmed)
		}
	}

	// 表与关键列
	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS challenges",
		"CREATE TABLE IF NOT EXISTS challenge_results",
		"from_undos",
		"token",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("迁移缺少 %q", want)
		}
	}
}

// TestInviteSentinelIsNotZero 锁定「不带成绩」用的是 -1 而不是 0。
//
// 0 次重来是**最好**的成绩（三星）。如果用它表示「这次分享没带成绩」，
// 那么一次纯邀请会被写成「我零重来通关」—— 好友打开看到的是
// 一个发起人根本没拿到的分数，而且他几乎必输。
func TestInviteSentinelIsNotZero(t *testing.T) {
	b, err := os.ReadFile("share_challenge.go")
	if err != nil {
		t.Fatalf("读取 share_challenge.go 失败: %v", err)
	}
	src := string(b)

	if !strings.Contains(src, "challengeNoScore = -1") {
		t.Error("「不带成绩」的哨兵必须是 -1，不能用 0（0 是最优成绩，语义相反）")
	}
	// 邀请分支必须真的用哨兵，而不是顺手写个 0。
	// 初始化为哨兵（`undos := challengeNoScore`）或显式赋值都算。
	if !strings.Contains(src, "challengeNoScore") {
		t.Error("share_challenge.go 根本没用到 challengeNoScore")
	}
	if !strings.Contains(src, "= challengeNoScore") {
		t.Error("请求没带 undos 时应落到 challengeNoScore(-1)，而不是默认 0")
	}
}

// TestChallengeLevelMustMatch 锁定「挑战关号必须与提交关号一致」。
//
// 链接里 `l=` 和 `c=` 是两个参数，可以被分别改动。
// 不校验的话，拿 A 关的成绩去比 B 关的对手分，判定毫无意义。
func TestChallengeLevelMustMatch(t *testing.T) {
	b, err := os.ReadFile("cover_handler.go")
	if err != nil {
		t.Fatalf("读取 cover_handler.go 失败: %v", err)
	}
	src := string(b)

	fnIdx := strings.Index(src, "func resolveChallenge")
	if fnIdx < 0 {
		t.Fatal("找不到 resolveChallenge")
	}
	body := src[fnIdx:]
	if !strings.Contains(body, "levelIdx != req.LevelIdx") {
		t.Error("resolveChallenge 未校验「挑战关号 == 提交关号」，改 l= 就能拿别关的成绩来比")
	}
}

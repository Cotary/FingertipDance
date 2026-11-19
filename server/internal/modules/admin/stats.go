// Package admin 提供数据后台：登录、统计查询、页面渲染。
//
// ## 设计原则
//
// 后台是**运维工具**，不是产品。所以：
//
//  1. **只读**（除广告数据同步/补录）：后台不改玩家数据。
//     一个能改数据的后台，迟早会因为误操作改坏生产数据。
//  2. **服务端渲染**：没有前端构建步骤，改一行 HTML 刷新就见效。
//  3. **口径写死在 SQL 里并注释**：同一个数字在总览和分平台页
//     必须是同一个算法，否则运营会拿着两个页面互相矛盾的数字来问。
package admin

import (
	"database/sql"
	"time"

	"github.com/tupss/f-game/server/internal/core"
)

// 平台编号（与 profile 包的常量、迁移 008 一致）。
const (
	PlatformUnknown = 0
	PlatformWechat  = 1
	PlatformDouyin  = 2
	PlatformWeb     = 3
)

// PlatformName 把平台码转成展示名。
func PlatformName(code int) string {
	switch code {
	case PlatformWechat:
		return "微信"
	case PlatformDouyin:
		return "抖音"
	case PlatformWeb:
		return "Web"
	default:
		return "未知"
	}
}

// Overview 是总览页的数据。
type Overview struct {
	// 注册与活跃
	TotalUsers  int64
	NewToday    int64
	NewYesterday int64
	DAUToday    int64
	ActiveLast7 int64
	// 留存：次留 = 昨天新增的用户里，今天有登录动作的比例
	RetentionD1 float64
	// 玩法
	TotalPasses  int64 // 累计通关记录数（level_records）
	TotalPlayers int64 // 有通关记录的去重玩家数
	AvgMaxLevel  float64
	// 广告
	AdRevenueFenToday int64
	AdRevenueFenTotal int64
	AdImpressions     int64
	AdClicks          int64
	// 数据新鲜度（最近一次广告同步时间；零值 = 从未同步）
	AdSyncedAt time.Time
}

// PlatformRow 是分平台的一行。
type PlatformRow struct {
	Code        int
	Name        string
	TotalUsers  int64
	NewToday    int64
	DAUToday    int64
	AvgMaxLevel float64
	PassCount   int64
	AdRevenueFen int64
}

// LoadOverview 查总览数据。
//
// ## 「活跃」的口径
//
// 用 `users.last_login_at`，不是埋点表。
// 理由：埋点是**匿名可写**的（uid=0 那批 join 不到用户），
// 用它算 DAU 会把匿名事件漏掉；而 last_login_at 每个登录都会更新，
// 是「这个人今天来过」最直接的证据。
//
// 代价：如果玩家一直不关游戏跨过零点，last_login_at 不会更新 ——
// 极少数情况，可以接受（真正跨零点的玩家次日也会重连）。
func LoadOverview(db *core.DB) (*Overview, error) {
	o := &Overview{}
	now := time.Now()
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")

	// 注册总数
	if err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&o.TotalUsers); err != nil {
		return nil, err
	}
	// 今日 / 昨日新增（按 created_at 的日期）
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE created_at::date = $1::date", today,
	).Scan(&o.NewToday); err != nil {
		return nil, err
	}
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE created_at::date = $1::date", yesterday,
	).Scan(&o.NewYesterday); err != nil {
		return nil, err
	}
	// 今日活跃（登录过的去重用户）
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE last_login_at::date = $1::date", today,
	).Scan(&o.DAUToday); err != nil {
		return nil, err
	}
	// 近 7 天活跃
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE last_login_at >= $1::date", now.AddDate(0, 0, -6).Format("2006-01-02"),
	).Scan(&o.ActiveLast7); err != nil {
		return nil, err
	}

	// ── 次留 ──
	//
	// 分子 = 昨天注册、且今天登录过的人数
	// 分母 = 昨天注册的总人数
	//
	// 用 `created_at::date` 与 `last_login_at::date` 比较而不是 timestamp，
	// 因为「留存」是**按日**的概念：昨天 23:59 注册、今天 00:01 登录，
	// 就是次日留存，哪怕只隔了两分钟。
	var d1Num, d1Den int64
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE created_at::date = $1::date AND last_login_at::date >= $2::date",
		yesterday, today,
	).Scan(&d1Num); err != nil {
		return nil, err
	}
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE created_at::date = $1::date", yesterday,
	).Scan(&d1Den); err != nil {
		return nil, err
	}
	if d1Den > 0 {
		o.RetentionD1 = float64(d1Num) / float64(d1Den) * 100
	}

	// 玩法：通关记录数（cover 模式的记录表）
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM level_records WHERE mode=1 AND skipped=0",
	).Scan(&o.TotalPasses); err != nil {
		return nil, err
	}
	if err := db.QueryRow(
		"SELECT COUNT(DISTINCT uid) FROM level_records WHERE mode=1 AND skipped=0",
	).Scan(&o.TotalPlayers); err != nil {
		return nil, err
	}
	// 平均最高关卡：只算「真的玩过」的人（max_level > 0），
	// 否则注册完就走的 0 会把均值拉低到没有意义。
	if err := db.QueryRow(
		"SELECT COALESCE(AVG(max_level), 0) FROM users WHERE max_level > 0",
	).Scan(&o.AvgMaxLevel); err != nil {
		return nil, err
	}

	// 广告收益
	if err := db.QueryRow(
		"SELECT COALESCE(SUM(revenue_fen),0) FROM ad_revenue WHERE day = $1::date", today,
	).Scan(&o.AdRevenueFenToday); err != nil {
		return nil, err
	}
	if err := db.QueryRow(
		"SELECT COALESCE(SUM(revenue_fen),0), COALESCE(SUM(impressions),0), COALESCE(SUM(clicks),0) FROM ad_revenue",
	).Scan(&o.AdRevenueFenTotal, &o.AdImpressions, &o.AdClicks); err != nil {
		return nil, err
	}
	var syncedAt sql.NullTime
	if err := db.QueryRow("SELECT MAX(fetched_at) FROM ad_revenue").Scan(&syncedAt); err != nil {
		return nil, err
	}
	if syncedAt.Valid {
		o.AdSyncedAt = syncedAt.Time
	}

	return o, nil
}

// LoadPlatforms 查分平台统计。
//
// 一次查询出所有平台的对比，避免 N+1（三个平台就三条查询 → 一条）。
func LoadPlatforms(db *core.DB) ([]PlatformRow, error) {
	now := time.Now()
	today := now.Format("2006-01-02")

	const q = `
SELECT
  u.platform,
  COUNT(*)                                                   AS total_users,
  COUNT(*) FILTER (WHERE u.created_at::date = $1::date)      AS new_today,
  COUNT(*) FILTER (WHERE u.last_login_at::date = $1::date)   AS dau_today,
  COALESCE(AVG(u.max_level) FILTER (WHERE u.max_level > 0),0) AS avg_max_level,
  COALESCE((
    SELECT COUNT(*) FROM level_records lr
    WHERE lr.mode=1 AND lr.skipped=0
      AND lr.uid IN (SELECT id FROM users u2 WHERE u2.platform = u.platform)
  ),0) AS pass_count
FROM users u
GROUP BY u.platform
ORDER BY total_users DESC`

	rows, err := db.Query(q, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PlatformRow
	for rows.Next() {
		var r PlatformRow
		if err := rows.Scan(&r.Code, &r.TotalUsers, &r.NewToday, &r.DAUToday, &r.AvgMaxLevel, &r.PassCount); err != nil {
			return nil, err
		}
		r.Name = PlatformName(r.Code)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 广告收益按平台汇总（单独一次查询，因为表不同）
	revRows, err := db.Query(
		"SELECT platform, COALESCE(SUM(revenue_fen),0) FROM ad_revenue GROUP BY platform",
	)
	if err != nil {
		return nil, err
	}
	defer revRows.Close()
	revByPlat := map[int]int64{}
	for revRows.Next() {
		var p int
		var v int64
		if err := revRows.Scan(&p, &v); err != nil {
			return nil, err
		}
		revByPlat[p] = v
	}
	for i := range out {
		out[i].AdRevenueFen = revByPlat[out[i].Code]
	}
	return out, nil
}

// LevelStat 是单关的统计。
type LevelStat struct {
	LevelIdx   int
	Players    int64   // 通关过这一关的去重玩家数
	AvgUndos   float64 // 平均重来次数
	ZeroUndos  int64   // 零重来（三星）人数
	SkipCount  int64   // 跳过人数
	PassRate   float64 // 通关率 = 通过人数 / 到达这一关的人数
}

// LoadLevels 查每关详情。
//
// ## 通关率的分母是什么
//
// 「到达这一关」= `max_level >= levelIdx - 1`（打到了前一关）。
// 用 `max_level >= levelIdx` 当分母的话，已经通关的人不算「到达」，
// 通关率会永远是 100%，毫无意义。
//
// limit 控制返回条数（关数多，后台只显示前 N 个「有问题」的关）。
func LoadLevels(db *core.DB, limit int) ([]LevelStat, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	const q = `
SELECT
  lr.level_idx,
  COUNT(DISTINCT lr.uid)                                    AS players,
  COALESCE(AVG(lr.undos),0)                                 AS avg_undos,
  COUNT(*) FILTER (WHERE lr.undos = 0)                      AS zero_undos
FROM level_records lr
WHERE lr.mode = 1 AND lr.skipped = 0
GROUP BY lr.level_idx
ORDER BY lr.level_idx
LIMIT $1`

	rows, err := db.Query(q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LevelStat
	for rows.Next() {
		var s LevelStat
		if err := rows.Scan(&s.LevelIdx, &s.Players, &s.AvgUndos, &s.ZeroUndos); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 补跳过人数与通关率（每关两次小查询；关数受 limit 限制，不会失控）
	for i := range out {
		lv := out[i].LevelIdx
		_ = db.QueryRow(
			"SELECT COUNT(DISTINCT uid) FROM level_records WHERE mode=1 AND level_idx=$1 AND skipped=1", lv,
		).Scan(&out[i].SkipCount)

		var reached int64
		_ = db.QueryRow(
			"SELECT COUNT(*) FROM users WHERE max_level >= $1", lv-1,
		).Scan(&reached)
		if reached > 0 {
			out[i].PassRate = float64(out[i].Players) / float64(reached) * 100
		}
	}
	return out, nil
}

// PlayerRow 是玩家列表的一行。
type PlayerRow struct {
	ID         int64
	Nickname   string
	Platform   int
	PlatformName string
	MaxLevel   int
	TotalSteps int64
	TotalTimeMs int64
	StarCount  int64
	CreatedAt  time.Time
	LastLogin  time.Time
}

// PlayerFilter 是玩家列表的筛选条件。
type PlayerFilter struct {
	// Platform 0 = 全部
	Platform int
	// Search 按昵称或 uid 模糊匹配（空 = 不筛）
	Search string
	// Page 从 1 开始
	Page int
	// Size 每页条数（默认 50，上限 200）
	Size int
}

// LoadPlayers 分页查玩家列表，并返回总数。
func LoadPlayers(db *core.DB, f PlayerFilter) ([]PlayerRow, int64, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Size <= 0 {
		f.Size = 50
	}
	if f.Size > 200 {
		f.Size = 200
	}

	// 动态 WHERE：只拼条件，值一律走占位符
	where := "WHERE 1=1"
	args := []interface{}{}
	n := 1
	if f.Platform > 0 {
		where += " AND u.platform = $" + itoa(n)
		args = append(args, f.Platform)
		n++
	}
	if f.Search != "" {
		// 昵称模糊 或 uid 精确
		where += " AND (u.nickname ILIKE $" + itoa(n) + " OR CAST(u.id AS TEXT) = $" + itoa(n+1) + ")"
		args = append(args, "%"+f.Search+"%", f.Search)
		n += 2
	}

	var total int64
	if err := db.QueryRow("SELECT COUNT(*) FROM users u "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
SELECT u.id, u.nickname, u.platform, u.max_level, u.total_steps, u.total_time_ms,
       COALESCE((SELECT COUNT(*) FROM level_records lr
                 WHERE lr.uid=u.id AND lr.mode=1 AND lr.skipped=0 AND lr.undos=0),0) AS three_star,
       u.created_at, u.last_login_at
FROM users u ` + where + `
ORDER BY u.last_login_at DESC
LIMIT $` + itoa(n) + ` OFFSET $` + itoa(n+1)
	args = append(args, f.Size, (f.Page-1)*f.Size)

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []PlayerRow
	for rows.Next() {
		var r PlayerRow
		if err := rows.Scan(&r.ID, &r.Nickname, &r.Platform, &r.MaxLevel, &r.TotalSteps,
			&r.TotalTimeMs, &r.StarCount, &r.CreatedAt, &r.LastLogin); err != nil {
			return nil, 0, err
		}
		r.PlatformName = PlatformName(r.Platform)
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// PlayerDetail 是玩家详情。
type PlayerDetail struct {
	PlayerRow
	PassCount   int64
	SkipCount   int64
	UndoTotal   int64
	AdWatchCnt  int64
	RecentLevels []PlayerLevelRow
	ChallengeWins int64
	ChallengeLoses int64
}

// PlayerLevelRow 是玩家最近打过的关。
type PlayerLevelRow struct {
	LevelIdx int
	Undos    int
	TimeMs   int
	Skipped  bool
	CreatedAt time.Time
}

// LoadPlayerDetail 查单个玩家的详情。
func LoadPlayerDetail(db *core.DB, uid int64) (*PlayerDetail, error) {
	// 先查基本信息（复用列表的单行逻辑）
	const q = `
SELECT u.id, u.nickname, u.platform, u.max_level, u.total_steps, u.total_time_ms,
       u.created_at, u.last_login_at, u.ad_watch_cnt
FROM users u WHERE u.id = $1`
	var d PlayerDetail
	if err := db.QueryRow(q, uid).Scan(&d.ID, &d.Nickname, &d.Platform, &d.MaxLevel,
		&d.TotalSteps, &d.TotalTimeMs, &d.CreatedAt, &d.LastLogin, &d.AdWatchCnt); err != nil {
		return nil, err
	}
	d.PlatformName = PlatformName(d.Platform)

	_ = db.QueryRow("SELECT COUNT(*) FROM level_records WHERE uid=$1 AND mode=1 AND skipped=0", uid).Scan(&d.PassCount)
	_ = db.QueryRow("SELECT COUNT(*) FROM level_records WHERE uid=$1 AND mode=1 AND skipped=1", uid).Scan(&d.SkipCount)
	_ = db.QueryRow("SELECT COALESCE(SUM(undos),0) FROM level_records WHERE uid=$1 AND mode=1", uid).Scan(&d.UndoTotal)
	_ = db.QueryRow("SELECT COUNT(*) FROM challenge_results WHERE uid=$1 AND win=true", uid).Scan(&d.ChallengeWins)
	_ = db.QueryRow("SELECT COUNT(*) FROM challenge_results WHERE uid=$1 AND win=false", uid).Scan(&d.ChallengeLoses)

	rows, err := db.Query(`
SELECT level_idx, undos, time_ms, skipped, created_at
FROM level_records WHERE uid=$1 AND mode=1
ORDER BY created_at DESC LIMIT 20`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r PlayerLevelRow
		var skipped int
		if err := rows.Scan(&r.LevelIdx, &r.Undos, &r.TimeMs, &skipped, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Skipped = skipped == 1
		d.RecentLevels = append(d.RecentLevels, r)
	}
	return &d, rows.Err()
}

// AdRow 是广告数据的一行。
type AdRow struct {
	Platform    int
	PlatformName string
	Day         time.Time
	AdType      string
	Placement   string
	Impressions int64
	Clicks      int64
	RevenueFen  int64
	Source      string
}

// LoadAds 查广告数据（按日期倒序）。
func LoadAds(db *core.DB, days int) ([]AdRow, error) {
	if days <= 0 || days > 365 {
		days = 30
	}
	rows, err := db.Query(`
SELECT platform, day, ad_type, placement, impressions, clicks, revenue_fen, source
FROM ad_revenue
WHERE day >= CURRENT_DATE - $1::int
ORDER BY day DESC, platform, placement`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AdRow
	for rows.Next() {
		var r AdRow
		if err := rows.Scan(&r.Platform, &r.Day, &r.AdType, &r.Placement,
			&r.Impressions, &r.Clicks, &r.RevenueFen, &r.Source); err != nil {
			return nil, err
		}
		r.PlatformName = PlatformName(r.Platform)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ProgressBucket 是进度分布的一段。
type ProgressBucket struct {
	Label string
	Count int64
}

// LoadProgressHistogram 查关卡进度分布（总览页的直方图）。
//
// 分段按「新手 / 早 / 中 / 后 / 深」划，是为了回答
// 「玩家集中在哪一段」和「哪一段开始掉人」。
func LoadProgressHistogram(db *core.DB) ([]ProgressBucket, error) {
	const q = `
SELECT
  COUNT(*) FILTER (WHERE max_level = 0)                AS zero,
  COUNT(*) FILTER (WHERE max_level BETWEEN 1 AND 10)   AS b1,
  COUNT(*) FILTER (WHERE max_level BETWEEN 11 AND 50)  AS b2,
  COUNT(*) FILTER (WHERE max_level BETWEEN 51 AND 200) AS b3,
  COUNT(*) FILTER (WHERE max_level BETWEEN 201 AND 500) AS b4,
  COUNT(*) FILTER (WHERE max_level > 500)              AS b5
FROM users`
	var zero, b1, b2, b3, b4, b5 int64
	if err := db.QueryRow(q).Scan(&zero, &b1, &b2, &b3, &b4, &b5); err != nil {
		return nil, err
	}
	return []ProgressBucket{
		{"未开始", zero},
		{"1-10", b1},
		{"11-50", b2},
		{"51-200", b3},
		{"201-500", b4},
		{"500+", b5},
	}, nil
}

// itoa 是小整数转字符串（避免为拼占位符引入 strconv 的噪音）。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [8]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

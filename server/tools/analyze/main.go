// 埋点数据分析脚本。用于上线后快速查看漏斗。
// 用法：DB_DSN="postgres://fgame:fgame@127.0.0.1:15432/fgame?sslmode=disable" go run ./tools/analyze
package main

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		dsn = "postgres://fgame:fgame@127.0.0.1:15432/fgame?sslmode=disable"
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		fmt.Println("连接失败:", err)
		os.Exit(1)
	}
	defer db.Close()

	fmt.Println("========== 关卡漏斗 ==========")
	printLevelFunnel(db)

	fmt.Println("\n========== 广告漏斗 ==========")
	printAdFunnel(db)

	fmt.Println("\n========== 分享漏斗 ==========")
	printShareFunnel(db)

	fmt.Println("\n========== 皮肤解锁 ==========")
	printSkinFunnel(db)
}

// printLevelFunnel 打印每关的开始/通过/失败率。
func printLevelFunnel(db *sql.DB) {
	rows, err := db.Query(`
		SELECT
		  params->>'level_idx' AS lvl,
		  SUM(CASE WHEN name='level_start' THEN 1 ELSE 0 END) AS starts,
		  SUM(CASE WHEN name='level_pass' THEN 1 ELSE 0 END) AS passes,
		  SUM(CASE WHEN name='level_fail' THEN 1 ELSE 0 END) AS fails
		FROM events
		WHERE name IN ('level_start','level_pass','level_fail')
		GROUP BY lvl ORDER BY lvl
	`)
	if err != nil {
		fmt.Println("查询失败:", err)
		return
	}
	defer rows.Close()

	fmt.Printf("%-8s %-8s %-8s %-10s %-10s\n", "关卡", "开始", "通过", "通过率", "失败率")
	for rows.Next() {
		var lvl sql.NullInt64
		var starts, passes, fails sql.NullInt64
		if err := rows.Scan(&lvl, &starts, &passes, &fails); err != nil {
			continue
		}
		passRate := 0.0
		if starts.Int64 > 0 {
			passRate = float64(passes.Int64) / float64(starts.Int64) * 100
		}
		failRate := 0.0
		if starts.Int64 > 0 {
			failRate = float64(fails.Int64) / float64(starts.Int64) * 100
		}
		fmt.Printf("%-8d %-8d %-8d %-9.1f%% %-9.1f%%\n",
			lvl.Int64, starts.Int64, passes.Int64, passRate, failRate)
	}
}

// printAdFunnel 打印广告完播率。
func printAdFunnel(db *sql.DB) {
	rows, err := db.Query(`
		SELECT
		  params->>'placement' AS placement,
		  SUM(CASE WHEN name='ad_start' THEN 1 ELSE 0 END) AS starts,
		  SUM(CASE WHEN name='ad_complete' THEN 1 ELSE 0 END) AS completes,
		  SUM(CASE WHEN name='ad_abort' THEN 1 ELSE 0 END) AS aborts
		FROM events
		WHERE name LIKE 'ad_%'
		GROUP BY placement
	`)
	if err != nil {
		fmt.Println("查询失败:", err)
		return
	}
	defer rows.Close()

	fmt.Printf("%-22s %-8s %-8s %-8s %-10s\n", "广告位", "开始", "完成", "中断", "完播率")
	for rows.Next() {
		var placement sql.NullString
		var starts, completes, aborts sql.NullInt64
		if err := rows.Scan(&placement, &starts, &completes, &aborts); err != nil {
			continue
		}
		rate := 0.0
		if starts.Int64 > 0 {
			rate = float64(completes.Int64) / float64(starts.Int64) * 100
		}
		fmt.Printf("%-22s %-8d %-8d %-8d %-9.1f%%\n",
			placement.String, starts.Int64, completes.Int64, aborts.Int64, rate)
	}
}

// printShareFunnel 打印分享漏斗。
func printShareFunnel(db *sql.DB) {
	rows, err := db.Query(`
		SELECT name, COUNT(*) FROM events
		WHERE name IN ('share_click','share_success','challenge_start','challenge_result')
		GROUP BY name
	`)
	if err != nil {
		fmt.Println("查询失败:", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var cnt int64
		if err := rows.Scan(&name, &cnt); err != nil {
			continue
		}
		fmt.Printf("%-20s %d\n", name, cnt)
	}
}

// printSkinFunnel 打印皮肤解锁分布。
func printSkinFunnel(db *sql.DB) {
	rows, err := db.Query(`
		SELECT params->>'via' AS via, COUNT(*)
		FROM events WHERE name='skin_unlock' GROUP BY via
	`)
	if err != nil {
		fmt.Println("查询失败:", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var via sql.NullString
		var cnt int64
		if err := rows.Scan(&via, &cnt); err != nil {
			continue
		}
		fmt.Printf("解锁方式 %-12s %d 次\n", via.String, cnt)
	}

	// 当前持有皮肤分布
	fmt.Println("\n当前玩家皮肤持有分布：")
	rows2, err := db.Query(`
		SELECT jsonb_array_length(unlocked_skins) AS cnt, COUNT(*) AS players
		FROM users GROUP BY cnt ORDER BY cnt
	`)
	if err != nil {
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var cnt, players int64
		if err := rows2.Scan(&cnt, &players); err != nil {
			continue
		}
		fmt.Printf("  %2d 个皮肤: %d 人\n", cnt, players)
	}
}

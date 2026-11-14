package line

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// isNoRows 判断错误是否为「查询无结果」。
func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

// splitComma 按逗号切分字符串。
func splitComma(s string) []string {
	return strings.Split(s, ",")
}

// atoiSafe 解析十进制整数，出错时返回错误。
func atoiSafe(s string) (int, error) {
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, err
	}
	return v, nil
}

// lockUserRow 对 `users` 表的某一行加排他锁（`SELECT ... FOR UPDATE`）。
//
// ## 用途
//
// 把「读出来 → 算一下 → 写回去」的临界区串行化。
// 涉及的地方：
//
//   - `applyCoverProgress`：`level_records` 的 firstPass 判定 + `INSERT`
//   - `applyCoverProgress`：`users.total_steps` / `total_time_ms` 累加
//   - `grantSkinForLevel`：`users.unlocked_skins` 的整体读-改-写
//
// ## 为什么锁 `users` 而不是 `level_records`
//
// `level_records` 的行在**首次通关前根本不存在**，锁不住（`FOR UPDATE` 锁不到不存在的行）。
// 而 `users` 行一定存在（登录即创建），且所有这些写入最终都要落到 `users` 上，
// 锁它是唯一稳定的选择。
//
// 粒度是**单个玩家**：同一 uid 的并发请求排队，不同玩家互不阻塞。
func lockUserRow(tx *sql.Tx, uid int64) error {
	var id int64
	err := tx.QueryRow("SELECT id FROM users WHERE id=$1 FOR UPDATE", uid).Scan(&id)
	if err != nil {
		if isNoRows(err) {
			return fmt.Errorf("用户不存在: uid=%d", uid)
		}
		return fmt.Errorf("锁定用户行: %w", err)
	}
	return nil
}

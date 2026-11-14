package line

import (
	"database/sql"
	"fmt"
)

// grantSkinForLevel 给玩家发放某关关联的皮肤（若未解锁）。
//
// **两种模式共用** —— 经典模式的关卡表带 `unlockSkin`，
// cover 模式的关卡表也带（由生成工具写入），
// 发皮肤的规则不应该有两份实现 ——
// 之前 cover 模式直接抄了一份逻辑但**漏了 unlockSkin 字段**，
// 结果 premium 三款（黄金/星尘/星河）在 cover 模式下永远拿不到。
//
// @param tx         事务
// @param uid        用户 id
// @param skinID     皮肤 id（空字符串 / nil = 该关不发皮肤）
// @param skins      皮肤表（用于取中文名）
// @returns 本次新解锁的皮肤（没解锁返回 nil）
func grantSkinForLevel(tx *sql.Tx, uid int64, skinID *string, skins []SkinConfig) (*unlockedSkinInfo, error) {
	if skinID == nil || *skinID == "" {
		return nil, nil
	}

	skinMap := make(map[string]string, len(skins))
	for _, s := range skins {
		skinMap[s.ID] = s.Name
	}

	// ── 原子追加（不再读-改-写）──
	//
	// ## 为什么改成一条 SQL
	//
	// 原来是「SELECT unlocked_skins → Go 里 append → UPDATE 写回整个数组」。
	// 这是典型的 lost update：两个事务同时读到 `["wood","mint"]`，
	// 各自 append 一个不同的皮肤，后写的那个把先写的**整个覆盖掉** ——
	// 玩家会发现「明明刚解锁的皮肤不见了」。
	//
	// 现在用一条带条件的 UPDATE：
	//   - `unlocked_skins @> to_jsonb($1::text)`：已包含该皮肤 → 不更新（行数 0）
	//   - `unlocked_skins || to_jsonb($1::text)`：没包含 → 原子追加
	//
	// Postgres 的 UPDATE 本身带行锁，所以即使没有外层的 `lockUserRow`
	// 也不会丢更新（这里两层保险）。
	//
	// `RowsAffected == 0` = 已经解锁过 → 不重复发，也不上报「本次解锁」。
	res, err := tx.Exec(
		"UPDATE users SET unlocked_skins = unlocked_skins || to_jsonb($1::text) "+
			"WHERE id=$2 AND NOT (unlocked_skins @> to_jsonb($1::text))",
		*skinID, uid,
	)
	if err != nil {
		return nil, fmt.Errorf("写入皮肤: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("写入皮肤: %w", err)
	}
	if n == 0 {
		// 已解锁过（或者用户不存在）
		return nil, nil
	}
	return &unlockedSkinInfo{ID: *skinID, Name: skinMap[*skinID]}, nil
}

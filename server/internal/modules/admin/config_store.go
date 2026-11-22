package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/games/line"
)

// 平台配置的读写层。
//
// ## 为什么放在 admin 包里而不是 line 包
//
// 读侧有两方：后台页面（改）和 `/api/config`（下发）。
// 写侧只有后台。把读写都放 admin、由 line 反过来 import admin 会成环，
// 所以 line 只负责**模型**（结构体 / 默认值 / 归一化），
// SQL 留在这里；`/api/config` 通过注入的读取函数拿数据。
//
// 这不是「完美分层」，但依赖方向是单向的：admin → line。

// platformConfigQueryTimeout 单次配置读写的超时。
//
// 取 3 秒：配置读写是一次主键查询，正常情况下是亚毫秒级。
// 真卡住（连接池耗尽 / 库挂了）时要尽快失败 ——
// `/api/config` 失败会退回默认值，比「客户端启动挂 10 秒」好得多。
const platformConfigQueryTimeout = 3 * time.Second

// LoadPlatformConfig 读取一个平台的配置。
//
// 行不存在、`cfg` 为 `{}`、或者数据库不可用时，都返回**默认值** ——
// 配置读不出来绝不能让游戏起不来。
//
// 返回的 error 只用于后台页面显示（「读取失败」），
// 调用方拿到的 cfg 一定是可用的。
func LoadPlatformConfig(db *core.DB, platform int) (line.PlatformConfig, error) {
	if db == nil {
		return line.DefaultPlatformConfig(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), platformConfigQueryTimeout)
	defer cancel()

	var raw []byte
	err := db.QueryRowContext(ctx,
		`SELECT cfg FROM platform_config WHERE platform=$1`, platform).Scan(&raw)
	if err != nil {
		// sql.ErrNoRows 是正常情况（Web 没预置行）：返回默认值。
		if errors.Is(err, sql.ErrNoRows) {
			return line.DefaultPlatformConfig(), nil
		}
		return line.DefaultPlatformConfig(), err
	}
	cfg, err := line.MergePlatformConfig(raw)
	if err != nil {
		return line.DefaultPlatformConfig(), err
	}
	return cfg, nil
}

// SavePlatformConfig 整行 upsert 一个平台的配置。
//
// **先归一化再入库**：后台表单的输入不可信（负数、超长、非法 URL），
// 脏值一旦落库就会被所有客户端读到，而且下次打开后台还会显示那个脏值 ——
// 谁都以为「它本来就该这样」。
func SavePlatformConfig(db *core.DB, platform int, cfg line.PlatformConfig, who string) error {
	if db == nil {
		return fmt.Errorf("数据库未就绪")
	}
	cfg = cfg.Normalize()
	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("序列化平台配置: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), platformConfigQueryTimeout)
	defer cancel()

	_, err = db.ExecContext(ctx, `
INSERT INTO platform_config (platform, cfg, updated_at, updated_by)
VALUES ($1, $2::jsonb, now(), $3)
ON CONFLICT (platform) DO UPDATE
SET cfg=$2::jsonb, updated_at=now(), updated_by=$3`,
		platform, string(raw), who)
	if err != nil {
		return fmt.Errorf("保存平台配置: %w", err)
	}
	return nil
}

// SavePlatformConfigs 一次保存多个平台（后台「保存全部」）。
//
// ## 为什么必须在一个事务里
//
// 后台是一张表单提交两个平台。逐个 upsert 的话，
// 第二个失败时第一个已经落库 —— 运营看到「保存失败」，
// 但微信那份其实已经改了。这种「一半成功」最难排查：
// 重试会把第一份又写一遍，而两边的值已经不一致。
func SavePlatformConfigs(db *core.DB, cfgs map[int]line.PlatformConfig, who string) error {
	if db == nil {
		return fmt.Errorf("数据库未就绪")
	}
	ctx, cancel := context.WithTimeout(context.Background(), platformConfigQueryTimeout)
	defer cancel()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("开启事务: %w", err)
	}
	// 成功路径会显式 Commit；这里兜底回滚（Rollback 在已提交后是 no-op）
	defer func() { _ = tx.Rollback() }()

	for platform, cfg := range cfgs {
		cfg = cfg.Normalize()
		raw, err := json.Marshal(cfg)
		if err != nil {
			return fmt.Errorf("序列化平台 %d 配置: %w", platform, err)
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO platform_config (platform, cfg, updated_at, updated_by)
VALUES ($1, $2::jsonb, now(), $3)
ON CONFLICT (platform) DO UPDATE
SET cfg=$2::jsonb, updated_at=now(), updated_by=$3`,
			platform, string(raw), who); err != nil {
			return fmt.Errorf("保存平台 %d 配置: %w", platform, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交事务: %w", err)
	}
	return nil
}

// LoadAllPlatformConfigs 读取指定平台的配置（后台页面用）。
//
// 读不到的平台上仍然会出现在 map 里（值为默认值）——
// 后台要能编辑「还没存过的平台」，不能因为它没有行就不显示表单。
func LoadAllPlatformConfigs(db *core.DB, platforms []int) (map[int]line.PlatformConfig, []error) {
	out := make(map[int]line.PlatformConfig, len(platforms))
	var errs []error
	for _, p := range platforms {
		cfg, err := LoadPlatformConfig(db, p)
		if err != nil {
			errs = append(errs, fmt.Errorf("平台 %d: %w", p, err))
		}
		out[p] = cfg
	}
	return out, errs
}

// PlatformConfigUpdatedAt 返回每个平台最近一次修改时间（后台显示用）。
//
// 单独一条查询而不是塞进 LoadAllPlatformConfigs：
// `updated_by` / `updated_at` 是审计信息，游戏侧不需要，
// 混进 PlatformConfig 会让下发结构里多出两个客户端用不到的字段。
func PlatformConfigUpdatedAt(db *core.DB) map[int]struct {
	At  time.Time
	Who string
} {
	out := map[int]struct {
		At  time.Time
		Who string
	}{}
	if db == nil {
		return out
	}
	ctx, cancel := context.WithTimeout(context.Background(), platformConfigQueryTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx, `SELECT platform, updated_at, updated_by FROM platform_config`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var p int
		var at time.Time
		var who string
		if err := rows.Scan(&p, &at, &who); err != nil {
			continue
		}
		out[p] = struct {
			At  time.Time
			Who string
		}{At: at, Who: who}
	}
	return out
}

-- 004_cover_scores.sql — scores 流水表补 mode / undos 两列
--
-- ## 为什么需要
--
-- `scores` 是**成绩流水表**（每次通关/挑战都追加一行），
-- 挑战接口要拿它算「历史最佳」：
--
--   - 经典模式（`/api/challenge`）：按 **steps** 最小排序
--   - cover 模式（`/api/cover/challenge`）：按 **undos** 最小排序
--
-- 但表建出来的时候（001_init.sql）只有 `(uid, level_idx, steps, time_ms)`，
-- 既没有 `undos`（cover 的唯一区分维度），也没有 `mode`（两种模式共用关号空间 1..1000）。
--
-- ## 实际后果（2026-11-06 本地联调发现）
--
-- `/api/cover/challenge` **100% 报 500**：
--
--   ERROR: column "undos" does not exist (SQLSTATE 42703)
--
-- 因为 `CoverChallengeHandler` 里查的是：
--
--   SELECT undos, time_ms FROM scores WHERE level_idx=$1 ORDER BY undos ASC ...
--
-- 列根本不存在 → 查询直接报错 → 挑战功能完全不可用。
--
-- ## 修法
--
-- 1) 加 `undos` 列（经典模式记 0，cover 模式记真实悔棋次数）
-- 2) 加 `mode` 列（0=经典，1=cover），并把历史流水统一标为经典
-- 3) 两种模式的「历史最佳」查询都按 `mode` 过滤 —— 否则同一关的
--    cover 成绩（steps 恒为 required−1）会污染经典的 steps 最佳值
--
-- 注：列都是 `IF NOT EXISTS`，重复执行安全（migrate.go 每次启动都重跑全部迁移）。

ALTER TABLE scores ADD COLUMN IF NOT EXISTS undos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS mode   SMALLINT NOT NULL DEFAULT 0;

-- 历史流水都是经典模式时代写的（cover 上线后才有 mode=1 的写入）
UPDATE scores SET mode = 0 WHERE mode IS NULL;
UPDATE scores SET undos = 0 WHERE undos IS NULL;

-- 查历史最佳会按 (level_idx, mode) 过滤，给这个组合加索引
CREATE INDEX IF NOT EXISTS idx_scores_level_mode ON scores (level_idx, mode);

-- 005_scores_best_index.sql — scores 历史最佳查询索引补 uid
--
-- ## 为什么需要
--
-- 挑战接口查「历史最佳」的 SQL 是：
--
--   SELECT undos, time_ms FROM scores
--    WHERE uid=$1 AND level_idx=$2 AND mode=$3
--    ORDER BY undos ASC, time_ms ASC LIMIT 1
--
-- 过滤条件有三个：`(uid, level_idx, mode)`。
--
-- 但 004 建的索引是 `idx_scores_level_mode ON scores (level_idx, mode)` ——
-- **少了最左边那一列 `uid`**。
--
-- ## 实际后果
--
-- 索引只能用来过滤 `level_idx` 和 `mode`，`uid` 只能作为回表后的过滤条件。
-- 数据量上来后（`scores` 是**流水表**，每次通关/挑战都追加一行，
-- 一个玩家打 1000 关就有 1000 行），会出现：
--
--   - 同一关的所有玩家的记录都要扫一遍才能筛出这一个玩家
--   - 回表行数暴增
--
-- Postgres 只能选一个索引；`(level_idx, mode)` 前缀相同但缺 uid，
-- 无法同时服务「全服该关排行」和「我这关的历史最佳」两种查询。
--
-- ## 修法
--
-- 补一个 `(uid, level_idx, mode)` 的索引，把 `undos, time_ms` 一起带上 ——
-- ORDER BY 也能直接走索引，不用额外排序。

CREATE INDEX IF NOT EXISTS idx_scores_uid_level_mode
  ON scores (uid, level_idx, mode, undos, time_ms);

-- 保留原来的 (level_idx, mode) 索引：全服排行 / 该关所有玩家记录仍要用它。
-- Postgres 可以同时用两个索引（BitmapAnd），不冲突。

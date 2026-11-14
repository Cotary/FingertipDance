-- 003_cover_mode.sql — cover 模式与经典模式的关卡记录分表
--
-- ## 为什么需要 mode 列
--
-- `level_records` 的主键是 `(uid, level_idx)`，而**经典模式与 cover 模式
-- ���同一套关号空间**（都是 1..1000）。
--
-- 在 cover 模式上线前，只有经典模式写这张表，所以主键够用。
-- cover 模式上线后，两种模式会写**同一行**：
--   - 玩家先玩经典模式第 5 关 → 写入 (uid, 5)，steps=9
--   - 再玩 cover 模式第 5 关 → 同一行！INSERT 撞主键 → 走 UPDATE 分支
--
-- 后果不只是「记录混了」，而是**星级会算错**：
-- `/api/progress/stars` 按 `steps / shortest` 算星级，
-- 而 cover 模式的 `shortest` 恒为 `required − 1`（铺满就一定是这个数），
-- 于是 cover 的记录会被当成经典记录去比经典的最短步数 —— 星级完全不对。
--
-- ## 修法
--
-- 加 `mode` 列（0=经典，1=cover），主键改成 `(uid, mode, level_idx)`。
-- 两种模式的记录彻底隔离，各自算各自的星级。

-- 1) 加 mode 列（默认 0 = 经典，兼容历史数据）
ALTER TABLE level_records ADD COLUMN IF NOT EXISTS mode SMALLINT NOT NULL DEFAULT 0;

-- 2) 历史记录统一标为经典模式
UPDATE level_records SET mode = 0 WHERE mode IS NULL;

-- 3) 主键加 mode —— 必须先删旧主键约束再建新的。
--    旧约束名由 PostgreSQL 自动生成（level_records_pkey），显式 DROP 更稳。
ALTER TABLE level_records DROP CONSTRAINT IF EXISTS level_records_pkey;
ALTER TABLE level_records ADD PRIMARY KEY (uid, mode, level_idx);

-- 4) 索引也跟着覆盖（`idx_level` 只按 level_idx 查，与主键无关，保持不变）

-- 5) `skips` 表同理 —— 跳过次数也是按「关」限的，
--    经典第 5 关跳过了不该把 cover 第 5 关的跳过机会也吃掉。
ALTER TABLE skips ADD COLUMN IF NOT EXISTS mode SMALLINT NOT NULL DEFAULT 0;
UPDATE skips SET mode = 0 WHERE mode IS NULL;
ALTER TABLE skips DROP CONSTRAINT IF EXISTS skips_pkey;
ALTER TABLE skips ADD PRIMARY KEY (uid, mode, level_idx, day);

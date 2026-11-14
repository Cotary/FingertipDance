-- 002_cover_undos.sql — cover 模式：关卡记录增加悔棋次数
-- 背景：cover 模式（铺满全盘）的步数恒为 required−1，没有区分度；
--        真正的难度/星级指标是**悔棋次数**（0 次 = 一次想通全程 = 3 星）。

ALTER TABLE level_records ADD COLUMN IF NOT EXISTS undos INTEGER NOT NULL DEFAULT 0;

-- 兼容经典模式：老记录的 undos 视为 0（= 3 星，与旧行为一致）
UPDATE level_records SET undos = 0 WHERE undos IS NULL;
-- 011_tutorial.sql
--
-- 新手引导是否完成。
--
-- ## 为什么要在服务端记，而不只存本地
--
-- 引导关是**前端临时生成**的，不占正式关号，也不写 `level_records` ——
-- 所以它的完成状态**无法从任何已有数据推导**：`max_level` 在引导期间
-- 一直是 0，和"新注册没动过"完全一样。
--
-- 只存本地会有两个问题：
--
--   1. 换设备 / 清缓存后重新弹三关 —— 已经学会的玩家要再走一遍；
--   2. 后台看不出「有多少人卡在引导」—— 这是最重要的一条流失指标，
--      新手引导的完成率通常决定整个游戏的首日留存。
--
-- ## 为什么是布尔而不是完成到第几关
--
-- 引导只有 3 关、一次会话内基本能走完。记「做到第几关」需要在每关
-- 结束时写一次库，而那三次写入对玩家没有任何可见收益。
--
-- 真正需要细分的话，`events` 表里有 `tutorial_step` 埋点（客户端每关上报），
-- 想看漏斗直接查事件流即可 —— 不必在 users 上再开一列。
--
-- 迁移每次启动全跑（`core/migrate.go` 不记版本），所以必须幂等。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tutorial_done BOOLEAN NOT NULL DEFAULT false;

-- 后台"引导完成率"要按平台/日期分组扫，加个部分索引。
-- `WHERE NOT tutorial_done` 才是运营真正会筛的那一群人（卡在引导里的）。
CREATE INDEX IF NOT EXISTS idx_users_tutorial_pending
  ON users (created_at)
  WHERE NOT tutorial_done;

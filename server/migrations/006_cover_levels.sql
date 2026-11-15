-- 006_cover_levels.sql —— cover 关卡表入库（含参考解）
--
-- ## 为什么要有这张表
--
-- 关卡表原先只存在于**文件**里（`server/data/levels-v3.json` + 内嵌一份），
-- 加载方式是「读文件 → 解析 → 塞进内存 map」。
--
-- 这套做法有两个硬伤：
--   1. **不能增量改**：想换掉第 300 关，只能整表重写文件再重启。
--   2. **提示没法 O(1) 查**：提示要的是「玩家当前这条路还剩什么」，
--      答案在参考解里 —— 但参考解只在服务端的内存 map 里，
--      客户端够不着，所以提示只能让**客户端实时求解**。
--
-- ## 这张表解决什么
--
-- 1. **关卡可增量写入**：生成器产出的关卡直接 INSERT / UPSERT，
--    不用整表重写、不用重启。
-- 2. **提示走查表**：参考解随关卡一起入库，
--    服务端按「玩家路径是不是参考解的前缀」O(1) 切出剩余路线。
--
-- ## 为什么参考解存在服务端（不下发客户端）
--
-- 客户端一旦持有解，玩家就能直接读表回放提交当作通关，
-- 提示广告也就形同虚设。所以 `solution` 只进这张表，
-- `/api/levels-v3` 下发时依然剥离（见 cover_handler.go）。
--
-- ## 列的选择
--
-- `grid` / `solution` 都存 base64 文本（与现有 JSON 表同格式），
-- 这样 `decodeCoverGrid` / `DecodeCoverSolution` 直接复用，
-- 不必为 DB 另写一套编解码。

CREATE TABLE IF NOT EXISTS cover_levels (
  idx         INTEGER      PRIMARY KEY,      -- 关号（与客户端关号空间一致）
  version     VARCHAR(64)  NOT NULL DEFAULT '',  -- 关卡表版本号（热更判定用）
  w           INTEGER      NOT NULL,
  h           INTEGER      NOT NULL,
  grid        TEXT         NOT NULL,        -- base64：每格 1 字节 (type<<4)|(dir<<2)|group
  solution    TEXT         NOT NULL,        -- "起点,步数,base64(方向序列)"
  required    INTEGER      NOT NULL,        -- 可走格数
  start_at    INTEGER      NOT NULL,        -- 起点拍平索引（-1 = 自由）
  end_at      INTEGER      NOT NULL,        -- 终点拍平索引（-1 = 自由）
  diff        INTEGER      NOT NULL DEFAULT 0,
  mech_kinds  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL,
  updated_at  TIMESTAMP    NOT NULL
);

-- 按版本查（关卡表热更时只重载某一版）
CREATE INDEX IF NOT EXISTS idx_cover_levels_version ON cover_levels (version);

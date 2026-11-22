-- 012_feedback.sql
--
-- 意见反馈（文字 + 可选截图）。
--
-- ## 为什么截图存 base64 而不是对象存储
--
-- 现在没有对象存储。小游戏上传时只能把图读成 base64 塞进 JSON
-- （没有 FormData / multipart），所以服务端收的本来就是这个形态。
--
-- 存库的代价：单张 200KB 的图 base64 后约 270KB。反馈量小（每天几十条量级），
-- 一张反馈一行，不会把表撑大。真要涨起来再迁到对象存储 ——
-- 那时只需改 `image` 的写入路径，读的那一侧（后台 `img src`）不用动。
--
-- 单个字段加 length 检查：nginx 是 `client_max_body_size 2m`，
-- 这里限 1.5MB 的 base64（≈1.1MB 原图），留出 JSON 其余字段的余量。
--
-- ## 为什么要有 status
--
-- 「看过了」和「没管」必须分开，否则后台列表看不出哪些是新反馈。
-- 运营真正的工作流是：打开 → 看 → 处理/忽略 → 标记。
--
-- 迁移每次启动全跑（`core/migrate.go` 不记版本），所以必须幂等。
CREATE TABLE IF NOT EXISTS feedbacks (
  id          BIGSERIAL    PRIMARY KEY,
  uid         BIGINT       NOT NULL,
  -- 平台快照：玩家换平台后这条仍应显示"当时是从哪来的"
  platform    SMALLINT     NOT NULL DEFAULT 0,
  -- 反馈正文。**不设上限以外的截断** —— 玩家愿意多写就多写，
  -- 但长度在 handler 里限制（见 feedback.go），避免被灌爆。
  content     TEXT         NOT NULL,
  -- 截图（base64，无前缀）。空串 = 没传图。
  image       TEXT         NOT NULL DEFAULT '',
  -- 玩家当时在哪：'home' / 'playing' / 'result' …，方便定位问题
  scene       VARCHAR(32)  NOT NULL DEFAULT '',
  -- 当时的关号（0 = 不在关卡里）
  level_idx   INTEGER      NOT NULL DEFAULT 0,
  -- 客户端版本 / 机型信息（JSON 文本，休闲排查用）
  context     TEXT         NOT NULL DEFAULT '',
  -- 'new' | 'done' | 'ignored'
  status      VARCHAR(16)  NOT NULL DEFAULT 'new',
  created_at  TIMESTAMP    NOT NULL,
  handled_at  TIMESTAMP
);

-- 后台默认按「新反馈优先 + 时间倒序」翻页
CREATE INDEX IF NOT EXISTS idx_feedbacks_status_created
  ON feedbacks (status, created_at DESC);

-- 按玩家查（"这个玩家反馈过什么"）
CREATE INDEX IF NOT EXISTS idx_feedbacks_uid
  ON feedbacks (uid, created_at DESC);

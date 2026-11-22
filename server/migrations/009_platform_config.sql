-- 009_platform_config.sql — 按平台的运营参数（后台可改，客户端按平台拉取）
--
-- ## 为什么这张表是「按平台整块 JSON」而不是一列一个配置
--
-- 微信和抖音的差异是**成片**的：广告位 ID、分享域名、频控、功能开关
-- 各一套，互不相干。一列一列建表意味着每加一个运营参数都要同时改
-- 表结构 + Go 结构体 + 后台表单三处；而这类参数的上线节奏跟着运营走，
-- 不该每次都排一次数据库变更。
--
-- 用 JSONB 整块存，加配置项只动两处：`line.PlatformConfig` 与后台表单。
-- 类型安全由 Go 结构体在反序列化时保证（不是 map[string]any 断言）。
--
-- 为什么不用 `platform_config_key(platform, key, value)`：
-- 每种配置的类型不同（string / int / bool / 数组），
-- 键值行会把类型转换摊到每个读取点，读一次配置要写十行断言。
--
-- ## 预置行为什么是空对象
--
-- **默认值只有一份，在 Go 里**（`line.DefaultPlatformConfig()`）。
-- 这里如果写死一份完整 JSON，将来改默认值就会出现
-- 「代码里 60 秒、库里还是 30 秒」的双真源，而且没人查得出来。
--
-- 空对象 + 读取时「先取默认值再反序列化覆盖」还有个好处：
-- 以后新增字段，老行不需要迁移，自动拿到新默认值。
--
-- ## 迁移是每次启动全跑的
--
-- `core/migrate.go` 不记已执行版本，逐条 Exec 所有 .sql。
-- 所以 DDL 必须幂等（IF NOT EXISTS），INSERT 必须 ON CONFLICT DO NOTHING，
-- 否则每次重启都会把运营改过的配置冲掉。
CREATE TABLE IF NOT EXISTS platform_config (
  -- 1=微信 2=抖音 3=Web（与 users.platform / ad_revenue.platform 同一套编号）
  platform    SMALLINT    PRIMARY KEY,
  -- 该平台的全部配置（字段定义见 internal/games/line/platform_config.go）
  cfg         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMP   NOT NULL DEFAULT now(),
  -- 谁改的（后台登录账号），用于出问题时回溯
  updated_by  VARCHAR(64) NOT NULL DEFAULT ''
);

-- 预置微信 / 抖音两行，让后台首次打开就有可编辑的对象。
-- Web 不预置：它走的是同一条回落路径（默认值），需要时在后台保存一次就会建行。
INSERT INTO platform_config (platform, cfg) VALUES (1, '{}'::jsonb)
ON CONFLICT (platform) DO NOTHING;

INSERT INTO platform_config (platform, cfg) VALUES (2, '{}'::jsonb)
ON CONFLICT (platform) DO NOTHING;

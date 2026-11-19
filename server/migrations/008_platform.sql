-- 008_platform.sql — 多平台：用户归属、埋点平台维度、广告收益
--
-- ## 为什么这三样必须一起做
--
-- 接抖音之后，「这个人是哪个平台来的」会出现在**每一个统计口径**里：
--
--   - 注册数要按平台拆（微信多少、抖音多少）
--   - DAU 要按平台拆（同一个游戏在两个宿主里的活跃完全不同）
--   - 关卡通过率要按平台拆（两端的用户画像不一样，混在一起看不出问题）
--   - 广告收益要按平台拆（eCPM 差好几倍）
--
-- 少一个维度，后台就答不了「抖音的次留比微信高还是低」这种最基本的问题。
-- 而这类维度**必须从写入那一刻就记上**，事后补是补不回来的。
--
-- ## 迁移是每次启动全跑的
--
-- `core/migrate.go` 不记已执行版本，逐条 Exec 所有 .sql。
-- 所以这里每一条 DDL 都必须幂等（IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）。

-- ── users：归属平台 ──
--
-- 0 = 未知（老数据，接抖音之前注册的，都是微信或 Web）
-- 1 = 微信小游戏
-- 2 = 抖音小游戏
-- 3 = Web（浏览器调试 / H5 落地页）
--
-- 用 SMALLINT 而不是 VARCHAR：平台是**闭集**，数值比字符串省空间、
-- 比较快，而且 GROUP BY 出来的结果顺序稳定（字符串排序会受 locale 影响）。
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform SMALLINT NOT NULL DEFAULT 0;

-- platform_uid：平台侧的原始用户标识（微信 openid / 抖音 openid）。
--
-- ## 为什么不复用 openid 列
--
-- `users.openid` 是**加密存储**的（AES-GCM，base64 后长度膨胀），
-- 没法直接读、也没法人工核对。排查「这个玩家到底是哪个抖音号」时，
-- 只有一个加密串是没用的。
--
-- 这里存**明文**的原始 id。是否安全？—— openid 本身不是凭证，
-- 它只是「这个应用内的用户编号」，拿到它也不能冒充用户（还需要 session_key）。
-- 而它带来的可运维性（对账、工单、跨库比对）是实打实的。
--
-- 只对新写入生效；老数据留空，不影响任何查询。
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_uid VARCHAR(128) NOT NULL DEFAULT '';

-- 按平台统计注册数 / 活跃数要用
CREATE INDEX IF NOT EXISTS idx_users_platform ON users (platform);

-- ── events：埋点也带平台 ──
--
-- ## 为什么埋点表也要加
--
-- 「分享率」「关卡流失」这些指标必须能**跨平台对比**。
-- 不在写入时记平台，就只能靠 join users 反查 —— 而 events 是
-- 匿名可写的（`uid = 0`），匿名事件 join 不到用户，那批数据就丢了平台维度。
ALTER TABLE events ADD COLUMN IF NOT EXISTS platform SMALLINT NOT NULL DEFAULT 0;

-- 后台最常见的查询是「某平台某段时间某事件」，走这条复合索引
CREATE INDEX IF NOT EXISTS idx_events_platform_name_ts ON events (platform, name, ts);

-- ── ad_revenue：广告收益（平台侧同步来的）──
--
-- ## 这不是埋点数据
--
-- 我们自己的 `events` 表能记「玩家看了几次激励视频」（`ad_complete`），
-- 但**记不了赚了多少钱** —— 收益只在平台侧结算，客户端拿不到。
--
-- 所以这张表的数据来源是**平台开放接口**（或人工补录）：
--   - 微信 `publisher_adpos_general`（广告汇总，90 天窗口）
--   - 抖音 `traffic-mini-game ad income query`（按日期/广告位/宿主筛选）
--
-- ## 金额一律用「分」（BIGINT）
--
-- 浮点累加会漂：0.1 + 0.2 ≠ 0.3，几百行加下来能差出几块钱，
-- 对账时根本查不出是哪一行的问题。全链路整数，只在展示层除以 100。
CREATE TABLE IF NOT EXISTS ad_revenue (
  id          BIGSERIAL   PRIMARY KEY,
  -- 1=微信 2=抖音（与 users.platform 同一套编号）
  platform    SMALLINT    NOT NULL,
  -- 数据日期（平台按天给）
  day         DATE        NOT NULL,
  -- 广告类型：banner / interstitial / rewarded。平台可能不细分，空串表示「全部合计」
  ad_type     VARCHAR(32) NOT NULL DEFAULT '',
  -- 广告位标识（平台侧的 adunit id 或名称）。空串 = 该平台未细分广告位
  placement   VARCHAR(64) NOT NULL DEFAULT '',
  -- 展示次数
  impressions BIGINT      NOT NULL DEFAULT 0,
  -- 点击次数
  clicks      BIGINT      NOT NULL DEFAULT 0,
  -- 收入，单位：**分**
  revenue_fen BIGINT      NOT NULL DEFAULT 0,
  -- 数据来源：api = 自动同步；manual = 后台手工补录
  source      VARCHAR(16) NOT NULL DEFAULT 'api',
  fetched_at  TIMESTAMP   NOT NULL
);

-- ── 幂等键 ──
--
-- 同一天重复同步必须**覆盖**而不是追加。
-- 少了这个约束，同步跑两次收益就翻倍 —— 而且这种错不会报异常，
-- 只会在某天被人发现「这个月收入怎么是两倍」，那时已经污染了所有历史报表。
--
-- 四列一起才是「同一行数据」：平台 + 日期 + 广告类型 + 广告位。
-- 平台接口里同一天会返回多条（每个广告位一条），所以不能只到 day。
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_revenue_key
  ON ad_revenue (platform, day, ad_type, placement);

-- 后台按「时间倒序 + 分平台」看，走这条
CREATE INDEX IF NOT EXISTS idx_ad_revenue_day ON ad_revenue (day DESC, platform);

-- 001_init.sql — 初始化全部数据表（PostgreSQL 方言）
-- 来源：docs/连连看/03-后端规格.md 第 3 节 + 埋点 events 表（05-商业化与埋点.md 第 8 节）

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  openid         VARCHAR(256) NOT NULL,           -- AES-GCM 加密存储（base64，长度膨胀）
  openid_hash    CHAR(64)     NOT NULL,           -- sha256(openid)，用于唯一索引与查询
  nickname       VARCHAR(64)  NOT NULL DEFAULT '',
  avatar         VARCHAR(512) NOT NULL DEFAULT '',
  max_level      INTEGER      NOT NULL DEFAULT 0,
  total_time_ms  BIGINT       NOT NULL DEFAULT 0,
  total_steps    INTEGER      NOT NULL DEFAULT 0,
  unlocked_skins JSONB        NOT NULL,
  ad_watch_cnt   INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL,
  last_login_at  TIMESTAMP    NOT NULL,
  UNIQUE (openid_hash)
);

CREATE TABLE IF NOT EXISTS level_records (
  uid        BIGINT    NOT NULL,
  level_idx  INTEGER   NOT NULL,
  steps      INTEGER   NOT NULL,
  time_ms    INTEGER   NOT NULL,
  path       JSONB     NOT NULL,     -- 格子索引序列
  skipped    SMALLINT  NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (uid, level_idx)
);
CREATE INDEX IF NOT EXISTS idx_level ON level_records (level_idx);

CREATE TABLE IF NOT EXISTS friends (
  uid        BIGINT    NOT NULL,
  friend_uid BIGINT    NOT NULL,
  status     SMALLINT  NOT NULL,           -- 0=pending 1=accepted 2=blocked
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (uid, friend_uid)
);

CREATE TABLE IF NOT EXISTS scores (
  id         BIGSERIAL PRIMARY KEY,
  uid        BIGINT    NOT NULL,
  level_idx  INTEGER   NOT NULL,
  steps      INTEGER   NOT NULL,
  time_ms    INTEGER   NOT NULL,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uid ON scores (uid);
CREATE INDEX IF NOT EXISTS idx_created ON scores (created_at);

CREATE TABLE IF NOT EXISTS skips (
  uid        BIGINT      NOT NULL,
  level_idx  INTEGER     NOT NULL,
  day        VARCHAR(10) NOT NULL,     -- YYYY-MM-DD
  PRIMARY KEY (uid, level_idx, day)
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  uid        BIGINT      NOT NULL DEFAULT 0,
  name       VARCHAR(64) NOT NULL,
  params     JSONB       NOT NULL,
  ts         TIMESTAMP   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_name_ts ON events (name, ts);
CREATE INDEX IF NOT EXISTS idx_uid_events ON events (uid);

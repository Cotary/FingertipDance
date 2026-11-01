-- 001_init.sql — 初始化全部数据表
-- 来源：docs/连连看/03-后端规格.md 第 3 节 + 埋点 events 表（05-商业化与埋点.md 第 8 节）

CREATE TABLE IF NOT EXISTS users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid         VARCHAR(64)  NOT NULL,           -- 加密存储
  openid_hash    CHAR(64)     NOT NULL,           -- sha256(openid)，用于唯一索引与查询
  nickname       VARCHAR(64)  NOT NULL DEFAULT '',
  avatar         VARCHAR(512) NOT NULL DEFAULT '',
  max_level      INT          NOT NULL DEFAULT 0,
  total_time_ms  BIGINT       NOT NULL DEFAULT 0,
  total_steps    INT          NOT NULL DEFAULT 0,
  unlocked_skins JSON         NOT NULL,
  ad_watch_cnt   INT          NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL,
  last_login_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_openid_hash (openid_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS level_records (
  uid        BIGINT UNSIGNED NOT NULL,
  level_idx  INT          NOT NULL,
  steps      INT          NOT NULL,
  time_ms    INT          NOT NULL,
  path       JSON         NOT NULL,     -- 格子索引序列
  skipped    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL,
  PRIMARY KEY (uid, level_idx),
  KEY idx_level (level_idx)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS friends (
  uid        BIGINT UNSIGNED NOT NULL,
  friend_uid BIGINT UNSIGNED NOT NULL,
  status     TINYINT NOT NULL,           -- 0=pending 1=accepted 2=blocked
  created_at DATETIME NOT NULL,
  PRIMARY KEY (uid, friend_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS scores (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid        BIGINT UNSIGNED NOT NULL,
  level_idx  INT    NOT NULL,
  steps      INT    NOT NULL,
  time_ms    INT    NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_uid (uid),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS skips (
  uid        BIGINT UNSIGNED NOT NULL,
  level_idx  INT    NOT NULL,
  day        VARCHAR(10) NOT NULL,     -- YYYY-MM-DD
  PRIMARY KEY (uid, level_idx, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name       VARCHAR(64) NOT NULL,
  params     JSON NOT NULL,
  ts         DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_name_ts (name, ts),
  KEY idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

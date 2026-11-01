package core

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
)

// ReportEvent 是一条埋点。
type ReportEvent struct {
	Name   string                 `json:"name"`
	TS     int64                  `json:"ts"`
	Params map[string]interface{} `json:"params"`
}

// reportReq 上报请求。
type reportReq struct {
	Events []ReportEvent `json:"events"`
}

// ReportHandler 接收客户端埋点。
func ReportHandler(db *DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req reportReq
		if err := c.ShouldBindJSON(&req); err != nil {
			Fail(c, CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		if len(req.Events) == 0 || len(req.Events) > 50 {
			Fail(c, CodeBadRequest, "单次事件数量需在 1..50 之间")
			return
		}
		uid := UIDFromContext(c)
		for _, e := range req.Events {
			if len(e.Name) == 0 || len(e.Name) > 64 {
				continue
			}
			p, _ := json.Marshal(e.Params)
			if len(p) > 2048 {
				continue
			}
			ts := time.Now()
			if e.TS > 0 {
				ts = time.UnixMilli(e.TS)
			}
			_, err := db.Exec(
				"INSERT INTO events (uid, name, params, ts) VALUES (?,?,?,?)",
				uid, e.Name, string(p), ts,
			)
			if err != nil {
				// 埋点失败不影响主流程，只记日志
				c.Error(err) //nolint
			}
		}
		OK(c, map[string]bool{"ok": true})
	}
}

// AnalyticsSchema 事件表建表语句。
const AnalyticsSchema = `
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
`

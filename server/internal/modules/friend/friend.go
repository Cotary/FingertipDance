package friend

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// 好友状态。
const (
	StatusPending  = 0
	StatusAccepted = 1
	StatusBlocked  = 2
)

// actionReq 好友操作请求。
type actionReq struct {
	Action    string `json:"action"`
	FriendUID int64  `json:"friendUid"`
}

// FriendItem 好友条目。
type FriendItem struct {
	UID         int64  `json:"uid"`
	Nickname    string `json:"nickname"`
	Avatar      string `json:"avatar"`
	MaxLevel    int    `json:"maxLevel"`
	TotalTimeMs int64  `json:"totalTimeMs"`
	SkinCount   int    `json:"skinCount"`
	IsMutual    bool   `json:"isMutual"`
}

// Handler 处理好友操作与查询。
func Handler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodPost:
			handleAction(c, db)
		case http.MethodGet:
			handleList(c, db)
		default:
			core.Fail(c, core.CodeBadRequest, "不支持的方法")
		}
	}
}

// handleAction 处理申请/同意/删除/拉黑。
func handleAction(c *gin.Context, db *core.DB) {
	var req actionReq
	if err := c.ShouldBindJSON(&req); err != nil {
		core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
		return
	}
	uid := core.UIDFromContext(c)
	if req.FriendUID == 0 || req.FriendUID == uid {
		core.Fail(c, core.CodeBadRequest, "好友 ID 非法")
		return
	}
	now := time.Now()

	switch req.Action {
	case "apply":
		_, err := db.Exec(
			"INSERT INTO friends (uid, friend_uid, status, created_at) VALUES ($1,$2,$3,$4) "+
				"ON CONFLICT (uid, friend_uid) DO UPDATE SET status=EXCLUDED.status",
			uid, req.FriendUID, StatusPending, now,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "发起申请失败: "+err.Error())
			return
		}
		// 对方也需要能看到这条申请
		_, _ = db.Exec(
			"INSERT INTO friends (uid, friend_uid, status, created_at) VALUES ($1,$2,$3,$4) "+
				"ON CONFLICT (uid, friend_uid) DO UPDATE SET status=EXCLUDED.status",
			req.FriendUID, uid, StatusPending, now,
		)

	case "accept":
		_, err := db.Exec(
			"UPDATE friends SET status=$1 WHERE (uid=$2 AND friend_uid=$3) OR (uid=$4 AND friend_uid=$5)",
			StatusAccepted, uid, req.FriendUID, req.FriendUID, uid,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "同意失败: "+err.Error())
			return
		}

	case "remove":
		_, err := db.Exec(
			"DELETE FROM friends WHERE (uid=$1 AND friend_uid=$2) OR (uid=$3 AND friend_uid=$4)",
			uid, req.FriendUID, req.FriendUID, uid,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "删除失败: "+err.Error())
			return
		}

	case "block":
		_, err := db.Exec(
			"UPDATE friends SET status=$1 WHERE uid=$2 AND friend_uid=$3",
			StatusBlocked, uid, req.FriendUID,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "拉黑失败: "+err.Error())
			return
		}

	case "unblock":
		_, err := db.Exec(
			"UPDATE friends SET status=$1 WHERE uid=$2 AND friend_uid=$3",
			StatusPending, uid, req.FriendUID,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "解除拉黑失败: "+err.Error())
			return
		}

	default:
		core.Fail(c, core.CodeBadRequest, "未知操作: "+req.Action)
		return
	}

	core.OK(c, gin.H{"ok": true})
}

// handleList 返回好友列表与进度统计。
func handleList(c *gin.Context, db *core.DB) {
	uid := core.UIDFromContext(c)
	rows, err := db.Query(
		"SELECT u.id, u.nickname, u.avatar, u.max_level, u.total_time_ms, "+
			"jsonb_array_length(u.unlocked_skins) FROM friends f "+
			"JOIN users u ON u.id = f.friend_uid "+
			"WHERE f.uid = $1 AND f.status = $2",
		uid, StatusAccepted,
	)
	if err != nil {
		core.Fail(c, core.CodeInternal, "查询好友失败: "+err.Error())
		return
	}
	defer rows.Close()

	list := make([]FriendItem, 0, 32)
	for rows.Next() {
		var it FriendItem
		var skinCount sql.NullInt64
		if err := rows.Scan(&it.UID, &it.Nickname, &it.Avatar, &it.MaxLevel, &it.TotalTimeMs, &skinCount); err != nil {
			continue
		}
		it.SkinCount = int(skinCount.Int64)
		it.IsMutual = true // 双方 accepted 时即为互关
		list = append(list, it)
	}

	// 统计：好友平均进度、最高进度好友
	avg := 0
	max := 0
	if len(list) > 0 {
		sum := 0
		for _, it := range list {
			sum += it.MaxLevel
			if it.MaxLevel > max {
				max = it.MaxLevel
			}
		}
		avg = sum / len(list)
	}

	core.OK(c, gin.H{
		"list": list,
		"stats": gin.H{
			"friendCount": len(list),
			"avgLevel":    avg,
			"maxLevel":    max,
		},
	})
}

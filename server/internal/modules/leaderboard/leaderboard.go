package leaderboard

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// GetHandler 榜单查询处理。T12 实现，T08 阶段为占位。
func GetHandler(db *core.DB, rdb *core.Redis) gin.HandlerFunc {
	return func(c *gin.Context) {
		core.OK(c, gin.H{"list": []any{}})
	}
}

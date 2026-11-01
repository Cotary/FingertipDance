package line

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// StarOf 按「步数 / 理论最短步数」算星级。
// 阈值必须与客户端 ui/hud.ts 的 starOf 保持一致。
func StarOf(steps, shortest int) int {
	if shortest <= 0 {
		return 1
	}
	ratio := float64(steps) / float64(shortest)
	switch {
	case ratio <= 1.15:
		return 3
	case ratio <= 1.5:
		return 2
	default:
		return 1
	}
}

// StarsHandler 返回玩家每关星级：{"stars": {"1": 3, "2": 2, ...}}
func StarsHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := core.UIDFromContext(c)

		rows, err := db.Query("SELECT level_idx, steps FROM level_records WHERE uid=$1", uid)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询星级失败: "+err.Error())
			return
		}
		defer rows.Close()

		stars := make(map[string]int, 64)
		for rows.Next() {
			var idx, steps int
			if err := rows.Scan(&idx, &steps); err != nil {
				continue
			}
			lv := Levels.Get(idx)
			if lv == nil {
				continue
			}
			stars[strconv.Itoa(idx)] = StarOf(steps, lv.Shortest)
		}

		core.OK(c, gin.H{"stars": stars})
	}
}

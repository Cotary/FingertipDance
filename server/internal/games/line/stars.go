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
//
// ## 两种模式的星级算法不同
//
// - 经典模式：`StarOf(steps, shortest)` —— 步数比最短步数多就掉星
// - cover 模式：`StarOfCover(undos)` —— 步数恒为 required−1，唯一的区分度是**悔棋次数**
//
// ## 为什么必须分开算
//
// 早期版本只有经典模式那套公式，cover 记录也拿去比 `shortest`，
// 结果 cover 的星级全是错的（步数永远等于最短步数 → 恒 3 星）。
//
// ## 为什么必须带 mode
//
// `level_records` 里经典与 cover 的关号**重叠**（都是 1..1000），
// 不带 mode 就分不清某条记录是哪种模式写的。
//
// ## 查询参数 `mode`
//
// - `mode=cover` → 只返回 cover 模式的星级
// - `mode=classic` 或省略 → 只返回经典模式的星级
//
// **必须让客户端显式指定** —— 两种模式的关号重叠，
// 混在一起返回的话客户端没法区分第 5 关的星星是哪种模式打的。
//
// ## 跳过的关卡给 0 星
//
// 跳过的关卡不该点亮星星（它是「花钱买过去的」，不是「打过去的」）。
func StarsHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := core.UIDFromContext(c)

		mode := ModeClassic
		switch c.DefaultQuery("mode", "classic") {
		case "cover":
			mode = ModeCover
		case "classic":
			mode = ModeClassic
		default:
			core.Fail(c, core.CodeBadRequest, "mode 参数需为 classic 或 cover")
			return
		}

		rows, err := db.Query(
			"SELECT mode, level_idx, steps, undos, skipped FROM level_records WHERE uid=$1 AND mode=$2",
			uid, mode,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询星级失败: "+err.Error())
			return
		}
		defer rows.Close()

		stars := make(map[string]int, 64)
		for rows.Next() {
			var rowMode, idx, steps, undos, skipped int
			if err := rows.Scan(&rowMode, &idx, &steps, &undos, &skipped); err != nil {
				continue
			}
			// 跳过的关卡不点亮
			if skipped != 0 {
				continue
			}
			if rowMode == ModeCover {
				stars[strconv.Itoa(idx)] = StarOfCover(undos)
			} else {
				lv := Levels.Get(idx)
				if lv == nil {
					continue
				}
				stars[strconv.Itoa(idx)] = StarOf(steps, lv.Shortest)
			}
		}

		core.OK(c, gin.H{"stars": stars})
	}
}

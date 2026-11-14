package line

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/modules/leaderboard"
)

// progressReq 进度上报请求。
type progressReq struct {
	LevelIdx int   `json:"levelIdx"`
	Steps    int   `json:"steps"`
	TimeMs   int   `json:"timeMs"`
	Path     []int `json:"path"`
	Skipped  bool  `json:"skipped"`
}

// 关卡记录模式（`level_records.mode`）。
//
// 经典模式与 cover 模式**共用同一套关号空间**（1..1000），
// 但记录必须隔离 —— 否则同一个 (uid, level_idx) 会被两种模式覆写，
// 星级也会按错误的 `shortest` 算。
const (
	ModeClassic = 0 // 经典模式（起终点连线）
	ModeCover   = 1 // cover 模式（铺满全盘）
)

// unlockedSkinInfo 解锁的皮肤信息。
type unlockedSkinInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// nowFunc 返回当前时间，供测试替换。
var nowFunc = func() time.Time { return time.Now() }

// ProgressHandler 上报通关成绩，校验合法性并推进进度。
//
// Deprecated: **经典模式已下线** —— 客户端现在只用 cover 模式
// （`/api/cover/progress`）。这个接口保留是为了兼容老客户端，
// 新的客户端代码不要调用它。
func ProgressHandler(db *core.DB, rdb *core.Redis, skins []SkinConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req progressReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		uid := core.UIDFromContext(c)

		lv := Levels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}

		// ── 校验 ──
		if req.Skipped {
			// 跳过：步数必须等于最短步数
			if req.Steps != lv.Shortest {
				core.Fail(c, core.CodeStepsTooLow, "跳过时步数必须等于最短步数")
				return
			}
		} else {
			cells, err := decodeGridBase64(lv.Grid)
			if err != nil {
				core.Fail(c, core.CodeInternal, "解码关卡失败: "+err.Error())
				return
			}
			if len(req.Path) != req.Steps+1 {
				core.Fail(c, core.CodePathIllegal, "路径长度与步数不匹配")
				return
			}
			if err := ValidatePath(cells, lv.W, req.Path); err != nil {
				core.Fail(c, core.CodePathIllegal, "路径非法: "+err.Error())
				return
			}
			if req.Steps < lv.Shortest {
				core.Fail(c, core.CodeStepsTooLow, fmt.Sprintf("步数 %d 低于理论最短 %d", req.Steps, lv.Shortest))
				return
			}
			if req.TimeMs < req.Steps*50 {
				core.Fail(c, core.CodeTimeInvalid, "用时异常")
				return
			}
		}

		// ── 事务写入 ──
		res, err := applyProgress(db, uid, lv, req, skins)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入进度失败: "+err.Error())
			return
		}

		// 更新 Redis 榜单（失败不影响主流程）
		if rdb != nil {
			if err := leaderboard.UpdateScore(c.Request.Context(), rdb, uid, res.MaxLevel, res.TotalTimeMs); err != nil {
				c.Error(err)
			}
		}

		core.OK(c, res)
	}
}

// progressResult 进度写入结果。
type progressResult struct {
	Passed        bool              `json:"passed"`
	UnlockedSkin  *unlockedSkinInfo `json:"unlockedSkin"`
	IsNewBest     bool              `json:"isNewBest"`
	MaxLevel      int               `json:"maxLevel"`
	TotalTimeMs   int64             `json:"totalTimeMs"`
	TotalSteps    int               `json:"totalSteps"`
	UnlockedSkins []string          `json:"unlockedSkins"`
	MyRank        int64             `json:"myRank"`
	// Stars 本次通关该关星级（1~3）
	Stars int `json:"stars"`
}

// applyProgress 在事务内更新关卡记录、用户进度、排行榜与皮肤。
func applyProgress(db *core.DB, uid int64, lv *SerializedLevel, req progressReq, skins []SkinConfig) (*progressResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback()

	// 锁 `users` 行，把「读-改-写」串行化（详见 lockUserRow 的说明）。
	// 不锁的话并发提交会撞主键（INSERT firstPass）或丢一次 `total_steps` 累加。
	if err := lockUserRow(tx, uid); err != nil {
		return nil, err
	}

	now := nowFunc()

	// 查已有记录，判断是否首次通关与是否新纪录
	var oldSteps, oldTime int
	var oldSkipped bool
	err = tx.QueryRow(
		"SELECT steps, time_ms, skipped FROM level_records WHERE uid=$1 AND mode=$2 AND level_idx=$3",
		uid, ModeClassic, lv.Idx,
	).Scan(&oldSteps, &oldTime, &oldSkipped)
	firstPass := errors.Is(err, sql.ErrNoRows)
	if err != nil && !firstPass {
		return nil, fmt.Errorf("查询关卡记录: %w", err)
	}

	isNewBest := firstPass || req.Steps < oldSteps || (req.Steps == oldSteps && req.TimeMs < oldTime)

	pathJSON, _ := json.Marshal(req.Path)
	skipped := 0
	if req.Skipped {
		skipped = 1
	}

	if firstPass {
		_, err = tx.Exec(
			"INSERT INTO level_records (uid, mode, level_idx, steps, time_ms, path, skipped, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
			uid, ModeClassic, lv.Idx, req.Steps, req.TimeMs, string(pathJSON), skipped, now,
		)
	} else if isNewBest {
		_, err = tx.Exec(
			"UPDATE level_records SET steps=$1, time_ms=$2, path=$3, skipped=$4 WHERE uid=$5 AND mode=$6 AND level_idx=$7",
			req.Steps, req.TimeMs, string(pathJSON), skipped, uid, ModeClassic, lv.Idx,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("写入关卡记录: %w", err)
	}

	// 累计总步数与总用时（仅首次通关累加，避免重复提交刷数值）
	if firstPass {
		_, err = tx.Exec(
			"UPDATE users SET total_steps = total_steps + $1, total_time_ms = total_time_ms + $2 WHERE id=$3",
			req.Steps, req.TimeMs, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("累计总步数: %w", err)
		}
	}

	// 推进最高关卡（跳过的关卡也算推进，否则玩家会卡死）
	if lv.Idx > 0 {
		_, err = tx.Exec(
			"UPDATE users SET max_level = GREATEST(max_level, $1) WHERE id=$2",
			lv.Idx, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("推进最高关卡: %w", err)
		}
	}

	// 皮肤解锁：仅在真正通关（未跳过）且该关有关联皮肤时发放
	var unlocked *unlockedSkinInfo
	if !req.Skipped {
		unlocked, err = grantSkinForLevel(tx, uid, lv.UnlockSkin, skins)
		if err != nil {
			return nil, err
		}
	}

	// 成绩流水
	//
	// 必须带 `mode`（=经典）与 `undos`（=0）——
	// 挑战接口查历史最佳时按 `mode` 过滤，两种模式共用关号空间，
	// 不写 mode 的话 cover 的记录会被当成经典的。
	_, err = tx.Exec(
		"INSERT INTO scores (uid, mode, level_idx, steps, time_ms, undos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
		uid, ModeClassic, lv.Idx, req.Steps, req.TimeMs, 0, now,
	)
	if err != nil {
		return nil, fmt.Errorf("写入成绩流水: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}

	// 读取最新进度用于响应
	var maxLevel, totalSteps int
	var totalTimeMs int64
	var unlockedJSON string
	if err := db.QueryRow(
		"SELECT max_level, total_time_ms, total_steps, unlocked_skins FROM users WHERE id=$1", uid,
	).Scan(&maxLevel, &totalTimeMs, &totalSteps, &unlockedJSON); err != nil {
		return nil, fmt.Errorf("读取进度: %w", err)
	}
	var skinList []string
	_ = json.Unmarshal([]byte(unlockedJSON), &skinList)

	return &progressResult{
		Passed:        true,
		UnlockedSkin:  unlocked,
		IsNewBest:     isNewBest,
		MaxLevel:      maxLevel,
		TotalTimeMs:   totalTimeMs,
		TotalSteps:    totalSteps,
		UnlockedSkins: skinList,
		Stars:         StarOf(req.Steps, lv.Shortest),
	}, nil
}

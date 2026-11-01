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

// unlockedSkinInfo 解锁的皮肤信息。
type unlockedSkinInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// nowFunc 返回当前时间，供测试替换。
var nowFunc = func() time.Time { return time.Now() }

// ProgressHandler 上报通关成绩，校验合法性并推进进度。
func ProgressHandler(db *core.DB, rdb *core.Redis, skins []SkinConfig) gin.HandlerFunc {
	skinMap := make(map[string]string, len(skins))
	for _, s := range skins {
		skinMap[s.ID] = s.Name
	}

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
		res, err := applyProgress(db, uid, lv, req, skinMap)
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
	UnlockedSkins []string          `json:"unlockedSkins"`
	MyRank        int64             `json:"myRank"`
}

// applyProgress 在事务内更新关卡记录、用户进度、排行榜与皮肤。
func applyProgress(db *core.DB, uid int64, lv *SerializedLevel, req progressReq, skinMap map[string]string) (*progressResult, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务: %w", err)
	}
	defer tx.Rollback()

	now := nowFunc()

	// 查已有记录，判断是否首次通关与是否新纪录
	var oldSteps, oldTime int
	var oldSkipped bool
	err = tx.QueryRow(
		"SELECT steps, time_ms, skipped FROM level_records WHERE uid=? AND level_idx=?",
		uid, lv.Idx,
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
			"INSERT INTO level_records (uid, level_idx, steps, time_ms, path, skipped, created_at) VALUES (?,?,?,?,?,?,?)",
			uid, lv.Idx, req.Steps, req.TimeMs, string(pathJSON), skipped, now,
		)
	} else if isNewBest {
		_, err = tx.Exec(
			"UPDATE level_records SET steps=?, time_ms=?, path=?, skipped=? WHERE uid=? AND level_idx=?",
			req.Steps, req.TimeMs, string(pathJSON), skipped, uid, lv.Idx,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("写入关卡记录: %w", err)
	}

	// 累计总步数与总用时（仅首次通关累加，避免重复提交刷数值）
	if firstPass {
		_, err = tx.Exec(
			"UPDATE users SET total_steps = total_steps + ?, total_time_ms = total_time_ms + ? WHERE id=?",
			req.Steps, req.TimeMs, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("累计总步数: %w", err)
		}
	}

	// 推进最高关卡（跳过的关卡也算推进，否则玩家会卡死）
	if lv.Idx > 0 {
		_, err = tx.Exec(
			"UPDATE users SET max_level = GREATEST(max_level, ?) WHERE id=?",
			lv.Idx, uid,
		)
		if err != nil {
			return nil, fmt.Errorf("推进最高关卡: %w", err)
		}
	}

	// 皮肤解锁：仅在真正通关（未跳过）且该关有关联皮肤时发放
	var unlocked *unlockedSkinInfo
	if !req.Skipped && lv.UnlockSkin != nil && *lv.UnlockSkin != "" {
		var unlockedJSON string
		row := tx.QueryRow("SELECT unlocked_skins FROM users WHERE id=?", uid)
		if err := row.Scan(&unlockedJSON); err != nil {
			return nil, fmt.Errorf("查询皮肤: %w", err)
		}
		var list []string
		_ = json.Unmarshal([]byte(unlockedJSON), &list)
		if list == nil {
			list = []string{}
		}
		found := false
		for _, id := range list {
			if id == *lv.UnlockSkin {
				found = true
				break
			}
		}
		if !found {
			list = append(list, *lv.UnlockSkin)
			newJSON, _ := json.Marshal(list)
			_, err = tx.Exec("UPDATE users SET unlocked_skins=? WHERE id=?", string(newJSON), uid)
			if err != nil {
				return nil, fmt.Errorf("写入皮肤: %w", err)
			}
			unlocked = &unlockedSkinInfo{ID: *lv.UnlockSkin, Name: skinMap[*lv.UnlockSkin]}
		}
	}

	// 成绩流水
	_, err = tx.Exec(
		"INSERT INTO scores (uid, level_idx, steps, time_ms, created_at) VALUES (?,?,?,?,?)",
		uid, lv.Idx, req.Steps, req.TimeMs, now,
	)
	if err != nil {
		return nil, fmt.Errorf("写入成绩流水: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务: %w", err)
	}

	// 读取最新进度用于响应
	var maxLevel int
	var totalTimeMs int64
	var unlockedJSON string
	if err := db.QueryRow("SELECT max_level, total_time_ms, unlocked_skins FROM users WHERE id=?", uid).Scan(&maxLevel, &totalTimeMs, &unlockedJSON); err != nil {
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
		UnlockedSkins: skinList,
	}, nil
}

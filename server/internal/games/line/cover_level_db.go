package line

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverLevelDB 是 cover 关卡表的**数据库**存储。
//
// ## 与 `CoverLevelTable`（文件版）的关系
//
// 两套并存，用途不同：
//
//   - `CoverLevelTable`：从 JSON 文件加载，**只读**，进程启动时一次性载入内存。
//     作用是「即使数据库是空的，游戏也能有关卡玩」。
//   - `CoverLevelDB`：PostgreSQL 里的**可写**关卡表。
//     作用是「生成器产出的关卡能直接入库」「提示能查参考解」。
//
// 读取时**数据库优先，文件兜底**：数据库里有就用数据库的，
// 没有就退回文件表。这样生成器写进去的关卡立刻生效，
// 而数据库没初始化时游戏照常跑。
type CoverLevelDB struct {
	db *core.DB
}

// NewCoverLevelDB 创建存储句柄。
func NewCoverLevelDB(db *core.DB) *CoverLevelDB {
	return &CoverLevelDB{db: db}
}

// CoverDBLevel 是数据库里的一关。
type CoverDBLevel struct {
	Idx       int
	Version   string
	W         int
	H         int
	Grid      string
	Solution  string
	Required  int
	StartAt   int
	EndAt     int
	Diff      int
	MechKinds int
}

// CoverDBHint 是提示查询的结果。
type CoverDBHint struct {
	/** 关号。 */
	Idx int `json:"idx"`
	/**
	 * 剩余路线（拍平索引序列）。
	 *
	 * **不含线头** —— `cells[0]` 是玩家下一步该落下的格。
	 * 空 = 没有可给的提示。
	 */
	Cells []int `json:"cells"`
	/**
	 * 是否命中参考解。
	 *
	 * true  = 玩家正沿着参考解走，剩余路线直接从参考解切出来（O(1)）。
	 * false = 玩家走岔了，参考解接不回来 —— 这时要退回实时求解。
	 */
	FromReference bool `json:"fromReference"`
	/**
	 * 建议回退到的位置（拍平索引）。
	 *
	 * 玩家走岔后剩余盘面可能已无解。与其给个错的建议，
	 * 不如告诉他「退回到这里还有救」。
	 */
	BacktrackTo int `json:"backtrackTo,omitempty"`
}

// ErrLevelNotFound 表示关卡不存在。
var ErrLevelNotFound = fmt.Errorf("关卡不存在")

// Upsert 写入（或覆盖）一关。
//
// 用 `ON CONFLICT (idx) DO UPDATE` 而不是「先查再插」——
// 一次 SQL 原子完成，避免并发写入时的竞态。
func (c *CoverLevelDB) Upsert(ctx context.Context, lv *CoverDBLevel) error {
	if lv == nil {
		return fmt.Errorf("关卡为空")
	}
	if lv.Idx <= 0 {
		return fmt.Errorf("关号非法: %d", lv.Idx)
	}
	now := time.Now()
	_, err := c.db.ExecContext(ctx, `
		INSERT INTO cover_levels
			(idx, version, w, h, grid, solution, required, start_at, end_at, diff, mech_kinds, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		ON CONFLICT (idx) DO UPDATE SET
			version    = EXCLUDED.version,
			w          = EXCLUDED.w,
			h          = EXCLUDED.h,
			grid       = EXCLUDED.grid,
			solution   = EXCLUDED.solution,
			required   = EXCLUDED.required,
			start_at   = EXCLUDED.start_at,
			end_at     = EXCLUDED.end_at,
			diff       = EXCLUDED.diff,
			mech_kinds = EXCLUDED.mech_kinds,
			updated_at = EXCLUDED.updated_at
	`,
		lv.Idx, lv.Version, lv.W, lv.H, lv.Grid, lv.Solution, lv.Required,
		lv.StartAt, lv.EndAt, lv.Diff, lv.MechKinds, now)
	if err != nil {
		return fmt.Errorf("写入 cover 关卡 %d: %w", lv.Idx, err)
	}
	return nil
}

// Get 取一关。
func (c *CoverLevelDB) Get(ctx context.Context, idx int) (*CoverDBLevel, error) {
	var lv CoverDBLevel
	err := c.db.QueryRowContext(ctx, `
		SELECT idx, version, w, h, grid, solution, required, start_at, end_at, diff, mech_kinds
		FROM cover_levels WHERE idx = $1
	`, idx).Scan(
		&lv.Idx, &lv.Version, &lv.W, &lv.H, &lv.Grid, &lv.Solution,
		&lv.Required, &lv.StartAt, &lv.EndAt, &lv.Diff, &lv.MechKinds,
	)
	if err == sql.ErrNoRows {
		return nil, ErrLevelNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("读取 cover 关卡 %d: %w", idx, err)
	}
	return &lv, nil
}

// Count 返回数据库里的关卡数。
func (c *CoverLevelDB) Count(ctx context.Context) (int, error) {
	var n int
	if err := c.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM cover_levels`).Scan(&n); err != nil {
		return 0, fmt.Errorf("统计 cover 关卡数: %w", err)
	}
	return n, nil
}

// DeleteAfter 删掉某关号之后的全部关卡（重新生成整表时用）。
func (c *CoverLevelDB) DeleteAfter(ctx context.Context, idx int) (int64, error) {
	res, err := c.db.ExecContext(ctx, `DELETE FROM cover_levels WHERE idx > $1`, idx)
	if err != nil {
		return 0, fmt.Errorf("删除 cover 关卡: %w", err)
	}
	return res.RowsAffected()
}

// HintByReference 按参考解给提示。
//
// ## 核心思路
//
// 参考解是一条**固定的**哈密顿路径。玩家如果一直沿着它走，
// 那么「已经走了多少」就是「参考解的前缀长度」——
// 于是剩余路线 = 参考解的后缀，**O(1) 切片，零计算**。
//
// 这正是用户要的「答案存进数据库，直接查询，不用现算」。
//
// ## 什么时候给不出
//
// 玩家走岔了（当前线头不在参考解的下一个位置上），
// 参考解就接不回来了 —— 强行回退会让玩家的线突然倒退，体验极差。
// 这时返回 `FromReference = false`，由调用方退回实时求解。
//
// @param walked 玩家已走过的格（拍平索引序列，含线头）
func (c *CoverLevelDB) HintByReference(
	ctx context.Context,
	idx int,
	walked []int,
) (*CoverDBHint, error) {
	lv, err := c.Get(ctx, idx)
	if err != nil {
		return nil, err
	}
	if lv.Solution == "" {
		return &CoverDBHint{Idx: idx, Cells: []int{}}, nil
	}
	sol, err := DecodeCoverSolution(lv.Solution, lv.W)
	if err != nil {
		return nil, fmt.Errorf("第 %d 关参考解解码失败: %w", idx, err)
	}
	hint := HintFromReference(sol, lv.StartAt, walked)
	hint.Idx = idx
	return hint, nil
}

// HintFromReference 是提示查表的**纯逻辑内核**。
//
// 与数据库解耦 —— 这样它能被单测直接覆盖（不需要起 PostgreSQL）。
//
// @param sol     参考解（拍平索引序列）
// @param startAt 固定起点（`-1` = 自由起点）
// @param walked  玩家已走过的格（拍平索引序列，含线头）
func HintFromReference(sol []int, startAt int, walked []int) *CoverDBHint {
	// 玩家还没起步：整条参考解就是提示，**视起点是否固定决定要不要掐掉第一格**。
	//
	// 客户端约定 `cells[0]` 是「下一步该落下的格」、不含线头：
	//   - 固定起点：起点就是线头，玩家已经在上面了。参考解第 0 格正是起点，
	//     若照抄会让客户端把他画回自己脚下（提示链整体错一格）。
	//   - 自由起点（`startAt < 0`）：空盘没有线头，参考解第 0 格就是
	//     「建议从哪格起手」，必须留着 —— 掐掉的话第一步根本无处可落。
	if len(walked) == 0 {
		from := 0
		if startAt >= 0 {
			from = 1
		}
		if from >= len(sol) {
			return &CoverDBHint{Cells: []int{}, FromReference: true}
		}
		cells := make([]int, len(sol)-from)
		copy(cells, sol[from:])
		return &CoverDBHint{Cells: cells, FromReference: true}
	}

	// 玩家走的路径必须是参考解的**前缀**。
	//
	// 逐格比对：已走的第 k 格必须等于参考解的第 k 格。
	// 一旦对不上 —— 走岔了。
	prefixLen := 0
	for prefixLen < len(walked) && prefixLen < len(sol) {
		if walked[prefixLen] != sol[prefixLen] {
			break
		}
		prefixLen++
	}
	if prefixLen < len(walked) {
		// 走岔了
		return &CoverDBHint{Cells: []int{}, FromReference: false}
	}

	// 剩余路线 = 参考解的后缀（不含线头 —— 线头是 walked 的最后一格）。
	cells := make([]int, 0, len(sol)-prefixLen)
	for i := prefixLen; i < len(sol); i++ {
		cells = append(cells, sol[i])
	}
	return &CoverDBHint{Cells: cells, FromReference: true}
}

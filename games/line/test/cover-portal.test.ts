/**
 * 传送门机制。
 *
 * ## 2026-11-20 语义变更：**进入即传送**
 *
 * 旧实现把传送做成一条「可选边」：站在传送门上，再拖到搭档格才传过去。
 * 实测两个方向都不通：
 *
 * 1. **四邻移动排在前面** —— 只要物理上走得过去，传送永远不被选中。
 *    统计 252 个传送门关卡的参考解：使用传送跳跃 **0 次**。
 * 2. **隔着一整片盘时指针落不到搭档格**，那条边等于不存在。
 *
 * 玩家看到的就是「一块能踩过去的砖」。
 *
 * ## 现在的语义
 *
 * 走进传送门的那一步，`stepMove` 返回的 `consumed` 就是 `[入口, 出口]`
 * —— 搭档格和入口同一步被吃掉，玩家没有「站上去再决定」的中间态。
 * 滑行撞上传送门同理（滑行在传送处终止，线头落在出口）。
 *
 * 搭档不可进（已走过 / 未开锁的门 / 乱序的星星）时**整步作废**：
 * 不能「进去了但没传」，那会让玩家以为自己踩到了一块普通砖。
 *
 * ## 注意：盘面结构
 *
 * 强制传送要求传送门是**两片区域的唯一通路**。现有 252 关是「传送门摆在
 * 解路径中间、被物理踩过去」生成的，强制传送后那些格进不去 → 无解。
 * 关卡表正在重新生成，本文件只钉住**规则与输入层**的行为。
 */
import { describe, it, expect } from 'vitest';

import { buildRuleSet, candidateMoves, stepMove } from '../src/core/cover/v3/rules';
import { CoverCell, DIR, packCell } from '../src/core/cover/v3/types';
import { createCoverState, tryCoverMove } from '../src/game/coverState';
import type { CoverRuntime } from '../src/game/coverLevel';

/** 造规则集：每格一个类型，group 用于传送门配对。 */
function makeRs(
  rows: (number | null)[][],
  groups: number[][] = [],
): ReturnType<typeof buildRuleSet> {
  const h = rows.length;
  const w = rows[0].length;
  const grid = new Uint8Array(w * h);
  const cells: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = rows[y][x];
      if (t === null) continue;
      const idx = y * w + x;
      grid[idx] = packCell(t, 0, groups[y]?.[x] ?? 0);
      cells.push(idx);
    }
  }
  return buildRuleSet(cells, grid, w, h);
}

/** 造一个能直接驱动 `tryCoverMove` 的运行时。 */
function makeRuntime(rs: ReturnType<typeof buildRuleSet>): CoverRuntime {
  return {
    level: {
      idx: 1,
      seed: 1,
      w: rs.w,
      h: rs.h,
      grid: new Uint8Array(rs.w * rs.h),
      required: rs.n,
      deadEnds: 0,
      diff: 0,
      startAt: -1,
      endAt: -1,
      mechKinds: 1,
      solutionCount: 1,
    },
    rs,
  };
}

describe('传送门 · 规则层（进入即传送）', () => {
  it('走进传送门的那一步，consumed 是 [入口, 出口]', () => {
    // 2 行 3 列：
    //   普通 普通 传送门(A)
    //   传送门(B) 普通 普通
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
      [[0, 0, 0], [0, 0, 0]],
    );

    const a = rs.localOf[2];
    const b = rs.localOf[3];
    expect(rs.portalOf[a]).toBe(b);
    expect(rs.portalOf[b]).toBe(a);

    // 从 (1,0) 往右走进 A → 一步吃掉 [A, B]
    const from = rs.localOf[1];
    const visited = new Uint8Array(rs.n);
    visited[from] = 1;
    expect(stepMove(rs, from, DIR.RIGHT, visited, 0), '走进 A 应连带 B').toEqual([a, b]);
  });

  it('双向：从 (0,0) 往下走进 B，一步吃掉 [B, A]', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const a = rs.localOf[2];
    const b = rs.localOf[3];

    const from = rs.localOf[0];
    const visited = new Uint8Array(rs.n);
    visited[from] = 1;
    expect(stepMove(rs, from, DIR.DOWN, visited, 0), '走进 B 应连带 A').toEqual([b, a]);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('搭档已走过 → 整步作废（不能「进去了但没传」）', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const b = rs.localOf[3];
    const from = rs.localOf[1];
    const visited = new Uint8Array(rs.n);
    visited[from] = 1;
    visited[b] = 1; // 搭档已经走过
    expect(stepMove(rs, from, DIR.RIGHT, visited, 0), '搭档已走过 → 进不去').toBeNull();
  });

  it('搭档被门锁住走不到、但搭档本身可进 → 传送照常（钥匙只管自己那一格）', () => {
    // 3 行 3 列：A(2,0) 与 B(2,2) 配对，B 下面是门
    //
    //   ·  ·  A
    //   ·  ·  ·
    //   门 ·  B
    //
    // 这条测的是**传送不受空间阻隔**：A 与 B 之间隔着两行，
    // 物理上永远走不到，但传送一步直达。
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.BRICK],
        [CoverCell.GATE, CoverCell.BRICK, CoverCell.PORTAL],
      ],
      [[0, 0, 0], [0, 0, 0], [1, 0, 0]],
    );
    const a = rs.localOf[2];
    const b = rs.localOf[8];
    expect(rs.portalOf[a], 'A 应配到 B').toBe(b);

    const from = rs.localOf[1];
    const visited = new Uint8Array(rs.n);
    visited[from] = 1;
    expect(stepMove(rs, from, DIR.RIGHT, visited, 0), 'A→B 一步直达').toEqual([a, b]);
  });

  it('传送门不再提供「额外边」（candidateMoves 里没有 viaPortal）', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const a = rs.localOf[2];
    const visited = new Uint8Array(rs.n);
    visited[a] = 1;
    const moves = candidateMoves(rs, a, visited, 0, 0);
    expect(moves.some((mv) => mv.viaPortal), '不应再有 viaPortal 边').toBe(false);
  });
});

describe('传送门 · 冰块滑行', () => {
  it('滑到传送门 → 立刻传走，线头落在出口', () => {
    // 一行：冰 | 传送门(A) | 普通
    // 另起一行放 B，避免 A 的邻居里出现 B
    const rs = makeRs(
      [
        [CoverCell.ICE, CoverCell.PORTAL, CoverCell.BRICK],
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
      ],
    );
    // 上面 (1,0)=A，下面 (2,1)=B，同 group 0
    const a = rs.localOf[1];
    const b = rs.localOf[5];

    const visited = new Uint8Array(rs.n);
    visited[rs.localOf[0]] = 1;
    const consumed = stepMove(rs, rs.localOf[0], DIR.RIGHT, visited, 0);
    expect(consumed, '滑进 A 应连带 B').toEqual([a, b]);
    expect(consumed!.includes(rs.localOf[2]), '不能滑过传送门继续走').toBe(false);
  });
});

describe('传送门 · 客户端输入', () => {
  it('拖进传送门格 → 线头直接出现在出口格', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const state = createCoverState(makeRuntime(rs));

    const start = rs.localOf[0];
    state.phase = 'dragging';
    state.path.push(start);
    state.visited[start] = 1;

    expect(tryCoverMove(state, rs.localOf[1])).toBe('moved');
    // 往右一步进 A(2,0) → 应连带 B(0,1)
    expect(tryCoverMove(state, rs.localOf[2])).toBe('moved');

    const a = rs.localOf[2];
    const b = rs.localOf[3];
    expect(state.path, '路径应包含入口').toContain(a);
    expect(state.path, '出口应同时被吃掉').toContain(b);
    expect(state.path[state.path.length - 1], '线头应在出口').toBe(b);
    expect(state.visited[b]).toBe(1);
  });

  it('搭档不可进时，拖进传送门被拒（blocked，且入口不被吃掉）', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.GATE, CoverCell.BRICK, CoverCell.BRICK],
      ],
      [[0, 0, 0], [1, 0, 0]],
    );
    const state = createCoverState(makeRuntime(rs));
    const start = rs.localOf[0];
    state.phase = 'dragging';
    state.path.push(start);
    state.visited[start] = 1;

    tryCoverMove(state, rs.localOf[1]);
    expect(tryCoverMove(state, rs.localOf[2]), '没钥匙，进不去传送门').toBe('blocked');
    expect(state.path.includes(rs.localOf[2]), '入口不该被吃掉').toBe(false);
  });
});

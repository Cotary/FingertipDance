/**
 * 传送门机制（2026-11-18 落地）。
 *
 * ## 之前传送门是「摆着好看」的
 *
 * 数据层投放了传送门、渲染层画了 A/B 两个变体、规则层甚至已经实现了
 * 「站上传送门 → 额外一条跳到搭档的边」——
 * 但**客户端输入层从来没调用过那条边**。
 *
 * `tryCoverMove` 只认两种走法：四邻接一步、同行同列快拖补齐。
 * 传送搭档格两者都不是，于是落到最后一行 `return 'break'` ——
 * 这次移动被丢弃。玩家看到传送门标记，走上去什么都不会发生。
 *
 * ## 现在的语义
 *
 * - **双向**：A 能传到 B，B 也能传到 A（`portalOf` 互指）。
 * - **只看是不是传送**：搭档格挨着、隔一整片盘，都走同一条路 ——
 *   「只要是传送，都是传送过去」。
 * - **冰块打断滑行**：滑到传送门格就停（传送门被吃掉），
 *   玩家站在上面再主动传送到搭档。
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
      h: rs.w,
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

describe('传送门 · 规则层', () => {
  it('传送门格额外提供一条「跳到搭档」的边', () => {
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

    const visited = new Uint8Array(rs.n);
    visited[a] = 1;
    const moves = candidateMoves(rs, a, visited, 0, 0);
    const portal = moves.find((mv) => mv.viaPortal);
    expect(portal, 'A 上应有传送边').toBeTruthy();
    expect(portal!.consumed).toEqual([b]);
  });

  it('传送门是双向的：B 也能传回 A', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const a = rs.localOf[2];
    const b = rs.localOf[3];

    const visited = new Uint8Array(rs.n);
    visited[b] = 1;
    const moves = candidateMoves(rs, b, visited, 0, 0);
    const portal = moves.find((mv) => mv.viaPortal);
    expect(portal, 'B 上也应有传送边').toBeTruthy();
    expect(portal!.consumed).toEqual([a]);
  });

  it('搭档已走过 → 不能传过去', () => {
    const rs = makeRs(
      [
        [CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
        [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK],
      ],
    );
    const a = rs.localOf[2];
    const b = rs.localOf[3];

    const visited = new Uint8Array(rs.n);
    visited[a] = 1;
    visited[b] = 1; // 搭档已经走过
    const moves = candidateMoves(rs, a, visited, 0, 0);
    expect(moves.find((mv) => mv.viaPortal), '不能传到已走过的格').toBeFalsy();
  });
});

describe('传送门 · 冰块打断滑行', () => {
  it('滑到传送门格就停（传送门被吃掉，滑行不继续）', () => {
    // 一行：普通 | 冰块 | 传送门 | 普通
    const rs = makeRs([[CoverCell.BRICK, CoverCell.ICE, CoverCell.PORTAL, CoverCell.BRICK]]);
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0)!;
    expect(consumed).toEqual([1, 2]);
    expect(consumed.includes(3), '不能滑过传送门').toBe(false);
  });
});

describe('传送门 · 客户端输入', () => {
  // 3 行 4 列：A 与 B 隔得老远，且**既不同行也不同列**
  //   普通   普通   普通   普通
  //   传送门(A) 普通   普通   普通
  //   普通   普通   普通  传送门(B)
  const WIDE = [
    [CoverCell.BRICK, CoverCell.BRICK, CoverCell.BRICK, CoverCell.BRICK],
    [CoverCell.PORTAL, CoverCell.BRICK, CoverCell.BRICK, CoverCell.BRICK],
    [CoverCell.BRICK, CoverCell.BRICK, CoverCell.BRICK, CoverCell.PORTAL],
  ];

  it('站在传送门上拖到搭档 → 传送过去（哪怕隔着一整片盘）', () => {
    const rs = makeRs(WIDE);
    const a = rs.localOf[4]; // A = (1,0)
    const b = rs.localOf[11]; // B = (2,3)

    const state = createCoverState(makeRuntime(rs));
    state.phase = 'dragging';
    state.path = [a];
    state.visited[a] = 1;

    expect(tryCoverMove(state, b)).toBe('moved');
    expect(state.path[state.path.length - 1]).toBe(b);
    expect(state.visited[b]).toBe(1);
  });

  it('搭档与线头相邻时，也是传送（不是普通走一步）', () => {
    // 一行：普通 | 传送门(A) | 传送门(B)
    const rs = makeRs([[CoverCell.BRICK, CoverCell.PORTAL, CoverCell.PORTAL]]);
    const a = rs.localOf[1];
    const b = rs.localOf[2];
    expect(Math.abs(a - b)).toBe(1); // 确实相邻

    const state = createCoverState(makeRuntime(rs));
    state.phase = 'dragging';
    state.path = [a];
    state.visited[a] = 1;

    expect(tryCoverMove(state, b)).toBe('moved');
    expect(state.path).toEqual([a, b]);
  });

  it('不在传送门上时，拖到远处什么也不发生', () => {
    const rs = makeRs(WIDE);
    const head = rs.localOf[0]; // (0,0) 普通格
    const b = rs.localOf[11]; // B = (2,3)

    const state = createCoverState(makeRuntime(rs));
    state.phase = 'dragging';
    state.path = [head];
    state.visited[head] = 1;

    // 线头不是传送门 → 拖到 B（远处）应该是 break，不是 moved
    expect(tryCoverMove(state, b)).toBe('break');
  });
});

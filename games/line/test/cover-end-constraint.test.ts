/**
 * 终点约束：**END 只能被最后一步踩上**，中途应当像石障一样挡住。
 *
 * ## 用户报的现象
 *
 * 「终点只能是最后一个连上去的点，现在中途还能连上去，应该像石障一样挡住」
 *
 * ## 根因
 *
 * `rules.ts` 的 `enterable()` 只判「已走过 / 未开锁的门」，
 * **完全没看 `rs.endAt`**。于是 END 格在规则层和普通砖一样，
 * 玩家可以中途踩上去再走开 —— 通关判定（`isCoverSolved`）最后再查
 * 「线头是不是 endAt」，那时人早走了，于是这一笔白走。
 *
 * 这跟石障（BLOCK）的体验完全不同：石障是**根本进不去**，
 * 玩家立刻知道此路不通；而 END 是**能进去、之后才发现白费**，
 * 反馈来得太晚。
 *
 * ## 修法
 *
 * `enterable()` 增加一条：`v === rs.endAt` 时，只有
 * 「走完这一格就覆盖全部必需格」才允许进入。
 * 也就是**把 END 当成一道只在最后才开的门**。
 */
import { describe, it, expect } from 'vitest';

import { buildRuleSet, candidateMoves, stepMove } from '../src/core/cover/v3/rules';
import { CoverCell, DIR, packCell } from '../src/core/cover/v3/types';

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

describe('终点只能最后一步踩上', () => {
  it('中途进入 END 被挡住（盘上还有别的空格没走）', () => {
    // 一行 4 格：普通 | END | 普通 | 普通
    //   从最左起步，往右走第二格就是 END。
    //   此时还有 2 格没走 → **不该允许进 END**。
    const rs = makeRs([
      [CoverCell.START, CoverCell.END, CoverCell.BRICK, CoverCell.BRICK],
    ]);
    rs.startAt = rs.localOf[0];
    rs.endAt = rs.localOf[1];

    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const moves = candidateMoves(rs, 0, visited, 0, 0);
    expect(moves.some((mv) => mv.target === 1), '中途不该能进 END').toBe(false);
    // stepMove 也必须拒绝
    expect(stepMove(rs, 0, DIR.RIGHT, visited, 0), '中途不该能走进 END').toBeNull();
  });

  it('其余格都走完了，进入 END 才允许', () => {
    // 一行 3 格：普通 | 普通 | END
    //   走到最右一格时，只剩 END 没走 → 允许进。
    const rs = makeRs([
      [CoverCell.START, CoverCell.BRICK, CoverCell.END],
    ]);
    rs.startAt = rs.localOf[0];
    rs.endAt = rs.localOf[2];

    const visited = new Uint8Array(rs.n);
    visited[0] = 1;
    visited[1] = 1; // 只剩 END

    const moves = candidateMoves(rs, 1, visited, 0, 0);
    expect(moves.some((mv) => mv.target === 2), '最后一步应能进 END').toBe(true);
    expect(stepMove(rs, 1, DIR.RIGHT, visited, 0)).toEqual([2]);
  });

  it('endAt = -1（自由终点）时不加任何限制', () => {
    const rs = makeRs([
      [CoverCell.START, CoverCell.END, CoverCell.BRICK],
    ]);
    rs.startAt = rs.localOf[0];
    rs.endAt = -1; // 自由终点：END 只是块普通砖

    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const moves = candidateMoves(rs, 0, visited, 0, 0);
    expect(moves.some((mv) => mv.target === 1), '自由终点时 END 可随时进').toBe(true);
  });

  it('冰块滑行也不能滑进 END（除非是最后一格）', () => {
    // 一行：冰 | 冰 | END | 普通
    //   从最左滑进去，途中经过 END 时必须停下，不能吃过去
    const rs = makeRs([
      [CoverCell.ICE, CoverCell.ICE, CoverCell.END, CoverCell.BRICK],
    ]);
    rs.endAt = rs.localOf[2];

    const visited = new Uint8Array(rs.n);
    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0);
    // 要么整步被拒，要么停在 END 之前 —— 但绝不能把 END 吃进去再继续
    if (consumed) {
      expect(consumed.includes(2), '滑行不该吃掉 END').toBe(false);
    }
  });

  /**
   * `autoFill`（快拖补齐）是逐格调 `stepMove` 的，
   * 而 `stepMove` 的 `enterable` 判的是**当前** `visited`。
   *
   * 所以「从远处一次拖到 END」不会因为"这一步跨了很多格"而蒙过关：
   * 中间那些格被逐格吃掉后，`simVisited` 也是逐格更新的，
   * 到 END 那一格时计数已经正确。
   *
   * 这两条钉住这个性质 —— 否则「拖得够快就能提前进终点」这种漏洞
   * 只会在真实拖动里偶发出现，单步测试完全测不出来。
   */
  it('逐格推进时：END 在末位 → 最后一步才允许', () => {
    const rs = makeRs([[CoverCell.BRICK, CoverCell.BRICK, CoverCell.END]]);
    rs.endAt = rs.localOf[2];

    const visited = new Uint8Array(rs.n);
    visited[0] = 1;
    expect(stepMove(rs, 0, DIR.RIGHT, visited, 0), '走到中间格应允许').toEqual([1]);

    visited[1] = 1; // 只剩 END
    expect(stepMove(rs, 1, DIR.RIGHT, visited, 0), '最后一步进 END 应允许').toEqual([2]);
  });

  it('END 后面还有格没走 → 进 END 被拒', () => {
    const rs = makeRs([[CoverCell.BRICK, CoverCell.END, CoverCell.BRICK]]);
    rs.endAt = rs.localOf[1];

    const visited = new Uint8Array(rs.n);
    visited[0] = 1;
    expect(stepMove(rs, 0, DIR.RIGHT, visited, 0), '还有第 3 格没走，不该能进 END').toBeNull();
  });
});

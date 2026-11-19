/**
 * 冰块滑行 × 机制交互回归测试（2026-11-16 修复）。
 *
 * ## 修复了什么
 *
 * 滑行途中每一格都要按**完整规则**判定。之前只判了
 * 「已走过 / 障碍 / 未开锁的门」，**漏掉了单向门箭头** ——
 * 于是「踩上冰块后一路滑到底」会直接**穿过**反向的单向门。
 *
 * 修复后的语义：
 *   - 滑行撞上**箭头不一致**的单向门 → **停在门前**；
 *   - 滑行撞上**编号不对**的星星 → 停在它前面；
 *   - 滑行途中捡到的**钥匙立刻生效**（后面的门能被它打开）；
 *   - 星星**不阻断**滑行（道具是行进中拿到的，不是障碍）。
 */
import { describe, it, expect } from 'vitest';
import { buildRuleSet, candidateMoves, stepMove } from '../src/core/cover/v3/rules';
import { CoverCell, DIR, packCell } from '../src/core/cover/v3/types';

/**
 * 用一维/二维网格构造规则集。
 *
 * @param rows 每行是格子类型；`null` 表示不可走（VOID）
 * @param dirs 每格的「方向」（单向门用）
 * @param groups 每格的分组（钥匙/门配对、星星编号）
 */
function makeRs(
  rows: (number | null)[][],
  dirs: number[][] = [],
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
      grid[idx] = packCell(t, dirs[y]?.[x] ?? 0, groups[y]?.[x] ?? 0);
      cells.push(idx);
    }
  }
  return buildRuleSet(cells, grid, w, h);
}

/** 一维网格（便于构造「直线滑行」场景）。 */
function line(cells: number[], dirs: number[] = [], groups: number[] = []): ReturnType<typeof buildRuleSet> {
  return makeRs(
    [cells],
    [dirs],
    [groups],
  );
}

describe('滑行 × 单向门', () => {
  it('滑行撞上箭头不一致的单向门 → 停在门前（不穿门）', () => {
    // 普通 | 冰块 | 单向门(朝右) | 普通
    //                       ↑ 滑行向右，遇到门（门允许向右离开）
    // 但**滑行方向向右、门箭头向右**是一致的 —— 这里要测的是不一致的情况。
    //
    // 改成：普通 | 冰块 | 单向门(朝上) | 普通
    // 滑行向右撞上门，但门只允许向上离开 → 方向不一致 → 停在门前。
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.ONEWAY, CoverCell.BRICK],
      [0, 0, DIR.UP, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0);
    expect(consumed, '应能走进冰块').not.toBeNull();
    // 冰块本身吃掉一格；单向门**不吃**（停在门前）
    expect(consumed).toEqual([1]);
    expect(consumed!.includes(2), '绝不能穿过单向门').toBe(false);
  });

  it('滑行撞上箭头一致的单向门 → 可以滑过去', () => {
    // 普通 | 冰块 | 单向门(朝右) | 普通
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.ONEWAY, CoverCell.BRICK],
      [0, 0, DIR.RIGHT, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0);
    expect(consumed).toEqual([1, 2, 3]);
  });

  it('单向门作为滑行落点时合法（箭头方向可继续滑行）', () => {
    // 滑行到单向门上停住时，**从它离开**仍要检查箭头。
    // 这里测：冰块右侧是单向门(朝上)，向右滑 → 停在门前（格 1）。
    // 若没有滑行，普通一步走到单向门（格 1）后只能向上离开。
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.ONEWAY],
      [0, 0, DIR.UP],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const moves = candidateMoves(rs, 0, visited, 0);
    const right = moves.find((mv) => mv.dir === DIR.RIGHT);
    expect(right, '向右的移动应存在').toBeTruthy();
    expect(right!.consumed).toEqual([1]);
  });

  it('反向滑行也遵守单向门箭头', () => {
    // 普通 | 单向门(朝右) | 冰块 | 普通
    // 从右端向左滑 → 撞上门，门的箭头是「朝右离开」，与向左滑行不一致 → 停在门前。
    const rs = line(
      [CoverCell.BRICK, CoverCell.ONEWAY, CoverCell.ICE, CoverCell.BRICK],
      [0, DIR.RIGHT, 0, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[3] = 1;

    const consumed = stepMove(rs, 3, DIR.LEFT, visited, 0);
    expect(consumed).toEqual([2]);
    expect(consumed!.includes(1), '不能从背面穿过单向门').toBe(false);
  });
});

describe('滑行 × 钥匙门', () => {
  it('滑行途中捡到的钥匙立刻生效（同一段滑行能开后面的门）', () => {
    // 普通 | 冰块 | 钥匙(0) | 门(0) | 普通
    // 向右滑：捡到钥匙 → 门应被打开 → 一路滑到底。
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.KEY, CoverCell.GATE, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0);
    expect(consumed, '钥匙应让门在同一次滑行中被打开').toEqual([1, 2, 3, 4]);
  });

  it('没有钥匙时，滑行停在锁住的门前', () => {
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.KEY, CoverCell.GATE, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;
    // 模拟「已经在别处捡到钥匙」之外的场景：把钥匙格换成普通格
    const rsNoKey = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.BRICK, CoverCell.GATE, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    );
    const visited2 = new Uint8Array(rsNoKey.n);
    visited2[0] = 1;

    const consumed = stepMove(rsNoKey, 0, DIR.RIGHT, visited2, 0);
    expect(consumed).toEqual([1, 2]);
    expect(consumed!.includes(3), '没有钥匙不能进门').toBe(false);
    expect(rs.typeOf[2]).toBe(CoverCell.KEY);
    expect(consumed).not.toBeNull();
  });

  it('Move 携带滑行后累积的 keyMask', () => {
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.KEY, CoverCell.GATE, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const moves = candidateMoves(rs, 0, visited, 0);
    const right = moves.find((mv) => mv.dir === DIR.RIGHT)!;
    expect(right.keyMask, '移动结束后应持有第 0 组钥匙').toBe(1);
    expect(right.key, '应报告拾取了第 0 组钥匙').toBe(1);
  });
});

describe('滑行 × 星星', () => {
  it('滑行途中按顺序捡到的星星逐格推进', () => {
    // 普通 | 冰块 | 星星(0) | 星星(1) | 普通
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.SHARD, CoverCell.SHARD, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0, 0);
    expect(consumed, '两颗星星应按 0→1 顺序被滑行吃掉').toEqual([1, 2, 3, 4]);
  });

  it('滑行遇到编号不对的星星 → 停在它前面', () => {
    // 普通 | 冰块 | 星星(1) | 普通   —— 期望收集的是 0 号
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.SHARD, CoverCell.BRICK],
      [0, 0, 0, 0],
      [0, 0, 1, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0, 0);
    expect(consumed).toEqual([1]);
    expect(consumed!.includes(2), '不能跨过乱序的星星').toBe(false);
  });

  it('Move 携带滑行后推进的 shardNext', () => {
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.SHARD, CoverCell.SHARD, CoverCell.BRICK],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const moves = candidateMoves(rs, 0, visited, 0, 0);
    const right = moves.find((mv) => mv.dir === DIR.RIGHT)!;
    expect(right.shardNext, '两颗星星后应推进到 2').toBe(2);
  });
});

describe('滑行 × 传送门', () => {
  it('滑行途中遇到传送门格：停在传送门上（传送门打断滑行）', () => {
    // 普通 | 冰块 | 传送门 | 普通
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.PORTAL, CoverCell.BRICK],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0);
    // 冰块 + 传送门（**传送门被吃掉**，但滑行到此为止）
    expect(consumed).toEqual([1, 2]);
    expect(consumed!.includes(3), '不能滑过传送门').toBe(false);
  });

  it('滑行撞上传送门 → 立刻传走，线头落在出口（不再「停在门上」）', () => {
    // 一行：普通 | 冰块 | 传送门(A) | 传送门(B)
    //
    // 2026-11-20 语义变更：传送是「进入即发生」，所以滑进 A 的那一步
    // 就把 B 一起吃掉，线头落在 B 上。旧行为是「停在 A、等玩家主动传」，
    // 那个中间态已经取消 —— 它让玩家以为传送门只是块砖。
    const rs = line(
      [CoverCell.BRICK, CoverCell.ICE, CoverCell.PORTAL, CoverCell.PORTAL],
      [0, 0, 0, 0],
      [0, 0, 0, 0], // 同一 group → 两格配成一对
    );
    const visited = new Uint8Array(rs.n);
    visited[0] = 1;

    const consumed = stepMove(rs, 0, DIR.RIGHT, visited, 0)!;
    // 滑行：吃掉冰块(1) → 进 A(2) → 连带 B(3)
    expect(consumed, '滑进 A 应连带 B').toEqual([1, 2, 3]);
    expect(consumed[consumed.length - 1], '线头应落在出口 B').toBe(3);
  });
});

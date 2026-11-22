import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_LEVELS, TUTORIAL_COUNT, FIRST_TUTORIAL_IDX,
  isTutorialLevel, tutorialByIndex, tutorialStepOf, nextTutorialIdx,
} from '../src/game/tutorial';
import { buildCoverRuntime, walkableCells } from '../src/game/coverLevel';
import { solve } from '../src/core/cover/v3/solver';
import { replay } from '../src/core/cover/v3/rules';
import { CoverCell, cellType } from '../src/core/cover/v3/types';
import { mulberry32 } from '../src/core/rng';

/**
 * 引导关的第一条不变量：**必须可解**。
 *
 * 这三关是手画的字符画，最容易出的错就是「画完发现无解」——
 * 而那在机器上不会报错，只会表现成「玩家卡在引导第 2 关，然后卸载」。
 * 所以用正式规则的求解器 + 回放逐关验证，和 1000 关正式表同一套标准。
 */

describe('引导关 · 结构', () => {
  it('共 3 关，关号连续递减', () => {
    expect(TUTORIAL_LEVELS).toHaveLength(TUTORIAL_COUNT);
    expect(TUTORIAL_LEVELS.map((t) => t.idx)).toEqual([-1, -2, -3]);
    expect(FIRST_TUTORIAL_IDX).toBe(-1);
  });

  it('关号是负数，永不与正式关号（1..1000）相撞', () => {
    for (const t of TUTORIAL_LEVELS) {
      expect(t.idx).toBeLessThan(0);
      expect(isTutorialLevel(t.idx)).toBe(true);
    }
    for (const idx of [0, 1, 47, 1000, 1001]) {
      expect(isTutorialLevel(idx)).toBe(false);
    }
  });

  it('每关都有起点和终点', () => {
    for (const t of TUTORIAL_LEVELS) {
      expect(t.level.startAt, `第 ${t.idx} 关缺起点`).toBeGreaterThanOrEqual(0);
      expect(t.level.endAt, `第 ${t.idx} 关缺终点`).toBeGreaterThanOrEqual(0);
      expect(t.level.startAt).not.toBe(t.level.endAt);
    }
  });

  it('尺寸逐关变大（3×3 → 4×4 → 5×5）', () => {
    expect(TUTORIAL_LEVELS.map((t) => t.level.w)).toEqual([3, 4, 5]);
  });

  it('每关标题与两行说明都不为空（卡片要能读）', () => {
    for (const t of TUTORIAL_LEVELS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.lines[0].length).toBeGreaterThan(0);
      expect(t.lines[1].length).toBeGreaterThan(0);
    }
  });
});

describe('引导关 · 可解性', () => {
  it.each(TUTORIAL_LEVELS.map((t) => [t.idx, t] as const))(
    '第 %s 关有解，且解用正式规则回放合法',
    (_idx, t) => {
      const rt = buildCoverRuntime(t.level);
      const res = solve(rt.rs, mulberry32(t.level.seed), rt.rs.startAt, 500_000, 0, 0, true);
      expect(res.path, `第 ${t.idx} 关求不出解`).not.toBeNull();

      const check = replay(rt.rs, res.path!);
      expect(check.ok, `第 ${t.idx} 关的解回放失败：${check.error}`).toBe(true);
    },
  );

  it('可走格数 = required（两者不一致时通关判定会永远不成立）', () => {
    for (const t of TUTORIAL_LEVELS) {
      expect(walkableCells(t.level).length).toBe(t.level.required);
    }
  });

  /**
   * 奇偶性（这轮踩过的坑，必须锁住）。
   *
   * 棋盘黑白染色后，哈密顿路径的每一步都在异色格之间跳 ——
   * 所以两个端点必须满足：
   *   - **偶盘**（可走格数为偶数）：两端**异色**
   *   - **奇盘**（可走格数为奇数）：两端**同色**
   *
   * 违反时盘面 100% 无解，而且手画时完全看不出来。
   * 第 2 关最初把终点放右下角（4×4 偶盘、与起点同色），写了 7 个候选全无解。
   */
  it('起点终点的奇偶性合法（偶盘异色 / 奇盘同色）', () => {
    for (const t of TUTORIAL_LEVELS) {
      const { w, startAt, endAt } = t.level;
      const colorOf = (i: number) => (Math.floor(i / w) + (i % w)) % 2;
      const n = walkableCells(t.level).length;
      const sameColor = colorOf(startAt) === colorOf(endAt);
      if (n % 2 === 0) {
        expect(sameColor, `第 ${t.idx} 关是偶盘（${n} 格），起终点必须异色`).toBe(false);
      } else {
        expect(sameColor, `第 ${t.idx} 关是奇盘（${n} 格），起终点必须同色`).toBe(true);
      }
    }
  });
});

describe('引导关 · 机制覆盖', () => {
  const typesOf = (i: number) => {
    const g = TUTORIAL_LEVELS[i].level.grid;
    return new Set(Array.from(g).map((b) => cellType(b)));
  };

  it('第 1 关只有普通格 + 起终点（不放任何障碍）', () => {
    const s = typesOf(0);
    expect(s.has(CoverCell.BLOCK)).toBe(false);
    expect(s.has(CoverCell.ICE)).toBe(false);
    expect(s.has(CoverCell.KEY)).toBe(false);
    expect(s.has(CoverCell.SHARD)).toBe(false);
    expect(s.has(CoverCell.PORTAL)).toBe(false);
    expect(s.has(CoverCell.ONEWAY)).toBe(false);
  });

  it('第 2 关有钥匙、门、冰面各至少一个', () => {
    const s = typesOf(1);
    expect(s.has(CoverCell.KEY)).toBe(true);
    expect(s.has(CoverCell.GATE)).toBe(true);
    expect(s.has(CoverCell.ICE)).toBe(true);
  });

  it('第 2 关的钥匙与门分组配对（1 把钥匙开 1 扇门）', () => {
    const g = TUTORIAL_LEVELS[1].level.grid;
    const keyGroups = Array.from(g).filter((b) => cellType(b) === CoverCell.KEY).map((b) => b & 0x03);
    const gateGroups = Array.from(g).filter((b) => cellType(b) === CoverCell.GATE).map((b) => b & 0x03);
    expect(keyGroups.sort()).toEqual(gateGroups.sort());
  });

  it('第 3 关有星屑（按序）与成对传送门', () => {
    const s = typesOf(2);
    expect(s.has(CoverCell.SHARD)).toBe(true);
    expect(s.has(CoverCell.PORTAL)).toBe(true);

    const g = TUTORIAL_LEVELS[2].level.grid;
    const portals = Array.from(g).filter((b) => cellType(b) === CoverCell.PORTAL).map((b) => b & 0x03);
    // 传送门必须成对：每个 group 恰好出现两次
    const counts = new Map<number, number>();
    for (const p of portals) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const [grp, c] of counts) {
      expect(c, `传送门 group ${grp} 出现了 ${c} 次，必须成对`).toBe(2);
    }
  });

  it('第 3 关星屑编号从 0 起连续（跳号会让「下一颗」永远不出现）', () => {
    const g = TUTORIAL_LEVELS[2].level.grid;
    const groups = Array.from(g)
      .filter((b) => cellType(b) === CoverCell.SHARD)
      .map((b) => b & 0x03)
      .sort((a, b) => a - b);
    expect(groups).toEqual(groups.map((_, i) => i));
  });
});

describe('引导关 · 序号换算', () => {
  it('tutorialStepOf 从 1 起，非引导关返回 0', () => {
    expect(tutorialStepOf(-1)).toBe(1);
    expect(tutorialStepOf(-2)).toBe(2);
    expect(tutorialStepOf(-3)).toBe(3);
    expect(tutorialStepOf(47)).toBe(0);
    expect(tutorialStepOf(-99)).toBe(0);
  });

  it('nextTutorialIdx 串完三关后返回 null', () => {
    expect(nextTutorialIdx(-1)).toBe(-2);
    expect(nextTutorialIdx(-2)).toBe(-3);
    expect(nextTutorialIdx(-3)).toBeNull();
    expect(nextTutorialIdx(47)).toBeNull();
  });

  it('tutorialByIndex 能按关号取回', () => {
    expect(tutorialByIndex(-2)?.idx).toBe(-2);
    expect(tutorialByIndex(47)).toBeUndefined();
  });
});

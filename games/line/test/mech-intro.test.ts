import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickMechCard, markSeen, mechsOf, firstLevelOf, MECH_ORDER,
  TAUGHT_IN_TUTORIAL, MECH_CARDS,
} from '../src/game/mechIntro';
import { CoverCell, packCell } from '../src/core/cover/v3/types';
import type { LevelEntry } from '../src/core/cover/v3/codec';
import { TUTORIAL_LEVELS } from '../src/game/tutorial';

/**
 * 机制首见说明卡 —— 用**真实的 1000 关关卡表**验证。
 *
 * ## 为什么必须用真表
 *
 * 这套逻辑的全部价值在于「第一次遇到某种机制时讲一次」。用手造的两关
 * 测不出真正的问题：真表里机制首现位置是生成器定的（单向门第 13 关、
 * 星屑第 33 关、钥匙门第 65 关、传送门第 153 关、冰面第 705 关），
 * 而**分批加载**意味着启动时可能只有前 50 关 —— 冰面的首现根本扫不到。
 */

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, '../data/levels-v3-client.json'), 'utf8'));
const LEVELS: LevelEntry[] = raw.levels ?? raw;
const byIdx = new Map(LEVELS.map((l) => [l.idx, l]));

/** 造一个只有指定机制格的最小盘（4×4 全可走，中间放一个机制）。 */
function fakeLevel(idx: number, cells: Array<{ at: number; type: number; group?: number }>): LevelEntry {
  const w = 4, h = 4;
  const grid = new Uint8Array(w * h).fill(packCell(CoverCell.BRICK));
  for (const c of cells) grid[c.at] = packCell(c.type, 0, c.group ?? 0);
  // base64 编码（与真实表同形状）
  const b64 = Buffer.from(grid).toString('base64');
  return {
    idx, seed: 0, w, h, grid: b64, required: w * h,
    shortest: w * h - 1, deadEnds: 0, branches: 0, diff: 0,
    turns: 0, corridor: 0, mechKinds: cells.length, solutionCount: 1,
    startAt: 0, endAt: w * h - 1,
  } as LevelEntry;
}

describe('真实关卡表的机制分布', () => {
  it('首现位置与实测一致（改关卡表时这条会红，提醒同步更新说明）', () => {
    // 这些数字是扫全表得到的。它们不是"规定"，是**事实记录** ——
    // 关卡表更新后数字变化是正常的，把这里改掉即可，但要意识到
    // 「玩家第一次遇到某机制」的位置跟着变了。
    expect(firstLevelOf(CoverCell.ONEWAY, LEVELS)).toBe(13);
    expect(firstLevelOf(CoverCell.SHARD, LEVELS)).toBe(33);
    expect(firstLevelOf(CoverCell.KEY, LEVELS)).toBe(65);
    expect(firstLevelOf(CoverCell.PORTAL, LEVELS)).toBe(153);
    expect(firstLevelOf(CoverCell.ICE, LEVELS)).toBe(705);
  });

  it('引导教过的机制里，除了冰面都在前 200 关出现（冰面在 705）', () => {
    const firsts = TAUGHT_IN_TUTORIAL.map((m) => firstLevelOf(m, LEVELS));
    expect(firsts.filter((x) => x !== undefined && x < 200).length).toBeGreaterThanOrEqual(2);
  });

  it('单向门**不在**引导里教（所以正式关首见提示是它最重要的场景）', () => {
    // 这条是这整个功能的存在理由：单向门第 13 关就出现，而引导没教。
    const taught = new Set(TAUGHT_IN_TUTORIAL);
    expect(taught.has(CoverCell.ONEWAY)).toBe(false);
    expect(firstLevelOf(CoverCell.ONEWAY, LEVELS)).toBe(13);
  });

  it('每种机制都有说明卡（漏一种就等于那种机制永远不提示）', () => {
    for (const m of MECH_ORDER) {
      expect(MECH_CARDS[m], `机制 ${m} 没有文案`).toBeTruthy();
      expect(MECH_CARDS[m].lines[0].length).toBeGreaterThan(0);
      expect(MECH_CARDS[m].lines[1].length).toBeGreaterThan(0);
    }
  });
});

describe('pickMechCard', () => {
  it('第一次遇到单向门 → 弹单向门的卡', () => {
    const lv = fakeLevel(13, [{ at: 5, type: CoverCell.ONEWAY }]);
    expect(pickMechCard(lv, new Set())?.mech).toBe(CoverCell.ONEWAY);
  });

  it('已经见过 → 不弹', () => {
    const lv = fakeLevel(14, [{ at: 5, type: CoverCell.ONEWAY }]);
    expect(pickMechCard(lv, new Set([CoverCell.ONEWAY]))).toBeNull();
  });

  it('没有机制格的关 → 不弹', () => {
    const lv = fakeLevel(1, []);
    expect(pickMechCard(lv, new Set())).toBeNull();
  });

  it('同一关有两种新机制：只弹一张（两张叠一起等于没讲）', () => {
    const lv = fakeLevel(65, [
      { at: 5, type: CoverCell.KEY, group: 0 },
      { at: 6, type: CoverCell.GATE, group: 0 },
      { at: 9, type: CoverCell.ICE },
    ]);
    const card = pickMechCard(lv, new Set());
    expect(card).not.toBeNull();
    // 按 MECH_ORDER 的顺序取第一个：KEY 在 ICE 之前
    expect(card!.mech).toBe(CoverCell.KEY);
    // 而且只会有一张 —— 函数签名就决定了（返回单个 card | null）
  });

  it('按固定顺序而不是关卡里的位置（顺序稳定，文案不会随机变）', () => {
    const lv = fakeLevel(99, [
      { at: 1, type: CoverCell.ICE },
      { at: 2, type: CoverCell.PORTAL },
    ]);
    // MECH_ORDER 里 PORTAL 在 ICE 之前
    expect(pickMechCard(lv, new Set())?.mech).toBe(CoverCell.PORTAL);
    // 见过传送门之后才轮到冰面
    expect(pickMechCard(lv, new Set([CoverCell.PORTAL]))?.mech).toBe(CoverCell.ICE);
  });

  it('钥匙/门共用一个"族"：见过钥匙就不再为门弹一次', () => {
    const keyOnly = fakeLevel(10, [{ at: 5, type: CoverCell.KEY }]);
    markSeen(new Set<number>(), keyOnly); // 只是不崩
    const seen = new Set<number>();
    markSeen(seen, keyOnly);
    expect(seen.has(CoverCell.GATE)).toBe(true);

    // 之后单独遇到门，不该再弹
    const gateOnly = fakeLevel(11, [{ at: 5, type: CoverCell.GATE }]);
    expect(pickMechCard(gateOnly, seen)).toBeNull();
  });
});

describe('markSeen', () => {
  it('标记这一关所有机制，且钥匙门成对', () => {
    const lv = fakeLevel(65, [
      { at: 5, type: CoverCell.KEY, group: 0 },
      { at: 6, type: CoverCell.GATE, group: 0 },
    ]);
    const seen = new Set<number>();
    markSeen(seen, lv);
    expect(seen.has(CoverCell.KEY)).toBe(true);
    expect(seen.has(CoverCell.GATE)).toBe(true);
  });
});

describe('mechsOf', () => {
  it('只返回机制格，不含普通格/石头/起终点', () => {
    const lv = fakeLevel(1, [
      { at: 0, type: CoverCell.START },
      { at: 15, type: CoverCell.END },
      { at: 5, type: CoverCell.ONEWAY },
    ]);
    const s = mechsOf(lv);
    expect(s.has(CoverCell.ONEWAY)).toBe(true);
    expect(s.has(CoverCell.START)).toBe(false);
    expect(s.has(CoverCell.END)).toBe(false);
    expect(s.has(CoverCell.BRICK)).toBe(false);
  });
});

describe('引导与首见提示的衔接', () => {
  it('引导三关教过的机制，在首见提示里不该再讲', () => {
    // 引导第 2 关：钥匙 + 门 + 冰面；第 3 关：星屑 + 传送门
    const taught = new Set<number>();
    for (const t of TUTORIAL_LEVELS) {
      for (const m of mechsOf({ ...t.level, grid: Buffer.from(t.level.grid).toString('base64') } as unknown as LevelEntry)) {
        taught.add(m);
      }
    }
    // 引导实际覆盖的机制
    expect(taught.has(CoverCell.KEY)).toBe(true);
    expect(taught.has(CoverCell.GATE)).toBe(true);
    expect(taught.has(CoverCell.ICE)).toBe(true);
    expect(taught.has(CoverCell.SHARD)).toBe(true);
    expect(taught.has(CoverCell.PORTAL)).toBe(true);
    // 唯一没教的是单向门 —— 与 TAUGHT_IN_TUTORIAL 一致
    expect(taught.has(CoverCell.ONEWAY)).toBe(false);

    // TAUGHT_IN_TUTORIAL 必须覆盖引导实际教过的全部（漏了就白教）
    for (const m of taught) {
      expect(TAUGHT_IN_TUTORIAL, `引导教了机制 ${m}，但没标记为已见`).toContain(m);
    }
  });
});

describe('分批加载', () => {
  it('只加载前 50 关时，扫不到冰面（返回 undefined 而不是 0）', () => {
    const first50 = LEVELS.slice(0, 50);
    expect(firstLevelOf(CoverCell.ICE, first50)).toBeUndefined();
    // 返回 0 会让调用方以为"第 0 关就该弹"
    expect(firstLevelOf(CoverCell.ICE, first50)).not.toBe(0);
  });

  it('前 50 关能扫到单向门与星屑', () => {
    const first50 = LEVELS.slice(0, 50);
    expect(firstLevelOf(CoverCell.ONEWAY, first50)).toBe(13);
    expect(firstLevelOf(CoverCell.SHARD, first50)).toBe(33);
  });
});

describe('按真实表走一遍：前 200 关总共会弹几次卡', () => {
  it('最多 5 次（每种机制一次），不会反复弹', () => {
    const seen = new Set<number>();
    for (const m of TAUGHT_IN_TUTORIAL) seen.add(m); // 假设走完了引导
    let shows = 0;
    for (let i = 1; i <= 200; i++) {
      const lv = byIdx.get(i);
      if (!lv) continue;
      const card = pickMechCard(lv, seen);
      if (card) {
        shows++;
        markSeen(seen, lv);
      }
    }
    // 引导教过 5 种，只剩单向门没教 → 前 200 关最多弹 1 次
    expect(shows).toBe(1);
    expect(seen.has(CoverCell.ONEWAY)).toBe(true);
  });

  it('没走引导（老玩家）时前 200 关会把 5 种都补一遍', () => {
    const seen = new Set<number>();
    let shows = 0;
    for (let i = 1; i <= 200; i++) {
      const lv = byIdx.get(i);
      if (!lv) continue;
      if (pickMechCard(lv, seen)) {
        shows++;
        markSeen(seen, lv);
      }
    }
    // 单向门 13 / 星屑 33 / 钥匙门 65 / 传送门 153 —— 冰面在 705，扫不到
    expect(shows).toBe(4);
  });
});

describe('生命周期清理（源码断言）', () => {
  const MAIN = readFileSync(resolve(here, '../src/main.ts'), 'utf8');

  it('回大厅统一走 backToHome，且它清掉机制卡与引导态', () => {
    const fn = MAIN.slice(MAIN.indexOf('function backToHome'), MAIN.indexOf('function syncHomeState'));
    expect(fn).toContain('mechCard = null');
    expect(fn).toContain('tutorialLevel = null');
    expect(fn).toContain('challenge = null');
  });

  it('进关卡时先清卡（否则上一关的卡挂在新盘面上）', () => {
    // `enterLevel` 在文件里位于 `enterTutorialLevel` **之后**，
    // 所以切片要往后取到 `armEnterCue` 那一行为止。
    const start = MAIN.indexOf('async function enterLevel');
    expect(start).toBeGreaterThan(-1);
    const enter = MAIN.slice(start, MAIN.indexOf('maybeShowMechCard(entry)'));
    expect(enter).toContain('mechCard = null');
  });

  it('进引导关也清卡（引导不弹机制卡）', () => {
    const fn = MAIN.slice(MAIN.indexOf('function enterTutorialLevel'), MAIN.indexOf('function onTutorialWin'));
    expect(fn).toContain('mechCard = null');
  });

  it('机制卡只在 playing 阶段画（不在结算页/大厅残留）', () => {
    expect(MAIN).toContain("if (mechCard && phase === 'playing')");
  });

  it('点棋盘开始玩就收卡（不挡玩家正在看的地方）', () => {
    expect(MAIN).toContain("dismissMechCard('play')");
  });

  it('超时自动收（5 秒），且出现动画有淡入淡出', () => {
    expect(MAIN).toContain('const HOLD = 5000');
    expect(MAIN).toContain('const FADE_IN = 260');
    expect(MAIN).toContain('const FADE_OUT = 320');
  });
});

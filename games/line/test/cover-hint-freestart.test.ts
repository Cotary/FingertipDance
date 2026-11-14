/**
 * 自由起点（D=0）关卡「还没下笔」时的提示。
 *
 * ## 这条用例为什么必须存在
 *
 * 提示器原本只会答一个问题：「从当前线头往后再怎么走」。
 * 可自由起点关卡在空盘上**根本没有线头** —— 求解器无从下手，
 * 直接返回「无提示」，而调用方对「无提示」不吭声。
 *
 * 表现就是：第 1 关（正是自由起点）点一下「提示」，什么都不发生。
 * 这是玩家第一次点提示就会撞上的洞，必须钉死。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import {
  beginCoverDrag,
  canStartAt,
  createCoverState,
  movesFrom,
  tryCoverMove,
  type CoverState,
} from '../src/game/coverState';
import { findCoverHint } from '../src/game/coverHint';
import { decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

/** 空盘、未下笔的状态（用户点提示时最常见的那个瞬间）。 */
function freshState(entry: LevelEntryWithSolution): CoverState {
  const level = decodeCoverLevel(entry);
  return createCoverState(buildCoverRuntime(level));
}

/** 均匀抽样。 */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length === 0) return [];
  const step = Math.max(1, Math.floor(arr.length / n));
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
}

const FREE_START = LEVELS.filter((l) => l.startAt < 0);
const PINNED_START = LEVELS.filter((l) => l.startAt >= 0);

describe('cover 提示 · 自由起点空盘', () => {
  it('第 1 关空盘点提示必须给出提示（这正是玩家第一个撞到的洞）', () => {
    const lv = LEVELS[0];
    expect(lv.startAt).toBe(-1); // 前提：第 1 关确实是自由起点

    const st = freshState(lv);
    const hint = findCoverHint(st);

    expect(hint.found).toBe(true);
    expect(hint.cells.length).toBeGreaterThanOrEqual(2);

    // 第一格必须是一个合法的起手格
    const firstLocal = st.runtime.rs.localOf[hint.cells[0]];
    expect(canStartAt(st, firstLocal)).toBe(true);
  });

  it('提示给出的起手格，真的能下笔并继续走', () => {
    const lv = LEVELS[0];
    const st = freshState(lv);
    const hint = findCoverHint(st);

    const firstLocal = st.runtime.rs.localOf[hint.cells[0]];
    expect(beginCoverDrag(st, firstLocal)).toBe(true);
    expect(st.path).toEqual([firstLocal]);

    // 提示的第二格应当是一步合法移动
    const secondLocal = st.runtime.rs.localOf[hint.cells[1]];
    expect(tryCoverMove(st, secondLocal)).toBe('moved');
  });

  it('抽样自由起点关卡：空盘提示要么给出合法起手，要么在时限内明确说「给不出」', () => {
    for (const lv of sample(FREE_START, 40)) {
      const st = freshState(lv);
      const t0 = Date.now();
      const hint = findCoverHint(st);
      const elapsed = Date.now() - t0;

      // 不许卡主线程
      expect(elapsed).toBeLessThan(600);

      if (!hint.found) {
        // 允许失败（预算内没搜到），但不许「说找不到却又给了格子」
        expect(hint.cells).toHaveLength(0);
        continue;
      }
      expect(hint.cells.length).toBeGreaterThanOrEqual(2);
      const firstLocal = st.runtime.rs.localOf[hint.cells[0]];
      expect(canStartAt(st, firstLocal)).toBe(true);
    }
  });

  it('钉死起点的关卡仍从起点出发（不能被「挑起手格」逻辑带偏）', () => {
    const lv = PINNED_START[0];
    if (!lv) return; // 数据里没有这类关卡就跳过
    const st = freshState(lv);
    const hint = findCoverHint(st);
    if (!hint.found) return;

    // 还没下笔 → 线头就是钉死的起点，提示的第一格必须是「起点一步能到」的格。
    // （提示序列不含线头本身，所以不是 equals(startAt)，而是 startAt 的合法下一步）
    expect(st.path).toHaveLength(0);
    const start = st.runtime.rs.startAt;
    const nextLocal = st.runtime.rs.localOf[hint.cells[0]];
    const legal = movesFrom(st, start).some((mv) => mv.consumed[0] === nextLocal);
    expect(legal).toBe(true);
  });
});

describe('cover 提示 · 参考解没有被下发', () => {
  it('提示结果不依赖关卡表里的 solution 字段', () => {
    // 客户端表（data/levels-v3-client.json）没有 solution，
    // 所以「靠参考解给提示」这条路根本不可用 —— 这条用例把假设钉住，
    // 免得以后有人又去读 solution 然后线上静默失效。
    const file = path.resolve(__dirname, '../data/levels-v3-client.json');
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: Array<Record<string, unknown>> };
    expect(raw.levels.length).toBeGreaterThan(0);
    expect('solution' in raw.levels[0]).toBe(false);

    // 而服务端表有 —— 两边的差异就是这条约束的来源
    expect(decodeSolution).toBeTypeOf('function');
  });
});

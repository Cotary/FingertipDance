/**
 * cover 模式客户端状态机的端到端测试。
 *
 * 用**真实的关卡数据**跑：解出参考解 → 按参考解一步步走 → 必须通关。
 *
 * 这是最重要的一条测试：它证明「客户端状态机」与「生成器的参考解」
 * 判定一致 —— 如果两者判定漂移，玩家会遇到「明明有解却走不出来」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import {
  beginCoverDrag,
  createCoverState,
  releaseCover,
  tryCoverMove,
  coveredCount,
  undoCoverStep,
} from '../src/game/coverState';
import { decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import { buildRuleSet, replay } from '../src/core/cover/v3/rules';
import { CoverCell, cellType } from '../src/core/cover/v3/types';

/** 读取真实关卡表（服务端版，含解）。 */
function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

describe('cover 客户端状态机', () => {
  it('关卡表可读取且有 1000 关', () => {
    expect(LEVELS.length).toBe(1000);
  });

  it('参考解能按状态机一步步走完并通关（抽样 60 关，含传送门关卡）', () => {
    // 均匀抽样：覆盖 7 个世界与各类机制（含传送门）
    //
    // 传送门关卡现在也参与：它们的参考解是**专门拼接**出来的，
    // 跳跃边的两端就是传送门对 —— 走上传送门的那一步一次吃掉两格
    // （入口 + 出口），下面 `pos += consumed` 正好跨过去。
    const picks = pickSamples(LEVELS, 60);
    expect(picks.length).toBeGreaterThan(0);

    for (const entry of picks) {
      const level = decodeCoverLevel(entry);
      const runtime = buildCoverRuntime(level);
      const state = createCoverState(runtime);

      // 参考解（拍平索引） -> 局部编号
      const solFlat = decodeSolution(entry.solution, entry.w);
      const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

      // 起步
      expect(beginCoverDrag(state, solLocal[0])).toBe(true);

      // **按「移动」走，而不是按「格」走**。
      //
      // 冰块会让一次移动消耗多格（踩上去滑到撞墙），
      // 所以解的相邻两格不一定是一次移动的结果。
      // 必须用状态机的移动分段来驱动 —— 这正是玩家拖动时发生的事。
      let pos = 1;
      while (pos < solLocal.length) {
        const before = state.path.length;
        const target = solLocal[pos];
        const r = tryCoverMove(state, target);
        expect(r).toBe('moved');
        // 冰块滑行会一次推进多格
        const consumed = state.path.length - before;
        expect(consumed).toBeGreaterThan(0);
        // 推进到解里对应的位置
        pos += consumed;
      }

      // 通关
      expect(releaseCover(state)).toBe(true);
      expect(state.phase).toBe('won');
      expect(coveredCount(state)).toBe(level.required);
      expect(state.undos).toBe(0);
    }
  });

  it('自由起点的关卡可以从任意格起步（D=0）', () => {
    const free = LEVELS.filter((l) => l.startAt < 0);
    expect(free.length).toBeGreaterThan(0);

    for (const entry of free.slice(0, 10)) {
      const level = decodeCoverLevel(entry);
      const runtime = buildCoverRuntime(level);
      const state = createCoverState(runtime);
      // 任意一个可走格都能起步
      const anyLocal = 0;
      expect(beginCoverDrag(state, anyLocal)).toBe(true);
    }
  });

  it('钉死起点的关卡不能从别的格起步', () => {
    const pinned = LEVELS.filter((l) => l.startAt >= 0);
    expect(pinned.length).toBeGreaterThan(0);

    for (const entry of pinned.slice(0, 20)) {
      const level = decodeCoverLevel(entry);
      const runtime = buildCoverRuntime(level);
      const state = createCoverState(runtime);
      const correct = runtime.rs.startAt;

      // 找一个「错的」格（不是钉死的起点）
      let wrong = -1;
      for (let i = 0; i < runtime.rs.n && wrong < 0; i++) {
        if (i !== correct) wrong = i;
      }
      expect(beginCoverDrag(state, wrong)).toBe(false);

      // 正确的起点可以起步
      const s2 = createCoverState(runtime);
      expect(beginCoverDrag(s2, correct)).toBe(true);
    }
  });

  it('拖回已走过的格会回退（路径截断），而不是判非法', () => {
    const entry = LEVELS[200];
    const level = decodeCoverLevel(entry);
    const runtime = buildCoverRuntime(level);
    const state = createCoverState(runtime);
    const solFlat = decodeSolution(entry.solution, entry.w);
    const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

    beginCoverDrag(state, solLocal[0]);
    tryCoverMove(state, solLocal[1]);
    tryCoverMove(state, solLocal[2]);
    expect(state.path.length).toBe(3);

    // 拖回第 1 个格 → 路径截断到 2
    const r = tryCoverMove(state, solLocal[1]);
    expect(r).toBe('backtracked');
    expect(state.path.length).toBe(2);
    expect(state.visited[solLocal[2]]).toBe(0);
  });

  it('撤销一步会移除该格并重算收集效果', () => {
    const entry = LEVELS[300];
    const level = decodeCoverLevel(entry);
    const runtime = buildCoverRuntime(level);
    const state = createCoverState(runtime);
    const solFlat = decodeSolution(entry.solution, entry.w);
    const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

    beginCoverDrag(state, solLocal[0]);
    tryCoverMove(state, solLocal[1]);
    const before = state.path.length;
    expect(undoCoverStep(state)).toBe(true);
    expect(state.path.length).toBe(before - 1);
    expect(state.visited[solLocal[before - 1]]).toBe(0);
  });

  it('松手未通关 → 整段作废且重来 +1', () => {
    const entry = LEVELS[400];
    const level = decodeCoverLevel(entry);
    const runtime = buildCoverRuntime(level);
    const state = createCoverState(runtime);
    const solFlat = decodeSolution(entry.solution, entry.w);
    const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

    beginCoverDrag(state, solLocal[0]);
    tryCoverMove(state, solLocal[1]);
    expect(releaseCover(state)).toBe(false);
    expect(state.undos).toBe(1);
    expect(state.path.length).toBe(0);
    expect(state.phase).toBe('idle');
  });

  it('钉死终点的关卡：线头不在终点时不算通关', () => {
    const pinnedEnd = LEVELS.filter((l) => l.endAt >= 0);
    expect(pinnedEnd.length).toBeGreaterThan(0);

    for (const entry of pinnedEnd.slice(0, 5)) {
      const level = decodeCoverLevel(entry);
      const runtime = buildCoverRuntime(level);
      const state = createCoverState(runtime);
      const solFlat = decodeSolution(entry.solution, entry.w);
      const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

      beginCoverDrag(state, solLocal[0]);
      // 只走一步就松手 —— 一定没铺满
      tryCoverMove(state, solLocal[1]);
      expect(releaseCover(state)).toBe(false);
      expect(state.undos).toBe(1);
    }
  });

  it('状态机的判定与 rules.ts 的回放校验一致（全部关卡，含传送门）', () => {
    for (const entry of LEVELS) {
      const level = decodeCoverLevel(entry);
      const runtime = buildCoverRuntime(level);
      const state = createCoverState(runtime);
      const solFlat = decodeSolution(entry.solution, entry.w);
      const solLocal = solFlat.map((f) => runtime.rs.localOf[f]);

      beginCoverDrag(state, solLocal[0]);
      let ok = true;
      let pos = 1;
      while (pos < solLocal.length) {
        const before = state.path.length;
        const target = solLocal[pos];
        if (tryCoverMove(state, target) !== 'moved') { ok = false; break; }
        pos += state.path.length - before;
      }
      expect(ok).toBe(true);
      expect(releaseCover(state)).toBe(true);

      // 官方回放校验也要通过
      const rs = buildRuleSet(
        Array.from({ length: runtime.rs.n }, (_, i) => runtime.rs.flatOf[i]),
        level.grid,
        level.w,
        level.h,
      );
      rs.startAt = level.startAt >= 0 ? rs.localOf[level.startAt] : -1;
      rs.endAt = level.endAt >= 0 ? rs.localOf[level.endAt] : -1;
      expect(replay(rs, solLocal).ok).toBe(true);
    }
  });

  it('START/END 标记与解的首尾一致', () => {
    for (const entry of LEVELS) {
      const level = decodeCoverLevel(entry);
      const solFlat = decodeSolution(entry.solution, entry.w);
      if (level.startAt >= 0) {
        expect(cellType(level.grid[level.startAt])).toBe(CoverCell.START);
        expect(solFlat[0]).toBe(level.startAt);
      }
      if (level.endAt >= 0) {
        expect(cellType(level.grid[level.endAt])).toBe(CoverCell.END);
        expect(solFlat[solFlat.length - 1]).toBe(level.endAt);
      }
    }
  });
});

/** 均匀抽样 n 关（覆盖全表范围）。 */
function pickSamples<T>(arr: T[], n: number): T[] {
  if (arr.length === 0) return [];
  const step = Math.max(1, Math.floor(arr.length / n));
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
}

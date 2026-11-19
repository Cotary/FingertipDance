/**
 * 端到端：用**真实关卡**验证终点约束。
 *
 * 前面 `cover-end-constraint.test.ts` 用的是手搓小盘，验的是规则层判据。
 * 这份验的是「真实关卡 + 真实状态机」下的行为：
 *   1. 在解路径里，END 之前的任意一步上，拖向 END 必须是 `blocked`
 *   2. 走到只剩 END 时，拖向 END 必须成功
 *   3. 走完之后的 `isCoverSolved` 必须是 true
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CoverCell } from '../src/core/cover/v3/types';
import { buildRuleSet } from '../src/core/cover/v3/rules';
import { decodeGrid, decodeSolution } from '../src/core/cover/v3/codec';
import { buildCoverRuntime } from '../src/game/coverLevel';
import { createCoverState, tryCoverMove, isCoverSolved } from '../src/game/coverState';
import type { CoverRuntime } from '../src/game/coverLevel';

const TABLE = path.join(__dirname, '..', 'data', 'levels-v3.json');

interface Entry {
  idx: number;
  w: number;
  h: number;
  grid: string;
  required: number;
  startAt: number;
  endAt: number;
  solution: string;
}

function loadLevels(): Entry[] {
  if (!fs.existsSync(TABLE)) return [];
  const raw = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
  return raw.levels ?? raw;
}

/**
 * 把关卡表条目变成运行时能吃的 level。
 *
 * ⚠️ 之后**必须走 `buildCoverRuntime`** —— 起终点的局部编号是它在建完
 * RuleSet 之后用 `rs.localOf[level.endAt]` 换算写进去的。
 * `buildRuleSet` 本身默认给 -1；我第一版自己手搓运行时、漏了这一步，
 * 于是 `rs.endAt` 恒为 -1，终点约束整个不生效，测试假红
 * （"END 应在末位 expected -1"）。
 */
function levelOf(e: Entry): CoverRuntime['level'] {
  return {
    idx: e.idx,
    seed: 1,
    w: e.w,
    h: e.h,
    grid: decodeGrid(e.grid, e.w * e.h),
    required: e.required,
    deadEnds: 0,
    diff: 0,
    startAt: e.startAt,
    endAt: e.endAt,
    mechKinds: 1,
    solutionCount: 1,
  };
}

/** 把参考解换算成局部编号序列。 */
function solutionPath(e: Entry, rs: ReturnType<typeof buildRuleSet>): number[] {
  const flat = decodeSolution(e.solution, e.w);
  return flat.map((f) => rs.localOf[f]);
}

/** 把一串局部编号灌进状态（模拟"已经走到这里"）。 */
function prefill(state: ReturnType<typeof createCoverState>, rs: ReturnType<typeof buildRuleSet>, cells: number[]): void {
  state.phase = 'dragging';
  for (const c of cells) {
    state.path.push(c);
    state.visited[c] = 1;
    const t = rs.typeOf[c];
    if (t === CoverCell.KEY) state.keyMask |= 1 << rs.groupOf[c];
    if (t === CoverCell.SHARD) state.shardNext = rs.groupOf[c] + 1;
  }
}

describe('终点约束（真实关卡）', () => {
  const levels = loadLevels().filter((e) => e.endAt >= 0 && e.solution);

  it('数据存在（没有关卡表就跳过）', () => {
    expect(levels.length).toBeGreaterThan(0);
  });

  it('解路径中途拖向 END 一律被拒', () => {
    let checked = 0;
    for (const e of levels.slice(0, 200)) {
      const rt = buildCoverRuntime(levelOf(e));
      const rs = rt.rs;
      const full = solutionPath(e, rs);
      if (full.length < 6) continue;
      const endLocal = rs.endAt;
      expect(endLocal, `关卡 ${e.idx} 应有终点`).toBeGreaterThanOrEqual(0);
      expect(full.indexOf(endLocal), `关卡 ${e.idx} 的 END 应在末位`).toBe(full.length - 1);

      // 只铺到一半，然后试着拖向 END。
      //
      // ⚠️ 不能铺到「倒数第二格」再试 —— 那时从线头拖向 END，
      // `autoFill` 会顺路把中间那格一起吃掉，**正好补满全盘**，
      // 那本来就是合法的收尾。我第一版就是这么写的，于是关卡 183 假红。
      // 铺到一半则无论怎么拖都补不满剩下的十几格，必须被拒。
      const state = createCoverState(rt);
      prefill(state, rs, full.slice(0, Math.floor(full.length / 2)));

      const res = tryCoverMove(state, endLocal);
      expect(res, `关卡 ${e.idx} 中途不该能进 END`).not.toBe('moved');
      expect(state.visited[endLocal], `关卡 ${e.idx}：END 不该被标记已走`).toBeFalsy();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('只剩 END 时，拖过去成功且判定通关（抽 40 关）', () => {
    let done = 0;
    for (const e of levels.slice(0, 120)) {
      const rt = buildCoverRuntime(levelOf(e));
      const rs = rt.rs;
      const full = solutionPath(e, rs);
      if (full.length < 3) continue;

      const state = createCoverState(rt);
      prefill(state, rs, full.slice(0, full.length - 1));

      // 此刻只剩 END → 必须能进
      const res = tryCoverMove(state, rs.endAt);
      expect(res, `关卡 ${e.idx} 最后一步应能进 END`).toBe('moved');
      expect(isCoverSolved(state), `关卡 ${e.idx} 应判定通关`).toBe(true);
      done++;
      if (done >= 40) break;
    }
    expect(done).toBeGreaterThan(0);
  });

  /**
   * 真实拖动：走到全程 1/3 处就拖向终点。
   *
   * 与上一条的区别：上一条只验"拖不进去"，这条还验**状态没被污染**
   * （END 不进 path、不判通关、路径长度不变）。
   * 中途拖进去最糟的不是"走不了"，而是"走进去了、之后才发现白走"——
   * 那正是用户报的那个 bug 的体验。
   */
  it('中途拖向 END：被拒，且 END 不进路径、不判通关', () => {
    let tested = 0;
    for (const e of levels.slice(0, 300)) {
      const rt = buildCoverRuntime(levelOf(e));
      const rs = rt.rs;
      const full = solutionPath(e, rs);
      if (full.length < 8) continue;

      const state = createCoverState(rt);
      prefill(state, rs, full.slice(0, Math.floor(full.length / 3)));

      const before = state.path.length;
      const res = tryCoverMove(state, rs.endAt);

      expect(res, `关卡 ${e.idx}: 中途拖 END 不该成功`).not.toBe('moved');
      expect(state.path.includes(rs.endAt), `关卡 ${e.idx}: END 不该进路径`).toBe(false);
      expect(isCoverSolved(state), `关卡 ${e.idx}: 不该判通关`).toBe(false);
      expect(state.path.length, `关卡 ${e.idx}: 路径不该变长`).toBe(before);
      tested++;
    }
    expect(tested).toBeGreaterThan(50);
  });
});

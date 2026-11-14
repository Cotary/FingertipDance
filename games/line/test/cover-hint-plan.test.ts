/**
 * 提示路线（可跟随的完整路线）的测试。
 *
 * ## 与「高亮两格」的根本区别
 *
 * 旧提示是一个**集合**：给 3 格，玩家走一步就清空，再点再给 3 格。
 * 新提示是一条**带游标的路线**：整条路线一次算完，只有窗口内的
 * `HINT_WINDOW` 格是亮的；玩家照着走，游标前进、窗口滑动；
 * 一旦偏离，整条作废（不是模糊地留一半）。
 *
 * 这套语义必须钉死，因为它是「提示能不能一路跟着走完」的全部依据：
 * 游标错一格，窗口就整体偏一格，玩家照着走会死。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import {
  HINT_WINDOW,
  beginCoverDrag,
  createCoverState,
  failCover,
  isCoverSolved,
  movesFrom,
  setHintPlan,
  tryCoverMove,
  type CoverState,
} from '../src/game/coverState';
import { findCoverHint } from '../src/game/coverHint';
import type { LevelEntryWithSolution } from '../src/core/cover/v3/codec';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

/** 固定时刻 —— 断言 litAt 时不能依赖真实时钟。 */
const NOW = 1_700_000_000_000;

function fresh(entry: LevelEntryWithSolution): CoverState {
  return createCoverState(buildCoverRuntime(decodeCoverLevel(entry)));
}

/** 找一条够长的路线（窗口才有「滑」的余地）。 */
function longLevel(): LevelEntryWithSolution | undefined {
  for (const lv of LEVELS) {
    const st = fresh(lv);
    const hint = findCoverHint(st);
    if (hint.found && hint.cells.length > HINT_WINDOW + 2) return lv;
  }
  return undefined;
}

describe('cover 提示路线 · 窗口', () => {
  it('只点亮窗口内的 5 格，其余等窗口滑过来才亮', () => {
    const lv = longLevel();
    if (!lv) return;
    const st = fresh(lv);
    const hint = findCoverHint(st);
    setHintPlan(st, hint.cells, NOW);

    const plan = st.hint;
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.at).toBe(0);
    const litCount = plan.litAt.filter((t) => t > 0).length;
    expect(litCount).toBe(HINT_WINDOW);
    // 第 6 格必须还没点亮
    expect(plan.litAt[HINT_WINDOW]).toBe(0);
  });

  it('窗口内是错峰点亮的（不是「啪」地全亮）', () => {
    const lv = longLevel();
    if (!lv) return;
    const st = fresh(lv);
    setHintPlan(st, findCoverHint(st).cells, NOW);
    const plan = st.hint;
    if (!plan) return;

    // 严格递增：读起来才像一只手电沿着路线扫过去
    for (let k = 1; k < HINT_WINDOW; k++) {
      expect(plan.litAt[k]).toBeGreaterThan(plan.litAt[k - 1]);
    }
    expect(plan.litAt[0]).toBeGreaterThanOrEqual(NOW);
  });

  it('提示路线长度 = 剩余待走格数（不含线头）', () => {
    const lv = LEVELS[0];
    if (!lv) return;
    const st = fresh(lv);
    const hint = findCoverHint(st);
    if (!hint.found) return;

    expect(hint.cells.length).toBe(st.runtime.rs.n - st.path.length);
  });
});

describe('cover 提示路线 · 跟着走', () => {
  it('自由起点：按下提示的第一格 = 兑现第一格，不算偏离', () => {
    const lv = LEVELS.find((l) => fresh(l).runtime.rs.startAt < 0);
    if (!lv) return;
    const st = fresh(lv);
    const cells = findCoverHint(st).cells;
    if (cells.length === 0) return;

    setHintPlan(st, cells, NOW);
    const first = st.runtime.rs.localOf[cells[0]];
    expect(beginCoverDrag(st, first)).toBe(true);

    expect(st.hint, '按下起手格不该把提示清掉').not.toBeNull();
    expect(st.hint?.at).toBe(1);
  });

  it('钉死起点：按下起点不会误伤提示', () => {
    const lv = LEVELS.find((l) => fresh(l).runtime.rs.startAt >= 0);
    if (!lv) return;
    const st = fresh(lv);
    const cells = findCoverHint(st).cells;
    if (cells.length === 0) return;

    setHintPlan(st, cells, NOW);
    expect(beginCoverDrag(st, st.runtime.rs.startAt)).toBe(true);

    // 钉死起点时提示是「起点之后怎么走」，起点本身不该被当成路线的一格
    expect(st.hint).not.toBeNull();
    expect(st.hint?.at).toBe(0);
  });

  it('照着走一步：游标前进、尾部补亮一格', () => {
    const lv = longLevel();
    if (!lv) return;
    const st = fresh(lv);
    const cells = findCoverHint(st).cells;
    setHintPlan(st, cells, NOW);

    const first = st.runtime.rs.localOf[cells[0]];
    if (!beginCoverDrag(st, first)) return;

    const next = st.runtime.rs.localOf[cells[1]];
    const r = tryCoverMove(st, next);
    if (r !== 'moved') return; // 冰块等机制导致跨格，另有用例覆盖

    const plan = st.hint;
    expect(plan, '照着走不该清提示').not.toBeNull();
    if (!plan) return;
    expect(plan.at).toBe(2);
    // 窗口滑过来之后，原来第 6 格（下标 5）应该已经点亮
    expect(plan.litAt[1 + HINT_WINDOW - 1]).toBeGreaterThan(0);
  });

  it('偏离路线：整条立刻作废', () => {
    const lv = LEVELS[0];
    if (!lv) return;
    const st = fresh(lv);
    const cells = findCoverHint(st).cells;
    if (cells.length < 3) return;
    setHintPlan(st, cells, NOW);

    const start = st.runtime.rs.localOf[cells[0]];
    if (!beginCoverDrag(st, start)) return;

    // 找一个「合法但不是提示建议」的落点
    const head = st.path[st.path.length - 1];
    const suggest = st.runtime.rs.localOf[cells[1]];
    const alt = movesFrom(st, head)
      .map((mv) => mv.consumed[0])
      .find((c) => c !== suggest);
    if (alt === undefined) return; // 本关只有一条合法走法，跳过

    expect(tryCoverMove(st, alt)).toBe('moved');
    expect(st.hint, '走岔了还留着提示 = 给玩家指错路').toBeNull();
  });

  it('整段作废后，提示一起清掉', () => {
    const lv = LEVELS[0];
    if (!lv) return;
    const st = fresh(lv);
    setHintPlan(st, findCoverHint(st).cells, NOW);
    failCover(st);
    expect(st.hint).toBeNull();
  });

  it('沿提示一路走完：能真的通关，且游标刚好走到底', () => {
    const lv = LEVELS[0];
    if (!lv) return;
    const st = fresh(lv);
    const cells = findCoverHint(st).cells;
    if (cells.length === 0) return;

    setHintPlan(st, cells, NOW);
    if (!beginCoverDrag(st, st.runtime.rs.localOf[cells[0]])) return;

    for (const flat of cells) {
      const local = st.runtime.rs.localOf[flat];
      // 冰块滑行会一次吃掉后面几格，跳过已走过的
      if (st.visited[local]) continue;
      const r = tryCoverMove(st, local);
      if (r !== 'moved') break;
    }

    expect(isCoverSolved(st), '照着提示走居然走不通').toBe(true);
    expect(st.hint?.at ?? -1).toBe(cells.length);
    expect(st.hint?.cells.length).toBe(cells.length);
  });
});

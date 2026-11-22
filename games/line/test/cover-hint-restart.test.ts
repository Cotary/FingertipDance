/**
 * 点提示 = 清空当前连线，从空盘重新给路线。
 *
 * ## 这条测试守的是什么
 *
 * 旧提示是「接在当前线头后面」：玩家走岔了，提示只能围着错路打转。
 * 新契约是「点提示先把这一笔清掉，再按空盘求整关路线」。
 *
 * 两个容易改坏的边界：
 * 1. 清空**不能**增加 `undos` —— 提示不是玩家走错，不该扣星；
 * 2. 清空后必须真的回到空盘（路径 / 覆盖数 / 钥匙 / 星星 / 旧提示全归零），
 *    否则求出来的还是「接着错路走」的路线。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import { CoverSession } from '../src/game/coverSession';
import { findCoverHint } from '../src/game/coverHint';
import { setHintPlan } from '../src/game/coverState';
import { decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import type { CoverRuntime } from '../src/game/coverLevel';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] }).levels;
}

const LEVELS = loadLevels();

/** 挑一关机制最少的（纯铺满、自由起点），让测试只验证「清空」本身。 */
function pickPlainLevel(): LevelEntryWithSolution {
  const plain = LEVELS.find((l) => l.mechKinds === 0 && l.startAt < 0 && l.endAt < 0);
  return plain ?? LEVELS[0];
}

function setup(): { session: CoverSession; runtime: CoverRuntime; solFlat: number[] } {
  const entry = pickPlainLevel();
  const level = decodeCoverLevel(entry);
  const runtime = buildCoverRuntime(level);
  const session = new CoverSession();
  session.load(runtime);
  return { session, runtime, solFlat: decodeSolution(entry.solution, entry.w) };
}

function screenOf(session: CoverSession, flat: number): { x: number; y: number } {
  const layout = session.layout!;
  const w = session.state!.runtime.level.w;
  const cx = flat % w;
  const cy = Math.floor(flat / w);
  return {
    x: layout.originX + cx * layout.cell + layout.cell / 2,
    y: layout.originY + cy * layout.cell + layout.cell / 2,
  };
}

/** 沿参考解走到第 `n` 格（不含松手）。 */
function dragTo(session: CoverSession, solFlat: number[], n: number): void {
  const p0 = screenOf(session, solFlat[0]);
  session.pointerDown(p0.x, p0.y);
  for (let i = 1; i < n; i++) {
    const p = screenOf(session, solFlat[i]);
    session.pointerMove(p.x, p.y);
  }
}

describe('提示前重来（restartForHint）', () => {
  it('松手后清空：路径 / 覆盖 / 旧提示归零，回到 idle', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();
    expect(session.state!.phase).toBe('paused');
    expect(session.covered()).toBe(4);

    // 先装一条旧提示，确认重来时一起清掉
    setHintPlan(session.state!, [solFlat[solFlat.length - 1]]);
    expect(session.state!.hint).not.toBeNull();

    session.restartForHint();

    expect(session.state!.phase).toBe('idle');
    expect(session.state!.path.length).toBe(0);
    expect(session.covered()).toBe(0);
    expect(session.state!.keyMask).toBe(0);
    expect(session.state!.shardNext).toBe(0);
    expect(session.state!.hint).toBeNull();
  });

  it('拖动中清空也能回到 idle（之后松手不该再判 paused）', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    expect(session.state!.phase).toBe('dragging');

    session.restartForHint();
    session.pointerUp();

    expect(session.state!.phase).toBe('idle');
    expect(session.state!.path.length).toBe(0);
  });

  it('清空不增加重来次数 —— 提示不该扣星', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();
    expect(session.state!.undos).toBe(0);

    session.restartForHint();
    expect(session.state!.undos).toBe(0);

    // 再来一次也一样：提示可以反复点，星级不该被提示吃掉
    dragTo(session, solFlat, 2);
    session.pointerUp();
    session.restartForHint();
    expect(session.state!.undos).toBe(0);
  });

  it('清空后按空盘求提示：路线覆盖整关，而不是剩余部分', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 6);
    session.pointerUp();
    session.restartForHint();

    const st = session.state!;
    const hint = findCoverHint(st);
    expect(hint.found).toBe(true);
    // 自由起点：整关每一格都要走，提示长度 = 可走格总数
    expect(hint.cells.length).toBe(st.runtime.rs.n);
  });
});

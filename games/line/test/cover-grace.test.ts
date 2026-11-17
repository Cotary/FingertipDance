/**
 * 松手后定住（`CoverSession` 的 paused 态）。
 *
 * ## 这条测试守的是什么
 *
 * 触屏上「抬手指」和「认输」是两件事。老实现里 `pointerUp` 一抬手就
 * `undos++` + 清空路径 —— 手指出汗、拇指滑出棋盘、想看看盘面，
 * 任何一次误抬都直接掉一颗星（3 星要零重来）。玩家体感是「莫名其妙被扣星」。
 *
 * 中间版本给过 1.5 秒宽限，但那引入了新问题：玩家放下手机想想，
 * 回来发现线自己没了，而且没有任何解释 —— 倒计时本身就是压力。
 *
 * 现在的契约（**松手即定住，保持原状**）：
 *
 * 1. 松手未通关 → `paused`，路径 / 钥匙 / 星星**全部保留**，`undos` 不变
 * 2. 松手后**永远不作废** —— 停多久都不掉星、不清线（没有倒计时）
 * 3. 按回**线头**或**线头邻格** → 接着拖，走完照样是 3 星
 * 4. 按**别处**（隔了两格以上）→ 视为要重新起一笔，作废（`undos + 1`）后照常起步
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import { CoverSession, GRACE_MS } from '../src/game/coverSession';
import { decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import type { CoverRuntime } from '../src/game/coverLevel';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] }).levels;
}

const LEVELS = loadLevels();

/** 挑一关机制最少的（纯铺满），让测试只验证宽限逻辑本身。 */
function pickPlainLevel(): LevelEntryWithSolution {
  const plain = LEVELS.find((l) => l.mechKinds === 0 && l.startAt < 0 && l.endAt < 0);
  return plain ?? LEVELS[0];
}

/** 用参考解驱动会话：返回参考解的拍平序列。 */
function setup(): { session: CoverSession; runtime: CoverRuntime; solFlat: number[] } {
  const entry = pickPlainLevel();
  const level = decodeCoverLevel(entry);
  const runtime = buildCoverRuntime(level);
  const session = new CoverSession();
  session.load(runtime);
  return { session, runtime, solFlat: decodeSolution(entry.solution, entry.w) };
}

/** 拍平索引 → 屏幕（设计坐标）中心点。 */
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

/** 按住起点、沿参考解走到第 `n` 格（不含松手）。 */
function dragTo(session: CoverSession, solFlat: number[], n: number): void {
  const p0 = screenOf(session, solFlat[0]);
  session.pointerDown(p0.x, p0.y);
  for (let i = 1; i < n; i++) {
    const p = screenOf(session, solFlat[i]);
    session.pointerMove(p.x, p.y);
  }
}

describe('松手宽限期', () => {
  it('关卡表可用', () => {
    expect(LEVELS.length).toBe(1000);
  });

  it('松手未通关 → paused，路径与重来次数都不动', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    expect(session.state!.path.length).toBe(4);

    session.pointerUp();

    expect(session.state!.phase).toBe('paused');
    expect(session.state!.path.length).toBe(4);   // 路径还在
    expect(session.state!.undos).toBe(0);         // 没被扣星
    // 已覆盖的格也没被清 —— 屏幕上那条线是真的还在
    expect(session.covered()).toBe(4);
  });

  it('宽限内按回线头 → 接着拖到底，仍是零重来', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    const head = screenOf(session, solFlat[3]);
    session.pointerDown(head.x, head.y);
    expect(session.state!.phase).toBe('dragging');
    expect(session.state!.path.length).toBe(4);   // 续接不重跑

    for (let i = 4; i < solFlat.length; i++) {
      const p = screenOf(session, solFlat[i]);
      session.pointerMove(p.x, p.y);
    }
    session.pointerUp();

    expect(session.state!.phase).toBe('won');
    expect(session.state!.undos).toBe(0);
    expect(session.state!.path.length).toBe(solFlat.length);
  });

  it('宽限内按别处 → 立刻作废，并从新按下的格重新起步', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    // 按一个明显不在线上的格（参考解末端）
    const away = screenOf(session, solFlat[solFlat.length - 1]);
    session.pointerDown(away.x, away.y);

    expect(session.state!.undos).toBe(1);
    expect(session.state!.phase).toBe('dragging');
    expect(session.state!.path.length).toBe(1);
    expect(session.state!.path[0]).toBe(session.state!.runtime.rs.localOf[solFlat[solFlat.length - 1]]);
  });

  it('宽限内点线头的邻格 → 当作接着走一格，不作废也不扣星', () => {
    // 触屏上一多半人是「点着走」而不是「拖」：点起点、点右边一格。
    // 老实现把这一下判成"按别处"，整条线作废 —— 手没滑、步没错却被打断
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    const next = screenOf(session, solFlat[4]);
    session.pointerDown(next.x, next.y);

    expect(session.state!.undos).toBe(0);            // 一颗星都不能掉
    expect(session.state!.phase).toBe('dragging');   // 续上了，可以继续点/拖
    expect(session.state!.path.length).toBe(5);      // 邻格真的被吃进去了

    // 接着一路点到底，照样零重来通关
    session.pointerUp();
    for (let i = 5; i < solFlat.length; i++) {
      const p = screenOf(session, solFlat[i]);
      session.pointerDown(p.x, p.y);
      session.pointerUp();
    }
    expect(session.state!.phase).toBe('won');
    expect(session.state!.undos).toBe(0);
  });

  it('宽限内点隔了两格的地方 → 仍按「按别处」作废（单点不补齐远处）', () => {
    // 放宽到邻格就够了：再放宽到"同行任意远"会让路径凭空长出两格，
    // 玩家看不出中间是怎么填的。远距离是"拖"的语义
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    const far = screenOf(session, solFlat[6]);
    session.pointerDown(far.x, far.y);
    expect(session.state!.undos).toBe(1);
  });

  it('松手后停多久都不作废（没有倒计时）', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    const t0 = Date.now();
    // 连推 10 分钟的游戏时间：早先的 1.5 秒宽限早就该作废了
    for (const dt of [50, 1000, 60_000, 600_000]) {
      session.tick(t0 + dt);
      expect(session.state!.phase).toBe('paused');
      expect(session.state!.undos).toBe(0);
      expect(session.state!.path.length).toBe(4);
      expect(session.covered()).toBe(4);
    }
  });

  it('graceRemain 恒为 0（没有倒计时可显示）', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();
    expect(session.graceRemain()).toBe(0);
    expect(session.graceRemain(Date.now() + 60_000)).toBe(0);
  });

  it('宽限内指针移动不产生任何效果（手还在屏上滑过）', () => {
    const { session, solFlat } = setup();
    dragTo(session, solFlat, 4);
    session.pointerUp();

    const p = screenOf(session, solFlat[5]);
    session.pointerMove(p.x, p.y);
    expect(session.state!.path.length).toBe(4);

    // 而且按回线头照样能续
    const head = screenOf(session, solFlat[3]);
    session.pointerDown(head.x, head.y);
    expect(session.state!.phase).toBe('dragging');
  });

  it('GRACE_MS 是「无限」—— 松手定住的显式声明', () => {
    expect(GRACE_MS).toBe(Number.POSITIVE_INFINITY);
  });
});

/**
 * 无效落子的**反馈**（`blocked` 事件）。
 *
 * ## 为什么要有这条事件
 *
 * 早先点石头 / 没钥匙开门，会话层什么都不发。表现是：玩家点上去一片死寂，
 * 连震一下都没有。他会以为"点了没反应（卡了 / 没点准）"，于是再点一次，
 * 再点一次 —— 而这一格其实已经明确地拒绝了他。
 *
 * 现在必须带 `idx` 出来：视觉要抖**那一格**，声音要落**那一格**。
 * 不带的旧版（`{ type: 'blocked' }`）只能抖整块盘，或者干脆不抖。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import { CoverSession, type CoverSessionEvent } from '../src/game/coverSession';
import { CoverCell, cellType } from '../src/core/cover/v3/types';
import type { LevelEntry } from '../src/core/cover/v3/codec';

const FILE = path.resolve(__dirname, '../data/levels-v3.json');
const LEVELS = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as { levels: LevelEntry[] }).levels;

function screenOf(session: CoverSession, flat: number): { x: number; y: number } {
  const layout = session.layout!;
  const w = session.state!.runtime.level.w;
  return {
    x: layout.originX + (flat % w) * layout.cell + layout.cell / 2,
    y: layout.originY + Math.floor(flat / w) * layout.cell + layout.cell / 2,
  };
}

/** 第一次点在这块盘上**没有**画出一笔（石头 / 空格 / 关卡还没加载）。 */
function blockedEvents(session: CoverSession): CoverSessionEvent[] {
  const out: CoverSessionEvent[] = [];
  session.on((e) => { if (e.type === 'blocked') out.push(e); });
  return out;
}

describe('无效落子 · 点石头', () => {
  it('点在有石头的格上 → blocked 带着那一格', () => {
    // 找一关开局就带石头的（第 8 关起就有）
    const entry = LEVELS.find((l) => {
      const g = Buffer.from(l.grid, 'base64');
      return g.some((b) => ((b >> 4) & 0x0f) === CoverCell.BLOCK);
    });
    expect(entry, '关卡表里没有带石头的关').toBeTruthy();

    const level = decodeCoverLevel(entry!);
    const session = new CoverSession();
    session.load(buildCoverRuntime(level));
    const events = blockedEvents(session);

    const grid = level.grid;
    let blockIdx = -1;
    for (let i = 0; i < grid.length; i++) {
      if (cellType(grid[i]) === CoverCell.BLOCK) { blockIdx = i; break; }
    }
    expect(blockIdx).toBeGreaterThanOrEqual(0);

    const p = screenOf(session, blockIdx);
    session.pointerDown(p.x, p.y);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'blocked', idx: blockIdx });
    // 拒绝之后不能留下半截路径
    expect(session.state!.path.length).toBe(0);
  });

  it('点在盘外（空白处）→ 一声不吭：那不是"这一格不行"，是"没点到盘上"', () => {
    const entry = LEVELS[0];
    const session = new CoverSession();
    session.load(buildCoverRuntime(decodeCoverLevel(entry)));
    const events = blockedEvents(session);

    session.pointerDown(-400, -400);
    expect(events).toHaveLength(0);
  });
});

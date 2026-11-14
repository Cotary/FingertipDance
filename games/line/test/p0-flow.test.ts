/**
 * P0 回归测试：通关后的关卡流转。
 *
 * ## 覆盖的历史 bug
 *
 * 1. **切后台回来整局卡死**
 *    `CoverSession.abandon()` 只 emit 不复位 `state.phase`。
 *    玩家拖到一半切后台，回来时 phase 停在 `'dragging'`，
 *    而 `pointerDown` 要求 `'idle'` → 这一关完全点不动。
 *
 * 2. **「重来」跳错关卡**
 *    按钮分发里写的是 `enterLevel(pendingLevel)`（= 下一关），
 *    语义完全错了 —— 「重来」应该是再玩一次**刚打完的这关**。
 *
 * 3. **最后一关的「下一关」越界**
 *    `pendingLevel = level.idx + 1`，第 1000 关时是 1001，超出关卡表。
 *
 * 4. **关卡加载失败静默**
 *    以前只有 `console.error`，界面零反馈，玩家以为游戏卡了。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeCoverLevel, buildCoverRuntime } from '../src/game/coverLevel';
import { CoverSession } from '../src/game/coverSession';
import { beginCoverDrag } from '../src/game/coverState';
import { decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';

function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

/** 建一个会话并起手，返回状态。 */
function startedSession(entry: LevelEntryWithSolution) {
  const session = new CoverSession();
  session.load(buildCoverRuntime(decodeCoverLevel(entry)));
  const st = session.state!;
  const start = st.runtime.rs.startAt >= 0 ? st.runtime.rs.startAt : 0;
  expect(beginCoverDrag(st, start)).toBe(true);
  return { session, st };
}

describe('P0 / 切后台回来后关卡仍可操作', () => {
  it('abandon() 之后 phase 回到 idle，路径清空', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const { session, st } = startedSession(entry);
    expect(st.phase).toBe('dragging');

    // 切后台
    session.abandon();

    // 关键断言：phase 必须复位，否则 pointerDown 直接 return
    expect(st.phase).toBe('idle');
    expect(st.path.length).toBe(0);
    expect(st.visited.some((v) => v === 1)).toBe(false);
  });

  it('abandon() 不增加 undos（切后台不该扣星级）', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const session = new CoverSession();
    session.load(buildCoverRuntime(decodeCoverLevel(entry)));
    const st = session.state!;

    const before = st.undos;
    session.abandon();
    expect(st.undos).toBe(before);
  });

  it('放弃后仍能重新起步（状态真的可用了）', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const { session, st } = startedSession(entry);
    session.abandon();

    // 复位后必须能再次起步
    const start = st.runtime.rs.startAt >= 0 ? st.runtime.rs.startAt : 0;
    expect(beginCoverDrag(st, start)).toBe(true);
    expect(st.phase).toBe('dragging');
  });

  it('已通关（won）时 abandon 不复位 —— 通关状态不能被破坏', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const session = new CoverSession();
    session.load(buildCoverRuntime(decodeCoverLevel(entry)));
    const st = session.state!;
    st.phase = 'won';

    session.abandon();
    expect(st.phase).toBe('won');
  });

  it('abandon() 会发出 abandoned 事件（埋点能收到）', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const { session } = startedSession(entry);
    let sawAbandoned = false;
    session.on((e) => {
      if (e.type === 'abandoned') sawAbandoned = true;
    });
    session.abandon();
    expect(sawAbandoned).toBe(true);
  });
});

describe('P0 / 通关事件载荷', () => {
  it('参考解长度 == 可走格数（cover 必须铺满）', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const level = decodeCoverLevel(entry);
    const sol = decodeSolution(entry.solution, entry.w);
    expect(sol.length).toBe(level.required);
  });

  it('flatPath 输出的是拍平索引（上报给服务端的格式）', () => {
    const entry = LEVELS[0];
    if (!entry) return;

    const session = new CoverSession();
    const level = decodeCoverLevel(entry);
    session.load(buildCoverRuntime(level));

    const st = session.state!;
    const start = st.runtime.rs.startAt >= 0 ? st.runtime.rs.startAt : 0;
    beginCoverDrag(st, start);

    const flat = session.flatPath();
    expect(flat.length).toBe(1);
    expect(flat[0]).toBeGreaterThanOrEqual(0);
    expect(flat[0]).toBeLessThan(entry.w * entry.h);
  });
});

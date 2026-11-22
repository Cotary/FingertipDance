import { describe, it, expect } from 'vitest';
import { createRankState, drawRankPage } from '../src/ui/leaderboard';
import type { LeaderboardItem } from '../src/net/api';

/** Canvas 桩：绘图方法全是 no-op（见 lobby-smoke.test.ts 的同名桩）。 */
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** 造一页榜单（名次从 offset+1 开始，和真实服务端一致）。 */
function page(offset: number, count: number): LeaderboardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    rank: offset + i + 1,
    uid: offset + i + 1,
    nickname: `玩家${offset + i + 1}`,
    avatar: '',
    maxLevel: 100 - (offset + i) % 90,
    totalTimeMs: 1000 * (offset + i),
  }));
}

function stateWith(offset: number, total: number, count: number) {
  const st = createRankState();
  st.global = {
    list: page(offset, count),
    myRank: 4213,
    total,
    loading: false,
    offset,
    pageSize: 50,
  };
  return st;
}

describe('排行榜 · 翻页', () => {
  it('页大小与服务端默认一致，首屏是 0 起', () => {
    const st = createRankState();
    expect(st.global.offset).toBe(0);
    expect(st.global.pageSize).toBe(50);
  });

  it('第一页只有「下一页」', () => {
    const ids = drawRankPage(fakeCtx(), stateWith(0, 1284, 50), 0).map((b) => b.id);
    expect(ids).toContain('rankNext');
    expect(ids).not.toContain('rankPrev');
  });

  it('中间页两个方向都有', () => {
    const ids = drawRankPage(fakeCtx(), stateWith(50, 1284, 50), 0).map((b) => b.id);
    expect(ids).toContain('rankPrev');
    expect(ids).toContain('rankNext');
  });

  it('最后一页只有「上一页」', () => {
    // 1284 人、每页 50 → 第 51 条起是最后一页，剩 34 条
    const ids = drawRankPage(fakeCtx(), stateWith(1250, 1284, 34), 0).map((b) => b.id);
    expect(ids).toContain('rankPrev');
    expect(ids).not.toContain('rankNext');
  });

  it('一页装得下时不出分页条', () => {
    const ids = drawRankPage(fakeCtx(), stateWith(0, 12, 12), 0).map((b) => b.id);
    expect(ids).not.toContain('rankPrev');
    expect(ids).not.toContain('rankNext');
  });
});

import { describe, it, expect } from 'vitest';
import { drawBootSplash } from '../src/ui/splash';

/**
 * 启动页。
 *
 * 它存在的唯一理由是「冷启动那几秒屏幕不是死的」，所以测试只关心三件事：
 * 真的画了字、坐标是有限数（NaN 会让文字整行消失，而且不报错）、
 * 三个呼吸点都在。
 */

interface Rec {
  texts: Array<{ text: string; x: number; y: number }>;
  arcs: Array<{ x: number; y: number; r: number }>;
}

function recorder(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { texts: [], arcs: [] };
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (text: string, x: number, y: number) => rec.texts.push({ text, x, y }),
    arc: (x: number, y: number, r: number) => rec.arcs.push({ x, y, r }),
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

describe('启动页', () => {
  it('画出品牌字与状态行', () => {
    const { ctx, rec } = recorder();
    drawBootSplash(ctx, 0);
    const joined = rec.texts.map((t) => t.text).join('');
    expect(joined).toContain('秘');
    expect(joined).toContain('正在准备');
  });

  it('坐标全是有限数（NaN 会让整行字消失且不报错）', () => {
    const { ctx, rec } = recorder();
    drawBootSplash(ctx, 1234);
    for (const t of rec.texts) {
      expect(Number.isFinite(t.x)).toBe(true);
      expect(Number.isFinite(t.y)).toBe(true);
    }
    for (const a of rec.arcs) {
      expect(Number.isFinite(a.x)).toBe(true);
      expect(Number.isFinite(a.y)).toBe(true);
    }
  });

  it('三个呼吸点，相位错开（同相位会有一瞬间全灭，读起来像卡住）', () => {
    const { ctx, rec } = recorder();
    drawBootSplash(ctx, 0);
    expect(rec.arcs).toHaveLength(3);
    // 三个点横排，x 严格递增
    expect(rec.arcs[1].x).toBeGreaterThan(rec.arcs[0].x);
    expect(rec.arcs[2].x).toBeGreaterThan(rec.arcs[1].x);
  });

  it('任意时刻调用都不抛（它会跑在渲染循环里，抛一次就黑屏）', () => {
    const { ctx } = recorder();
    for (const now of [0, 1, 599, 600, 1200, 99999]) {
      expect(() => drawBootSplash(ctx, now)).not.toThrow();
    }
  });
});

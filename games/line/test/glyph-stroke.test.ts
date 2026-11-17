/**
 * 机制图标的**描边回归锁**。
 *
 * ## 锁的是什么
 *
 * `porcelain` 笔触早先只描 `part.stroke === true` 的图元。
 * 几何表里有三类图元（冰面、门、传送门环）只是画线、没写这个标记，
 * 于是它们在这套主题上**整块消失**：
 *
 * - 冰面格 = 一块浅青色的空砖（玩家不知道踩上去会滑）
 * - 门 = 只剩一颗门把的豆子（玩家不知道这里过不去）
 *
 * 这不是崩溃、不是报错，盘面看起来"就是长这样"。所以必须有测试钉住：
 * **几何里有几个图元，笔触就落几笔。**
 */
import { describe, it, expect } from 'vitest';
import { drawGlyph, type GlyphKind, type GlyphPalette } from '../src/render/themes/glyphs';

/** 只记数的最简画布：`drawGlyph` 摸到的每个方法都记一笔。 */
function recorder() {
  const n = { stroke: 0, fill: 0, fillRect: 0, path: 0 };
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: () => { n.path++; },
    moveTo: noop, lineTo: noop, closePath: noop, arc: noop, rect: noop,
    stroke: () => { n.stroke++; },
    fill: () => { n.fill++; },
    fillRect: () => { n.fillRect++; },
    lineJoin: '', lineCap: '', lineWidth: 1, strokeStyle: '', fillStyle: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, n };
}

const PAL: GlyphPalette = { ink: '#000', accent: '#111', chip: '#222', deep: '#333' };

function draw(kind: GlyphKind) {
  const { ctx, n } = recorder();
  drawGlyph(ctx, kind, 'porcelain', 0, 0, 40, PAL);
  return n;
}

describe('机制图标 · 青花笔触', () => {
  /**
   * 每个图标的图元数（写死在这里，改了几何就要同步改 —— 这正是锁的意义）。
   *
   * 星 1 / 箭头 2 / 钥匙 3 / 门 2 / 传送 2 / 石 2 / 冰 3 / 起 2 / 终 2。
   */
  const PARTS: Record<GlyphKind, number> = {
    star: 1, arrow: 2, key: 3, gate: 2, portal: 2, rock: 2, ice: 3, start: 2, end: 2,
  };

  it('几何里有几个图元，就落几笔（少一笔 = 盘面上少一块图形）', () => {
    for (const kind of Object.keys(PARTS) as GlyphKind[]) {
      const n = draw(kind);
      expect(n.stroke, `${kind} 描边数`).toBe(PARTS[kind]);
    }
  });

  it('冰面与门必须是纯线稿：一笔都不填（填了就是一团色块）', () => {
    for (const kind of ['ice', 'gate'] as GlyphKind[]) {
      // gate 有一个实心的门把（fill），其余是线
      const n = draw(kind);
      const maxFill = kind === 'gate' ? 1 : 0;
      expect(n.fill, `${kind} 填充数`).toBeLessThanOrEqual(maxFill);
    }
  });
});

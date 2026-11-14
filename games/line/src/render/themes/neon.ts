/**
 * 赛博霓虹 · 平面轴（第二批典藏）。
 *
 * ## 它换掉了什么
 *
 * 深色主题前两套是「暗处的实体」（玻璃、熔岩），这一套是**没有实体**的：
 * 只有管子发光、只有半调网点，格子是空心框。
 * 抽掉颜色只剩灰度时，它是唯一一套「亮线 + 点阵、没有面」的棋盘。
 *
 * ## 与金线装饰的区别（最容易撞的一套）
 *
 * 金线：斜线、装饰性、线是唯一亮物，但**格子不存在**，靠斜线划分区域。
 * 赛博：正交、切角、格子明确存在（空心框），线是**双色错位**的。
 * 一个是中国工笔的金，一个是夜店的霓虹 —— 灰度下也一样分得开：
 * 金线是均匀细密的斜网格，赛博是稀疏的直角框加网点。
 *
 * ## 一条硬规则
 *
 * **只许发光，不许有质感**。不加斜面、不加木纹、不加雾气 ——
 * 霓虹的美在于「纯色光」，一旦有了材质就变成塑料玩具。
 */
import type { BoardLayout } from '../layout';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { composeTheme, type CellGeom, type Pt } from './kit';

const CYAN = '#00E5FF';
const MAGENTA = '#FF2E9A';

const CHROME: ThemeChrome = {
  pill: '#1A0F2E', pillInk: '#A8F4FF',
  primary: '#B0006E', primaryInk: '#FFF0FA',
  ghost: '#170C28', ghostInk: '#8FE9FF',
  ink: '#E8F6FF', inkSoft: 'rgba(170,210,235,0.74)',
  groove: 'rgba(0,229,255,0.16)', fill: CYAN,
};

/** 切角矩形：赛博的「格子」不是圆角也不是直角，是削掉四角的方块。 */
function chamfer(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number): void {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

/** 网点 tile（懒烘焙，整个进程只建一次）。 */
let dotTile: HTMLCanvasElement | null = null;

function dotPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!dotTile) {
    dotTile = document.createElement('canvas');
    dotTile.width = 12;
    dotTile.height = 12;
    const c = dotTile.getContext('2d');
    if (!c) return null;
    c.fillStyle = 'rgba(88,62,152,0.20)';
    c.beginPath();
    c.arc(6, 6, 1.4, 0, Math.PI * 2);
    c.fill();
  }
  return ctx.createPattern(dotTile, 'repeat');
}

function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#0A0714');
  g.addColorStop(0.55, '#08040F');
  g.addColorStop(1, '#04020A');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 半调网点：预烘焙成 12×12 的 tile，再用 pattern 一次铺满。
  //
  // 第一版是双重循环逐点 arc()：750×1334 / 7px ≈ 两万个圆，**每帧**。
  // 皮肤页一次要画九个陶片，等于每帧十八万个圆 —— headless 直接崩渲染进程，
  // 真机上也会掉到个位数帧率。tile + pattern 是一百倍的开销差。
  //
  // 网点本身要**均匀**：均匀才是印刷，逐点算距离反而变成了「光晕」。
  ctx.fillStyle = dotPattern(ctx) ?? 'rgba(86,60,150,0.09)';
  ctx.fillRect(x, y, w, h);

  // 底部品红余晖：夜店的地面反光。只在下缘，不能爬到盘面上
  const glow = ctx.createRadialGradient(x + w / 2, y + h, 0, x + w / 2, y + h, w * 0.85);
  glow.addColorStop(0, 'rgba(255,46,154,0.16)');
  glow.addColorStop(0.55, 'rgba(120,20,90,0.05)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const pad = Math.max(8, layout.cell * 0.26);
  const x = layout.originX - pad;
  const y = layout.originY - pad;
  const w = layout.boardW + pad * 2;
  const h = layout.boardH + pad * 2;
  const c = Math.max(10, layout.cell * 0.34);

  ctx.fillStyle = 'rgba(18,12,34,0.88)';
  chamfer(ctx, x, y, w, h, c);
  ctx.fill();

  // 双色错位边框：青框在正位，品红框偏移 3px。
  // 只画一圈 = 一个普通描边框；错开 3px 就出现了「色差」——
  // 那是显示器/摄像机失焦的语言，也是赛博最省事的一句台词。
  ctx.save();
  ctx.translate(-3, 3);
  ctx.strokeStyle = 'rgba(255,46,154,0.42)';
  ctx.lineWidth = 1.6;
  chamfer(ctx, x, y, w, h, c);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,229,255,0.55)';
  ctx.lineWidth = 1.8;
  chamfer(ctx, x, y, w, h, c);
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, cx, cy, walk, type } = g;
  const inset = cell * 0.08;
  const box = cell - inset * 2;
  const bx = cx - box / 2;
  const by = cy - box / 2;
  const c = box * 0.24;

  if (walk) {
    // 已走 = 通电的格子。填充是暗品红（不是亮品红：亮品红 + 青边会跳成 RGB 分离）
    ctx.fillStyle = 'rgba(176,0,110,0.26)';
    chamfer(ctx, bx, by, box, box, c);
    ctx.fill();
    // 外辉：同色更宽更淡的一圈，替代 shadowBlur（后者每帧 36 格会掉帧）
    ctx.strokeStyle = 'rgba(0,229,255,0.22)';
    ctx.lineWidth = Math.max(3, cell * 0.10);
    chamfer(ctx, bx, by, box, box, c);
    ctx.stroke();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = Math.max(1.4, cell * 0.038);
    chamfer(ctx, bx, by, box, box, c);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(0,229,255,0.16)';
    ctx.lineWidth = Math.max(1.2, cell * 0.030);
    chamfer(ctx, bx, by, box, box, c);
    ctx.stroke();
  }

  if (type === CoverCell.BLOCK) {
    ctx.fillStyle = 'rgba(6,4,14,0.72)';
    chamfer(ctx, bx, by, box, box, c);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,46,154,0.34)';
    ctx.lineWidth = Math.max(1, cell * 0.024);
    chamfer(ctx, bx, by, box, box, c);
    ctx.stroke();
  }
  if (type === CoverCell.ICE) {
    ctx.fillStyle = 'rgba(0,229,255,0.10)';
    chamfer(ctx, bx, by, box, box, c);
    ctx.fill();
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number): void {
  void now;
  const line = (offset: number, width: number, color: string) => {
    ctx.save();
    ctx.translate(offset, offset);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    // 硬折角：赛博的线是电路走线，不是绸带
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  };
  // 品红层偏右下、青层正位、白芯最细 —— 三层错位就是色差
  line(2.5, Math.max(5, cell * 0.20), 'rgba(255,46,154,0.72)');
  line(0, Math.max(4, cell * 0.15), CYAN);
  line(0, Math.max(1.6, cell * 0.048), '#EAFDFF');
}

export const NEON_THEME = composeTheme({
  id: 'neon',
  name: '赛博霓虹',
  tagline: '格子是空心的，只有电流在亮',
  unlock: { type: 'milestone', value: 600 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(255,46,154,0.5)', core: CYAN, hot: '#EAFDFF' },
    hintColor: '#FFD34D',
    glyph: {
      style: 'neon',
      // 外辉用品红、芯用青白：两色配对（不是同一色的深浅），
      // 同色深浅在暗底上会糊成一根粗线
      pal: { ink: CYAN, accent: 'rgba(255,46,154,0.55)', chip: '#EAFDFF', deep: '#08040F' },
      back: '',
      backEdge: 'transparent',
    },
    hint(ctx, p, cell, i) {
      const inset = cell * 0.09;
      const s = cell - inset * 2;
      ctx.strokeStyle = '#FFD34D';
      ctx.lineWidth = i === 0 ? Math.max(3, cell * 0.075) : Math.max(2, cell * 0.040);
      chamfer(ctx, p.x - s / 2, p.y - s / 2, s, s, s * 0.24);
      ctx.stroke();
    },
    head(ctx, p, cell, now) {
      const r = cell * 0.13;
      const pulse = 0.85 + 0.15 * Math.sin(now / 180);
      ctx.fillStyle = `rgba(0,229,255,${0.28 * pulse})`;
      ctx.fillRect(p.x - r * 2.2, p.y - r * 2.2, r * 4.4, r * 4.4);
      ctx.fillStyle = '#EAFDFF';
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    },
    endpoint(ctx, kind, p, cell) {
      const r = cell * 0.30;
      ctx.lineWidth = Math.max(2, cell * 0.05);
      if (kind === 'start') {
        ctx.strokeStyle = CYAN;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = MAGENTA;
        chamfer(ctx, p.x - r, p.y - r, r * 2, r * 2, r * 0.5);
        ctx.stroke();
      }
    },
  },
});

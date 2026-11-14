/**
 * 像素街机 · 分辨率轴（第二批典藏）。
 *
 * ## 它换掉了什么
 *
 * 这一套换的不是颜色也不是形状，是**分辨率**：所有东西都在一个看不见的
 * 网格上对齐，没有抗锯齿、没有圆角、没有渐变。抽掉颜色只剩灰度时，
 * 它是唯一一套「满屏横纹 + 方块」的棋盘 —— 那层扫描线就是它的签名。
 *
 * ## 为什么线条要取整
 *
 * 8-bit 的像素感不是「像素画」，而是**像素对不齐**。线宽取奇数，
 * 在格心上就会偏半像素，抗锯齿会把它糊成两条灰线 ——
 * 看起来像「没画好」，而不是「复古」。所以线宽一律取 2 的倍数，
 * 转角用 miter、端点用 butt，让每一段都落在整像素上。
 *
 * ## 一条硬规则
 *
 * **不许有渐变**（背景的扫描线和地平线除外）。一个线性渐变就会
 * 把整个画面从 1985 拉回 2025。
 */
import type { BoardLayout } from '../layout';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { composeTheme, type CellGeom, type Pt } from './kit';

const VOID = '#07040F';
const MINT = '#7CF6E0';
const VIOLET = '#5B3FD6';

const CHROME: ThemeChrome = {
  pill: '#241B4E', pillInk: MINT,
  primary: VIOLET, primaryInk: '#F4F0FF',
  ghost: '#1D1542', ghostInk: '#BCACFF',
  ink: '#E9E4FF', inkSoft: 'rgba(190,175,240,0.74)',
  groove: 'rgba(124,246,224,0.16)', fill: MINT,
};

/** 稳定伪随机（和 `ink.ts` 同一个式子，避免引一个共享模块只为一行）。 */
function jit(i: number, k: number): number {
  const n = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;

  ctx.fillStyle = '#120E26';
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 星点：3px 方块，不用圆点 —— 圆点是「星星」，方块是「像素」
  for (let i = 0; i < 70; i++) {
    const px = Math.floor((x + jit(i, 1) * w) / 3) * 3;
    const py = Math.floor((y + jit(i, 2) * h * 0.9) / 3) * 3;
    const a = 0.10 + jit(i, 3) * 0.30;
    ctx.fillStyle = jit(i, 4) > 0.72 ? `rgba(124,246,224,${a})` : `rgba(210,200,255,${a})`;
    ctx.fillRect(px, py, 3, 3);
  }

  // 地平线：CRT 显示器下方那一抹余晖。唯一允许的渐变，且只有 90px 高
  const horizon = ctx.createLinearGradient(0, y + h * 0.72, 0, y + h);
  horizon.addColorStop(0, 'rgba(91,63,214,0)');
  horizon.addColorStop(1, 'rgba(91,63,214,0.22)');
  ctx.fillStyle = horizon;
  ctx.fillRect(x, y + h * 0.72, w, h * 0.28);

  // 扫描线：每 4px 一条 1px 暗线。
  // 这是整套主题的「签名」—— 灰度下别的主题都没有横纹
  // 0.12 而不是 0.17：加强之后盘面上的亮色格子会被横纹切成碎片
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let sy = y; sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1);

  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const pad = Math.max(8, layout.cell * 0.24);
  const x = Math.round(layout.originX - pad);
  const y = Math.round(layout.originY - pad);
  const w = Math.round(layout.boardW + pad * 2);
  const h = Math.round(layout.boardH + pad * 2);

  ctx.fillStyle = VOID;
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#1B1540';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4A3AA0';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  // 四角的「插槽」：街机机台的角钉
  ctx.fillStyle = '#2C2260';
  for (const [cx2, cy2] of [[x, y], [x + w - 6, y], [x, y + h - 6], [x + w - 6, y + h - 6]] as const) {
    ctx.fillRect(cx2, cy2, 6, 6);
  }
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, cx, cy, walk, type } = g;
  const size = Math.round(cell - 4);
  const bx = Math.round(cx - size / 2);
  const by = Math.round(cy - size / 2);

  if (walk) {
    // 暗青绿 + 亮线。
    //
    // 第一版用亮薄荷绿填满，实拍是「整片荧光墙」：路线（也是亮青）压上去
    // 完全看不见，而白芯线在亮绿上只剩一道更亮的白 —— 走的路径读不出来。
    // 8-bit 游戏的做法反过来：地面暗、角色和子弹亮。
    ctx.fillStyle = '#1B6E5C';
    ctx.fillRect(bx, by, size, size);
    // 8-bit 的「亮面」：左上两像素的白。
    // 用渐变做高光立刻就现代了 —— 这里只能是一块硬白
    ctx.fillStyle = 'rgba(160,255,235,0.30)';
    ctx.fillRect(bx, by, size, 2);
    ctx.fillRect(bx, by, 2, size);
    ctx.fillStyle = 'rgba(4,32,26,0.45)';
    ctx.fillRect(bx, by + size - 2, size, 2);
    ctx.fillRect(bx + size - 2, by, 2, size);
  } else {
    // 双色棋盘：不填色的话整盘读作「一片空地」，看不出这是格子
    ctx.fillStyle = (g.gx + g.gy) % 2 === 0 ? '#241B4E' : '#2A2059';
    ctx.fillRect(bx, by, size, size);
    ctx.fillStyle = 'rgba(124,246,224,0.10)';
    ctx.fillRect(bx, by, size, 2);
  }

  if (type === CoverCell.BLOCK) {
    ctx.fillStyle = '#0B0820';
    ctx.fillRect(bx, by, size, size);
    ctx.fillStyle = '#3A2C7A';
    for (let k = 1; k < 3; k++) ctx.fillRect(bx + 2, by + (size / 3) * k, size - 4, 2);
  }
  if (type === CoverCell.ICE) {
    ctx.fillStyle = 'rgba(124,246,224,0.22)';
    ctx.fillRect(bx, by, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(bx + 3, by + 3, 3, 3);
    ctx.fillRect(bx + size - 7, by + size - 7, 3, 3);
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number): void {
  const line = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round((cell * width) / 2) * 2);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  line(0.32, VOID);
  line(0.16, MINT);
  line(0.04, '#EFFFFB');
}

export const PIXEL_THEME = composeTheme({
  id: 'pixel',
  name: '像素街机',
  tagline: '扫描线、方块、一颗不抗锯齿的心',
  unlock: { type: 'milestone', value: 350 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: VOID, core: MINT, hot: '#EFFFFB' },
    hintColor: '#FFD34D',
    glyph: {
      style: 'pixel',
      pal: { ink: '#B9FFF2', accent: '#1B6E5C', chip: '#EFFFFB', deep: VOID },
      back: '',
      backEdge: 'transparent',
    },
    // 全屏扫描线：盖在盘面上才成立。
    // 画在背景层的话，底板和格子会把中间那一大块挡掉，只剩四周一圈横纹
    overlay(ctx, layout) {
      const x = layout.originX - 20;
      const y = layout.originY - 20;
      const w = layout.boardW + 40;
      const h = layout.boardH + 40;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      for (let sy = Math.floor(y / 4) * 4; sy < y + h; sy += 4) ctx.fillRect(x, sy, w, 1);
      ctx.restore();
    },
    hint(ctx, p, cell, i) {
      const size = Math.round(cell - 8);
      ctx.strokeStyle = '#FFD34D';
      ctx.lineWidth = i === 0 ? 4 : 2;
      ctx.strokeRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    },
    head(ctx, p, cell, now) {
      const s = Math.max(4, Math.round(cell * 0.24));
      // 闪烁用「整格跳变」而不是渐变：像素时代没有 alpha 动画，只有开和关
      const on = Math.floor(now / 220) % 2 === 0;
      ctx.fillStyle = on ? '#FFFFFF' : MINT;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.fillStyle = MINT;
      ctx.fillRect(p.x - s / 2 - 2, p.y - s / 2 - 2, 2, s + 4);
      ctx.fillRect(p.x + s / 2, p.y - s / 2 - 2, 2, s + 4);
    },
    endpoint(ctx, kind, p, cell) {
      const s = Math.round(cell * 0.30);
      ctx.strokeStyle = '#FFD34D';
      ctx.lineWidth = 3;
      ctx.strokeRect(Math.round(p.x - s), Math.round(p.y - s), s * 2, s * 2);
      if (kind === 'end') {
        ctx.fillStyle = '#FFD34D';
        ctx.fillRect(Math.round(p.x - s), Math.round(p.y - s), 4, 4);
        ctx.fillRect(Math.round(p.x + s - 4), Math.round(p.y + s - 4), 4, 4);
      }
    },
  },
});

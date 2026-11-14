/**
 * 深海荧光 · 形态轴（第二批典藏）。
 *
 * ## 它换掉了什么
 *
 * 前七套里，「形状」都是被规定的：方格、圆、切角方块。
 * 深海换的是**形状本身** —— 格子变成一枚枚软的卵形，边是呼吸的，
 * 背景里有缓慢漂移的浮游物。抽掉颜色只剩灰度时，
 * 它是唯一一套**没有任何直边**的棋盘（圆格罗盘有直边吗？没有，但它是
 * 细线圆环 + 缎带，深海是实心软体）。
 *
 * ## 为什么和圆格罗盘不撞
 *
 * 罗盘是「珠子穿在绳上」：格子是**空心细环**，线是宽的缎带，结构感来自圆周。
 * 深海是「一池发光的生物」：格子是**实心软体**，线是流动的细带，结构感来自呼吸。
 * 一个在讲几何，一个在讲生命 —— 灰度下前者是「环 + 带」，后者是「斑 + 脉」。
 *
 * ## 一条硬规则
 *
 * **不许有硬边**。任何一条锐利的线都会立刻把画面从水下拽回桌面。
 * 所以所有线都是圆头、所有角都是大圆角、所有高光都是径向渐变。
 */
import { roundRect } from '../board';
import type { BoardLayout } from '../layout';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { composeTheme, type CellGeom, type Pt } from './kit';

const GLOW = '#4FE8D8';

const CHROME: ThemeChrome = {
  pill: '#062A33', pillInk: '#A8F6EE',
  primary: '#0E7C7B', primaryInk: '#EAFFFC',
  ghost: '#0A3A45', ghostInk: '#8FE8DE',
  ink: '#D8FBF6', inkSoft: 'rgba(150,220,215,0.72)',
  groove: 'rgba(63,224,208,0.16)', fill: '#3FE0D0',
};

function jit(i: number, k: number): number {
  const n = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;

  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#06202E');
  g.addColorStop(0.45, '#031420');
  g.addColorStop(1, '#010A12');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 焦散：三个大而极淡的光斑，位置随时间缓慢游动。
  //
  // 焦散是「水下的光」唯一可信的证据 —— 不是水波线，是光被水面折射后
  // 投在池底的一团亮。所以它必须是**大尺度、极低对比**的，
  // 画成小亮点就变成萤火虫了。
  const t = Date.now() / 1000;
  const caustics: Array<[number, number, number]> = [
    [w * 0.32 + Math.sin(t * 0.21) * w * 0.06, h * 0.30 + Math.cos(t * 0.17) * h * 0.03, w * 0.52],
    [w * 0.72 + Math.cos(t * 0.15) * w * 0.05, h * 0.55 + Math.sin(t * 0.23) * h * 0.04, w * 0.44],
    [w * 0.48 + Math.sin(t * 0.11 + 2) * w * 0.08, h * 0.82, w * 0.60],
  ];
  for (const [cx, cy, r] of caustics) {
    const cg = ctx.createRadialGradient(x + cx, y + cy, 0, x + cx, y + cy, r);
    cg.addColorStop(0, 'rgba(120,240,225,0.075)');
    cg.addColorStop(0.5, 'rgba(60,180,190,0.035)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    // 只填这个光斑自己的圆，不整屏填：径向渐变 alpha 到边缘已经是 0，
    // 而整屏填一次 = 每帧 100 万像素 × 3，皮肤页九个陶片直接超时
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x + cx, y + cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 浮游微粒：缓慢上升，到顶后回到下方。
  // 用「位置对高度取模」而不是维护数组 —— 无状态、不开销、永远均匀
  for (let i = 0; i < 46; i++) {
    const bx = x + jit(i, 1) * w;
    const baseY = jit(i, 2) * h;
    const speed = 6 + jit(i, 3) * 16;
    const py = y + ((baseY - t * speed) % h + h) % h;
    const a = 0.14 + jit(i, 4) * 0.34;
    const r = 0.8 + jit(i, 5) * 1.3;
    ctx.fillStyle = `rgba(170,252,246,${a})`;
    ctx.beginPath();
    ctx.arc(bx, py, r, 0, Math.PI * 2);
    ctx.fill();
    // 一半的微粒带一圈更淡的光晕，读作「活的」而不是「灰尘」
    if (i % 3 === 0) {
      ctx.fillStyle = `rgba(120,240,225,${a * 0.28})`;
      ctx.beginPath();
      ctx.arc(bx, py, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 顶部压暗：光从上方来，上方反而不该是最亮的平面
  const top = ctx.createLinearGradient(0, y, 0, y + h * 0.28);
  top.addColorStop(0, 'rgba(1,6,12,0.55)');
  top.addColorStop(1, 'rgba(1,6,12,0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h * 0.28);

  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const pad = Math.max(8, layout.cell * 0.28);
  const x = layout.originX - pad;
  const y = layout.originY - pad;
  const w = layout.boardW + pad * 2;
  const h = layout.boardH + pad * 2;
  const r = Math.max(16, layout.cell * 0.50);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.max(14, layout.cell * 0.45);
  ctx.shadowOffsetY = Math.max(5, layout.cell * 0.12);
  ctx.fillStyle = 'rgba(6,28,40,0.76)';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  // 内发光边：一条细青线 + 一圈更大的淡青（代替描边，保持「软」）
  ctx.strokeStyle = 'rgba(90,230,220,0.16)';
  ctx.lineWidth = Math.max(3, layout.cell * 0.09);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,230,220,0.30)';
  ctx.lineWidth = Math.max(1.2, layout.cell * 0.026);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, cx, cy, walk, idx, type, now } = g;
  // 横向卵形，不是正圆。
  //
  // 第一版是 0.84×0.90（几乎正方），实拍和「圆格罗盘」的圆环撞得厉害 ——
  // 缩略图上两套都是「一池青色圆点」。压扁到 0.92×0.68 之后读作「卵石 / 水母伞盖」，
  // 而罗盘是细线圆环 + 缎带，两者在灰度下也分得开。
  const wBox = cell * 0.92;
  const hBox = cell * 0.68;
  const bx = cx - wBox / 2;
  const by = cy - hBox / 2;
  const r = hBox * 0.5;

  if (walk) {
    // 呼吸：每格的相位由 idx 决定，所以整盘是「一群」在呼吸，不是一个在闪
    const breath = 0.86 + 0.14 * Math.sin(now / 620 + idx * 0.7);
    ctx.globalAlpha = breath;

    // 外晕（水母的光）
    const gd = ctx.createRadialGradient(cx, cy, 0, cx, cy, wBox * 0.72);
    gd.addColorStop(0, 'rgba(79,232,216,0.18)');
    gd.addColorStop(1, 'rgba(79,232,216,0)');
    ctx.fillStyle = gd;
    ctx.beginPath();
    ctx.arc(cx, cy, wBox * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(46,190,180,0.44)';
    roundRect(ctx, bx, by, wBox, hBox, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,255,246,0.78)';
    ctx.lineWidth = Math.max(1.4, cell * 0.034);
    ctx.stroke();

    // 体内的亮点：偏上，像水母的伞盖
    ctx.fillStyle = 'rgba(220,255,250,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy - hBox * 0.20, wBox * 0.13, hBox * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = 'rgba(40,120,140,0.10)';
    roundRect(ctx, bx, by, wBox, hBox, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,210,205,0.20)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.stroke();
  }

  if (type === CoverCell.BLOCK) {
    // 礁石：一团更暗更实的软体
    ctx.fillStyle = 'rgba(4,20,28,0.82)';
    roundRect(ctx, bx + cell * 0.02, by + cell * 0.02, wBox - cell * 0.04, hBox - cell * 0.04, r * 0.9);
    ctx.fill();
  }
  if (type === CoverCell.ICE) {
    ctx.fillStyle = 'rgba(160,240,255,0.16)';
    roundRect(ctx, bx, by, wBox, hBox, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,246,255,0.45)';
    ctx.lineWidth = Math.max(1, cell * 0.024);
    ctx.stroke();
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number): void {
  const line = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  // 一条「水流」：外圈很宽很淡（水被带动），芯很细很亮（生物的光）
  line(Math.max(12, cell * 0.40), 'rgba(60,230,220,0.13)');
  line(Math.max(6, cell * 0.20), 'rgba(79,232,216,0.72)');
  line(Math.max(1.8, cell * 0.055), '#DCFFFA');
}

export const ABYSS_THEME = composeTheme({
  id: 'abyss',
  name: '深海荧光',
  tagline: '一池会呼吸的光，没有一条直边',
  unlock: { type: 'milestone', value: 1000 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(60,230,220,0.2)', core: GLOW, hot: '#DCFFFA' },
    hintColor: '#FFE9A8',
    glyph: {
      style: 'jelly',
      // 肉色 + 亮膜 + 高光点：三个色阶都在同一族里，才不会像贴纸
      pal: { ink: '#9FF6EE', accent: 'rgba(70,225,210,0.34)', chip: '#D8FFFA', deep: '#02141E' },
      back: 'rgba(2,20,30,0.55)',
      backEdge: 'rgba(120,240,225,0.22)',
      backR: 0.42,
    },
    hint(ctx, p, cell, i, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = i === 0 ? Math.max(3, cell * 0.07) : Math.max(2, cell * 0.036);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    },
    head(ctx, p, cell, now) {
      const r = cell * 0.16;
      const pulse = 1 + 0.12 * Math.sin(now / 300);
      const gd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
      gd.addColorStop(0, 'rgba(216,255,250,0.85)');
      gd.addColorStop(0.35, 'rgba(79,232,216,0.45)');
      gd.addColorStop(1, 'rgba(79,232,216,0)');
      ctx.fillStyle = gd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F2FFFD';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    },
    endpoint(ctx, kind, p, cell) {
      const r = cell * 0.31;
      ctx.strokeStyle = 'rgba(200,255,250,0.85)';
      ctx.lineWidth = Math.max(2, cell * 0.042);
      if (kind === 'start') {
        // 双环：起点的「水泡」
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // 终点：菱形（唯一一个允许的尖角，且仍然圆头）
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r * 0.8, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r * 0.8, p.y);
        ctx.closePath();
        ctx.stroke();
      }
    },
  },
});

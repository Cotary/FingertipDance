import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { CANDY, THEME, type CandyKey, type Theme } from './theme';
import { candyStar, glass, jelly, pill, starRow, strokeText, halo, font } from './draw';

/** 游戏内配色。保留此名以兼容既有引用（现与大厅同一套糖果夜空色板）。 */
export const COLORS = THEME;

/** 矩形按钮。 */
export interface Button {
  x: number; y: number; w: number; h: number;
  label: string;
  kind: 'primary' | 'secondary' | 'ghost';
  id: string;
  /** 糖果色（不传则按 kind 推导） */
  tone?: CandyKey;
}

/**
 * 按「步数 / 理论最短步数」算星级。
 * 阈值必须与后端 server/internal/games/line/stars.go 的 StarOf 一致。
 */
export function starOf(steps: number, shortest: number): number {
  if (shortest <= 0) return 1;
  const ratio = steps / shortest;
  if (ratio <= 1.15) return 3;
  if (ratio <= 1.5) return 2;
  return 1;
}

/** kind → 默认糖果色。 */
function toneOf(b: Button): CandyColor {
  if (b.tone) return CANDY[b.tone];
  if (b.kind === 'primary') return CANDY.green;
  if (b.kind === 'secondary') return CANDY.blue;
  return CANDY.purple;
}

/** 便捷取色，避免每处写 CANDY.xxx。 */
type CandyColor = (typeof CANDY)[CandyKey];

/**
 * 画一个按钮（果冻质感）。
 * @param theme 主题，默认糖果夜空（既有调用点无需改）
 */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  b: Button,
  pressed: boolean,
  theme: Theme = COLORS,
): void {
  if (b.kind === 'ghost') {
    // 幽灵按钮：半透明玻璃 + 白字，不抢主次
    glass(ctx, b.x, b.y, b.w, b.h, Math.min(b.h / 2, 26), {
      fill: pressed ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.10)',
      shadow: false,
    });
    strokeText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, Math.min(b.h * 0.40, 30), {
      fill: theme.text,
      stroke: 'rgba(10,6,35,0.55)',
      strokeWidth: 3,
    });
    return;
  }

  jelly(ctx, b.x, b.y, b.w, b.h, toneOf(b), {
    pressed,
    radius: Math.min(b.h / 2, 34),
    label: b.label,
    fontSize: Math.min(b.h * 0.40, 34),
  });
}

/**
 * 判断点是否落在按钮内。
 */
export function hitButton(b: Button, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** 画 HUD 顶部：居中关号胶囊 + 左右皮肤信息。 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  levelIdx: number,
  skinName: string,
  skinCount: number,
  totalSkins: number,
): void {
  // 关号胶囊
  const pw = 250, ph = 68, px = (DESIGN_W - pw) / 2, py = 88;
  glass(ctx, px, py, pw, ph, ph / 2, { fill: 'rgba(30,22,80,0.72)' });
  strokeText(ctx, `第 ${levelIdx} 关`, DESIGN_W / 2, py + ph / 2 + 1, 34, {
    stroke: 'rgba(8,4,30,0.6)',
    strokeWidth: 5,
  });

  // 皮肤信息：左右各一行小字
  strokeText(ctx, `皮肤 ${skinCount}/${totalSkins}`, 40, 182, 22, {
    weight: 600,
    fill: THEME.subText,
    align: 'left',
  });
  strokeText(ctx, skinName, DESIGN_W - 40, 182, 22, {
    weight: 600,
    fill: THEME.subText,
    align: 'right',
  });
}

/** 画关卡进度条（糖果胶囊）。 */
export function drawProgressBar(ctx: CanvasRenderingContext2D, current: number, total: number): void {
  const x = 40, y = 1042, w = DESIGN_W - 80, h = 18;

  // 轨道：必须比底色「亮」才看得见。原先 rgba(10,6,35,0.55) 在深色底上等于隐形。
  glass(ctx, x, y, w, h, h / 2, { fill: 'rgba(255,255,255,0.13)', shadow: false, inner: false });

  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const fillW = Math.max(0, w * ratio);
  if (fillW > 8) {
    const g = ctx.createLinearGradient(x, 0, x + fillW, 0);
    g.addColorStop(0, CANDY.pink.base);
    g.addColorStop(0.5, CANDY.purple.base);
    g.addColorStop(1, CANDY.blue.base);
    ctx.fillStyle = g;
    roundRect(ctx, x, y, fillW, h, h / 2);
    ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, x + 4, y + 4, Math.max(0, fillW - 8), h * 0.32, h * 0.16);
    ctx.fill();
    // 进度头：早期关卡填充只有几像素，加一颗亮珠才读得出「这里有进度」
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x + fillW - h / 2, y + h / 2, h * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  strokeText(ctx, `${current} / ${total} 关`, x, y + 44, 22, {
    weight: 600,
    fill: THEME.subText,
    align: 'left',
    baseline: 'top',
  });
}

/** 画通关结算页。 */
export function drawResult(
  ctx: CanvasRenderingContext2D,
  levelIdx: number,
  steps: number,
  shortest: number,
  timeMs: number,
  unlockedSkin: { id: string; name: string } | null,
  progressRatio: number,
): Button[] {
  // 遮罩
  ctx.fillStyle = 'rgba(6,3,24,0.78)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 面板：深紫渐变 + 金色发光边
  // 高度 732 是按「8 行内容 + 上下各留 18~26 的呼吸」倒推出来的，py 居中于 1334
  const pw = DESIGN_W - 100, ph = 732, px = 50;
  const py = Math.round((DESIGN_H - ph) / 2);
  const cx = px + pw / 2;

  ctx.fillStyle = 'rgba(255,213,79,0.18)';
  roundRect(ctx, px - 6, py - 6, pw + 12, ph + 12, 50);
  ctx.fill();

  const pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, '#3A2E92');
  pg.addColorStop(0.55, '#2A2178');
  pg.addColorStop(1, '#1C1658');
  ctx.fillStyle = pg;
  roundRect(ctx, px, py, pw, ph, 44);
  ctx.fill();

  // 顶部内高光
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 44);
  ctx.clip();
  const hg = ctx.createLinearGradient(0, py, 0, py + 200);
  hg.addColorStop(0, 'rgba(255,255,255,0.22)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(px, py, pw, 200);
  ctx.restore();

  // 金边
  ctx.strokeStyle = 'rgba(255,213,79,0.75)';
  ctx.lineWidth = 3;
  roundRect(ctx, px + 1.5, py + 1.5, pw - 3, ph - 3, 43);
  ctx.stroke();

  // 标题
  strokeText(ctx, `第 ${levelIdx} 关 通关！`, cx, py + 58, 48, {
    stroke: '#160F45',
    strokeWidth: 5,
  });

  // 三星
  const stars = starOf(steps, shortest);
  starRow(ctx, cx, py + 148, 34, stars);

  // 关卡进度：文字 → 细胶囊条 → 数据胶囊，三段各留 14/24 的间距。
  // 早期关卡填充只有几像素，靠进度头那颗白珠才读得出「有进度」。
  const pr = Math.min(1, Math.max(0, progressRatio));
  strokeText(ctx, `关卡进度 ${(pr * 100).toFixed(1)}%`, cx, py + 212, 20, {
    weight: 600,
    fill: THEME.subText,
  });
  const barW = 420, barX = cx - barW / 2, barY = py + 238, barH = 14;
  glass(ctx, barX, barY, barW, barH, barH / 2, { fill: 'rgba(255,255,255,0.13)', shadow: false, inner: false });
  if (pr > 0.002) {
    const fillW = Math.max(barH, barW * pr);
    const bg = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    bg.addColorStop(0, CANDY.pink.base);
    bg.addColorStop(1, CANDY.blue.base);
    ctx.fillStyle = bg;
    roundRect(ctx, barX, barY, fillW, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(barX + fillW - barH / 2, barY + barH / 2, barH * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }

  // 数据胶囊（两个并排）
  const sW = 278, sH = 80, sY = py + 272;
  const stats: Array<[string, string]> = [
    ['步数', `${steps} / 最短 ${shortest}`],
    ['用时', `${(timeMs / 1000).toFixed(1)}s`],
  ];
  stats.forEach(([k, v], i) => {
    const sx = px + 30 + i * (sW + 14);
    glass(ctx, sx, sY, sW, sH, 22, { fill: 'rgba(255,255,255,0.10)' });
    strokeText(ctx, k, sx + sW / 2, sY + 26, 20, { weight: 600, fill: THEME.subText });
    strokeText(ctx, v, sx + sW / 2, sY + 56, 26);
  });

  // 解锁皮肤
  if (unlockedSkin) {
    const bw = 420, bh = 56, bx = cx - bw / 2, by = py + 380;
    pill(ctx, bx, by, bw, bh, CANDY.purple, `解锁新皮肤 · ${unlockedSkin.name}`, 24);
  }

  // 按钮组
  const nextBtn: Button = { x: 120, y: py + 456, w: DESIGN_W - 240, h: 88, label: '下一关', kind: 'primary', id: 'next', tone: 'green' };
  const shareBtn: Button = { x: 120, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '分享', kind: 'secondary', id: 'share', tone: 'blue' };
  const skinBtn: Button = { x: 140 + (DESIGN_W - 260) / 2, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '皮肤', kind: 'secondary', id: 'skins', tone: 'purple' };
  const homeBtn: Button = { x: 120, y: py + 642, w: DESIGN_W - 240, h: 64, label: '返回大厅', kind: 'ghost', id: 'home' };

  drawButton(ctx, nextBtn, false);
  drawButton(ctx, shareBtn, false);
  drawButton(ctx, skinBtn, false);
  drawButton(ctx, homeBtn, false);

  return [nextBtn, shareBtn, skinBtn, homeBtn];
}

/** 画一个「三星」小图标行（地图节点、列表用，尺寸小）。 */
export function miniStars(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, stars: number): void {
  for (let i = 0; i < 3; i++) {
    candyStar(ctx, cx + (i - 1) * r * 2.4, cy, r, i < stars);
  }
}

/** 圆形头像（程序化渐变 + 首字），带糖果描边。 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  _url: string,
  name: string,
): void {
  halo(ctx, cx, cy, r * 1.5, 'rgba(179,136,255,0.35)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, CANDY.blue.base);
  g.addColorStop(1, CANDY.purple.base);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.5, r * 0.55, r * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = font(r * 0.95, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText((name || '玩').slice(0, 1), cx, cy + 1);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

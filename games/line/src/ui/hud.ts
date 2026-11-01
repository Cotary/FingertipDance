import { DESIGN_W, DESIGN_H } from '../render/layout';
import { THEME, type Theme } from './theme';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayInset, clayStar, clayText, rrectPts, tracePts, type ClayColor } from './clay';

/** 游戏内配色。保留此名以兼容既有引用（黏土版内部不读颜色，只用黏土 token）。 */
export const COLORS = THEME;

/** 矩形按钮。 */
export interface Button {
  x: number; y: number; w: number; h: number;
  label: string;
  kind: 'primary' | 'secondary' | 'ghost';
  id: string;
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
  void theme;

  // 黏土块：体积靠色阶 + 软投影，不靠渐变；按下时整块下沉
  // ghost 不能用奶油：它要压在奶油面板上，同色等于看不见。用深一档的沙色
  const c: ClayColor = b.kind === 'primary' ? CLAY.terracotta : b.kind === 'secondary' ? CLAY.mustard : CLAY.sand;
  const seed = b.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const sink = pressed ? 3 : 0;
  clayBlock(ctx, b.x, b.y + sink, b.w, b.h, Math.min(b.h * 0.42, 30), c, seed, {
    depth: pressed ? 3 : b.kind === 'primary' ? 11 : 8,
    hi: b.kind === 'ghost' ? 0.05 : 0.065,
  });

  const fs = Math.min(b.h * 0.40, 34);
  clayText(ctx, b.label, b.x + b.w / 2, b.y + sink + b.h / 2, fs, {
    fill: b.kind === 'ghost' ? CLAY_UI.ink : '#FFF6E9',
    outline: b.kind === 'ghost' ? undefined : 'rgba(90,38,16,0.5)',
    outlineWidth: b.kind === 'ghost' ? 0 : Math.max(2, fs * 0.16),
    emboss: false,
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
  // 关号：一块陶土胶囊，压在棋盘上方
  const pw = 250, ph = 68, px = (DESIGN_W - pw) / 2, py = 88;
  clayBlock(ctx, px, py, pw, ph, ph * 0.5, CLAY.terracotta, 71, { depth: 9, hi: 0.08 });
  clayText(ctx, `第 ${levelIdx} 关`, DESIGN_W / 2, py + ph / 2, 34, {
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.5)',
    outlineWidth: 5,
  });

  // 皮肤信息：左右各一行小字（浅底上用深棕，别再用浅紫）
  clayText(ctx, `皮肤 ${skinCount}/${totalSkins}`, 40, 182, 22, {
    align: 'left',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, skinName, DESIGN_W - 40, 182, 22, {
    align: 'right',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
}

/** 画关卡进度条（糖果胶囊）。 */
export function drawProgressBar(ctx: CanvasRenderingContext2D, current: number, total: number): void {
  const x = 40, y = 1196, w = DESIGN_W - 80, h = 20;

  // 槽：压进桌面的一道沟。浅底上必须「深两档」才读得出是槽，
  // 而且要走 inset（上沿暗、下沿亮），平涂的深色条会读成一根棕色的棒子。
  clayInset(ctx, x, y, w, h, h / 2, CLAY.groove, 511, { lit: false, jitter: 0.003 });

  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const fillW = Math.max(0, w * ratio);
  if (fillW > 6) {
    const fw = Math.max(h, fillW);
    ctx.fillStyle = CLAY.terracotta.dark;
    tracePts(ctx, rrectPts(x, y, fw, h, h / 2, 512, 0.003));
    ctx.fill();
    ctx.fillStyle = CLAY.terracotta.base;
    tracePts(ctx, rrectPts(x, y - 2, fw, h, h / 2, 512, 0.003));
    ctx.fill();
    clayDisc(ctx, x + fw - h / 2, y + h / 2, h * 0.46, CLAY.mustard, 513, { depth: 3 });
  }

  clayText(ctx, `${current} / ${total} 关`, x, y + 34, 22, {
    align: 'left',
    baseline: 'top',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
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
  // 遮罩：陶土棕的暗，不是夜空的紫黑
  ctx.fillStyle = 'rgba(58,38,24,0.62)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 面板：一块奶油黏土板。高度 732 是按「8 行内容 + 上下各留 18~26 的呼吸」倒推的
  const pw = DESIGN_W - 100, ph = 748, px = 50;
  const py = Math.round((DESIGN_H - ph) / 2);
  const cx = px + pw / 2;

  clayBlock(ctx, px, py, pw, ph, 44, CLAY.cream, 801, { depth: 22, hi: 0.035, jitter: 0.002 });

  // 标题带：压在面板顶部的一条陶土
  clayBlock(ctx, px + 22, py + 20, pw - 44, 82, 30, CLAY.terracotta, 802, { depth: 7, hi: 0.06 });
  clayText(ctx, `第 ${levelIdx} 关 通关！`, cx, py + 61, 46, {
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.45)',
    outlineWidth: 5,
  });

  // 三星（金色黏土星，在奶油底上最跳）
  const stars = starOf(steps, shortest);
  for (let i = 0; i < 3; i++) {
    const on = i < stars;
    clayStar(ctx, cx + (i - 1) * 78, py + 152, i === 1 ? 39 : 34, on ? CLAY.mustard : CLAY.sand, 861 + i, {
      depth: on ? 7 : 3,
      lit: on,
    });
  }

  // 关卡进度：文字 → 细胶囊条 → 数据胶囊
  const pr = Math.min(1, Math.max(0, progressRatio));
  clayText(ctx, `关卡进度 ${(pr * 100).toFixed(1)}%`, cx, py + 212, 21, {
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  const barW = 420, barX = cx - barW / 2, barY = py + 236, barH = 16;
  ctx.fillStyle = CLAY.sand.shade;
  tracePts(ctx, rrectPts(barX, barY, barW, barH, barH / 2, 803, 0.003));
  ctx.fill();
  if (pr > 0.002) {
    const fw = Math.max(barH, barW * pr);
    ctx.fillStyle = CLAY.terracotta.dark;
    tracePts(ctx, rrectPts(barX, barY, fw, barH, barH / 2, 804, 0.003));
    ctx.fill();
    ctx.fillStyle = CLAY.terracotta.base;
    tracePts(ctx, rrectPts(barX, barY - 2, fw, barH, barH / 2, 804, 0.003));
    ctx.fill();
    clayDisc(ctx, barX + fw - barH / 2, barY + barH / 2, barH * 0.44, CLAY.mustard, 805, { depth: 3 });
  }

  // 两块沙色数据块：在奶油面板上「压进去」而不是浮出来。
  // 凸起的沙块会读成又一张卡片，凹坑才读成「面板上挖出的读数窗」。
  const sW = 288, sH = 80, sY = py + 268;
  const stats: Array<[string, string]> = [
    ['步数', `${steps} / 最短 ${shortest}`],
    ['用时', `${(timeMs / 1000).toFixed(1)}s`],
  ];
  stats.forEach(([k, v], i) => {
    const sx = px + 30 + i * (sW + 14);
    clayInset(ctx, sx, sY, sW, sH, 22, CLAY.sand, 810 + i, { jitter: 0.004 });
    clayText(ctx, k, sx + sW / 2, sY + 26, 20, {
      fill: 'rgba(74,51,39,0.62)',
      outlineWidth: 0,
      emboss: false,
    });
    clayText(ctx, v, sx + sW / 2, sY + 56, 27, {
      fill: CLAY_UI.ink,
      outlineWidth: 0,
      emboss: false,
    });
  });

  // 解锁皮肤
  if (unlockedSkin) {
    const bw = 420, bh = 58, bx = cx - bw / 2, by = py + 372;
    clayBlock(ctx, bx, by, bw, bh, 28, CLAY.mustard, 820, { depth: 6, hi: 0.07 });
    clayText(ctx, `解锁新皮肤 · ${unlockedSkin.name}`, cx, by + bh / 2, 25, {
      fill: '#5C4208',
      outlineWidth: 0,
      emboss: false,
    });
  }

  // 按钮组
  const nextBtn: Button = { x: 120, y: py + 456, w: DESIGN_W - 240, h: 88, label: '下一关', kind: 'primary', id: 'next' };
  const shareBtn: Button = { x: 120, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '分享', kind: 'secondary', id: 'share' };
  const skinBtn: Button = { x: 140 + (DESIGN_W - 260) / 2, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '皮肤', kind: 'secondary', id: 'skins' };
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
    const on = i < stars;
    clayStar(ctx, cx + (i - 1) * r * 2.4, cy, r, on ? CLAY.mustard : CLAY.sand, 871 + i, { depth: 2, lit: on });
  }
}

/** 圆形头像：一枚蓝黏土圆片 + 压印首字。 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  _url: string,
  name: string,
): void {
  clayDisc(ctx, cx, cy, r, CLAY.blue, 661, { depth: 6, hi: 0.14 });

  const initial = (name || '玩').trim().slice(0, 1) || '玩';
  clayText(ctx, initial, cx, cy, Math.floor(r * 0.92), {
    fill: '#FFF6E9',
    outline: 'rgba(28,42,56,0.50)',
    outlineWidth: Math.max(2, r * 0.09),
  });
}

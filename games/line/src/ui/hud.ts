import { DESIGN_W, DESIGN_H } from '../render/layout';
import { THEME, type Theme } from './theme';
import { CLAY, CLAY_FONT, CLAY_UI, clayBlock, clayDisc, clayInset, clayStar, clayText, rrectPts, tracePts, type ClayColor } from './clay';
import { clayFrom, type ThemeChrome } from '../render/themes/types';

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
 * cover 模式的星级：**按重来次数**（`undos`）。
 *
 * cover 模式下步数恒等于 `required − 1`，所以「步数比最短路多多少」
 * 这种经典算法没有意义 —— 步数根本不会变。
 * 唯一能体现「玩得好不好」的维度是**重来次数**：
 *
 *   - 0 次重来 → 3 星（一气呵成）
 *   - 1~2 次  → 2 星
 *   - 3 次以上 → 1 星
 *
 * 阈值必须与后端 `stars.go` 的 `StarOfCover` 一致。
 */
export function starOfCover(undos: number): number {
  if (undos <= 0) return 3;
  if (undos <= 2) return 2;
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
  chrome?: ThemeChrome,
): void {
  void theme;

  // 黏土块：体积靠色阶 + 软投影，不靠渐变；按下时整块下沉
  // ghost 不能用奶油：它要压在奶油面板上，同色等于看不见。用深一档的沙色
  //
  // 有主题配色时整块换成主题色：深色盘面上的奶油按钮像贴错了图，
  // 而且「提示」是这一屏唯一的行动点，必须和盘面同族才不显得是外来控件。
  const c: ClayColor = chrome
    ? clayFrom(b.kind === 'primary' ? chrome.primary : b.kind === 'secondary' ? chrome.primary : chrome.ghost)
    : b.kind === 'primary' ? CLAY.terracotta : b.kind === 'secondary' ? CLAY.mustard : CLAY.sand;
  const seed = b.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const sink = pressed ? 3 : 0;
  clayBlock(ctx, b.x, b.y + sink, b.w, b.h, Math.min(b.h * 0.42, 30), c, seed, {
    depth: pressed ? 3 : b.kind === 'primary' ? 11 : 8,
    hi: b.kind === 'ghost' ? 0.05 : 0.065,
    // 深色主题要收反光，否则整块被白光推成脏灰
    gloss: chrome ? 0.28 : 1,
  });

  const fs = Math.min(b.h * 0.40, 34);
  clayText(ctx, b.label, b.x + b.w / 2, b.y + sink + b.h / 2, fs, {
    fill: chrome
      ? b.kind === 'primary' ? chrome.primaryInk : chrome.ghostInk
      : b.kind === 'ghost' ? CLAY_UI.ink : '#FFF6E9',
    outline: chrome ? 'rgba(0,0,0,0.28)' : b.kind === 'ghost' ? undefined : 'rgba(90,38,16,0.5)',
    outlineWidth: chrome ? Math.max(2, fs * 0.10) : b.kind === 'ghost' ? 0 : Math.max(2, fs * 0.16),
    emboss: false,
  });
}

/**
 * 判断点是否落在按钮内。
 */
export function hitButton(b: Button, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** cover 模式的进度读数。 */
export interface CoverProgress {
  /** 已铺格数 */
  done: number;
  /** 需要铺满的格数 */
  total: number;
  /** 下一个必须收集的星星编号（0 基）；-1 = 无关 */
  shardNext?: number;
}

/**
 * 画 HUD 顶部：居中关号胶囊 + 进度。
 *
 * ## 尺寸为什么是 84 高（2026-11-11 移动端体检）
 *
 * 原来按钮按 90×60 设计像素画。390 宽的屏上缩放是 0.52，
 * 实际只有 46.8×31.2 CSS px —— 远低于 44pt 的触控下限，
 * 拇指要点两下才中。现在 84 设计高 ≈ 43.7 CSS px，w 96 ≈ 50。
 *
 * 胶囊跟着抬到同一高度，三者齐平；`y` 从 88 上提到 80，
 * 给下方进度让出空间。
 *
 * @param skinName 已废弃（游戏内不再显示皮肤名，见 `drawProgressBar` 的右标签）
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  levelIdx: number,
  skinName: string,
  skinCount: number,
  totalSkins: number,
  /** cover 模式的进度读数；经典模式 / 调试页传 null。 */
  coverProgress?: CoverProgress | null,
  /** 主题配色；不传 = 黏土 */
  chrome?: ThemeChrome,
): void {
  // 关号：一块胶囊，压在棋盘上方
  const pw = 250, ph = 88, px = (DESIGN_W - pw) / 2, py = 78;
  clayBlock(
    ctx, px, py, pw, ph, ph * 0.5,
    chrome ? clayFrom(chrome.pill) : CLAY.terracotta,
    71, { depth: 9, hi: 0.08, gloss: chrome ? 0.3 : 1 },
  );
  clayText(ctx, `第 ${levelIdx} 关`, DESIGN_W / 2, py + ph / 2, 36, {
    fill: chrome ? chrome.pillInk : '#FFF6E9',
    outline: chrome ? 'rgba(0,0,0,0.34)' : 'rgba(90,38,16,0.5)',
    outlineWidth: 5,
  });

  // cover 模式：胶囊下方挂一条进度。
  //
  // 旧文案是「已铺 52 / 86 格」—— 玩家真正关心的两个问题是
  // 「我铺了多少」和「还差多少」，一句话只答了一个半，
  // 剩下的要靠心算 86−52。这里改成两个数并列：进度加粗、剩余弱化。
  if (coverProgress) {
    const y = py + ph + 26;
    drawCoverProgress(ctx, coverProgress, y, chrome);
  }

  // 皮肤计数挪到底部进度条右侧（见 `drawProgressBar`）。
  // 它挂在盘面上方时，眼睛刚从「还剩几格」移开就被无关数字拦住；
  // 而它本质上和大厅进度是同一类信息，放一起才讲得通。
  void skinName;
  void skinCount;
  void totalSkins;
}

/**
 * 进度读数：「52 / 86」加粗 + 「剩 34」弱化 + 星屑顺序提示。
 *
 * 两段文字要靠 `measureText` 手工排版 —— `clayText` 只支持单段居中对齐，
 * 段落一多就得知道各自的宽度才能拼成一行。
 */
function drawCoverProgress(
  ctx: CanvasRenderingContext2D,
  p: CoverProgress,
  y: number,
  chrome?: ThemeChrome,
): void {
  const done = Math.max(0, p.done);
  const total = Math.max(0, p.total);
  const left = Math.max(0, total - done);
  const num = `${done} / ${total}`;
  const rest = `剩 ${left}`;

  // compact 档（大棋盘）编号不上棋盘，顺序提示改在这里说
  const star = p.shardNext !== undefined && p.shardNext >= 0 ? ` · 下一个 ★${p.shardNext + 1}` : '';

  ctx.save();
  ctx.font = `800 28px ${CLAY_FONT}`;
  const w1 = ctx.measureText(num).width;
  ctx.font = `700 22px ${CLAY_FONT}`;
  const w2 = ctx.measureText(rest).width;
  ctx.font = `700 22px ${CLAY_FONT}`;
  const w3 = star ? ctx.measureText(star).width : 0;
  ctx.restore();

  // 两组数字是两件事，间距必须明显大于字内的字距，否则读成「21剩21」
  const gap = 28;
  const x0 = DESIGN_W / 2 - (w1 + gap + w2 + w3) / 2;
  clayText(ctx, num, x0, y, 28, {
    align: 'left',
    weight: 800,
    fill: chrome ? chrome.ink : CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, rest, x0 + w1 + gap, y + 2, 22, {
    align: 'left',
    weight: 700,
    fill: chrome ? chrome.inkSoft : CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  if (star) {
    clayText(ctx, star, x0 + w1 + gap + w2, y + 2, 22, {
      align: 'left',
      weight: 700,
      fill: chrome ? chrome.fill : CLAY.terracotta.dark,
      outlineWidth: 0,
      emboss: false,
    });
  }
}

/**
 * 画关卡进度条（糖果胶囊）。
 *
 * @param rightText 右端小字（皮肤计数之类的次要信息）。
 *   它原来挂在盘面上方，和「还剩几格」抢同一块注意力；
 *   挪到这里是因为它和大厅进度是同一类东西。
 */
export function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  current: number,
  total: number,
  rightText?: string,
  chrome?: ThemeChrome,
): void {
  const x = 40, y = 1196, w = DESIGN_W - 80, h = 20;

  // 槽：压进桌面的一道沟。浅底上必须「深两档」才读得出是槽，
  // 而且要走 inset（上沿暗、下沿亮），平涂的深色条会读成一根棕色的棒子。
  // 深色主题上「沟」不成立（底下本来就没有桌面）—— 换成一条半透明的亮槽。
  if (chrome) {
    ctx.fillStyle = chrome.groove;
    tracePts(ctx, rrectPts(x, y, w, h, h / 2, 511, 0.003));
    ctx.fill();
  } else {
    clayInset(ctx, x, y, w, h, h / 2, CLAY.groove, 511, { lit: false, jitter: 0.003 });
  }

  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const fillW = Math.max(0, w * ratio);
  if (fillW > 6) {
    const fw = Math.max(h, fillW);
    ctx.fillStyle = chrome ? chrome.fill : CLAY.terracotta.dark;
    tracePts(ctx, rrectPts(x, y, fw, h, h / 2, 512, 0.003));
    ctx.fill();
    ctx.fillStyle = chrome ? chrome.fill : CLAY.terracotta.base;
    tracePts(ctx, rrectPts(x, y - 2, fw, h, h / 2, 512, 0.003));
    ctx.fill();
    if (!chrome) {
      clayDisc(ctx, x + fw - h / 2, y + h / 2, h * 0.46, CLAY.mustard, 513, { depth: 3 });
    }
  }

  clayText(ctx, `${current} / ${total} 关`, x, y + 36, 24, {
    align: 'left',
    baseline: 'top',
    fill: chrome ? chrome.inkSoft : CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  if (rightText) {
    clayText(ctx, rightText, x + w, y + 36, 24, {
      align: 'right',
      baseline: 'top',
      fill: chrome ? chrome.inkSoft : CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
  }
}

/**
 * 画通关结算页。
 *
 * @param coverUndos  cover 模式的重来次数（`undefined` = 经典模式）
 * @param skipped     是否是「跳过」通关
 * @param isAllCleared 是否已通关最后一关（不再显示「下一关」）
 */
export function drawResult(
  ctx: CanvasRenderingContext2D,
  levelIdx: number,
  steps: number,
  shortest: number,
  timeMs: number,
  unlockedSkin: { id: string; name: string } | null,
  progressRatio: number,
  /**
   * cover 模式的重来次数。
   *
   * cover 模式下步数恒为 `required − 1`，所以结算页不该显示「步数 / 最短」——
   * 两个数字永远相等，读起来像坏了。
   * 改显示「重来 N 次」，星级按重来次数算（见 `starOfCover`）。
   */
  coverUndos?: number | null,
  /**
   * 是否是「跳过」通关。
   *
   * **跳过不给星** —— 花钱买过去的 ≠ 打过去的。
   * 服务端 `CoverSkipHandler` 不发星、客户端 `clearStar` 也清了，
   * 所以结算页绝不能画三星，否则和地图上「这关没星」直接矛盾。
   * 改显示一行「已跳过 · 未获星」。
   */
  skipped = false,
  /**
   * 是否已通关最后一关。
   *
   * 全部通关后不该再显示「下一关」——点了也只会得到一句提示。
   * 改成「查看地图」/「返回大厅」两个按钮。
   */
  isAllCleared = false,
): Button[] {
  // 遮罩：陶土棕的暗，不是夜空的紫黑
  ctx.fillStyle = 'rgba(58,38,24,0.62)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 面板：一块奶油黏土板。高度 748 是按「8 行内容 + 上下各留 18~26 的呼吸」倒推的
  const pw = DESIGN_W - 100, ph = 748, px = 50;
  const py = Math.round((DESIGN_H - ph) / 2);
  const cx = px + pw / 2;

  clayBlock(ctx, px, py, pw, ph, 44, CLAY.cream, 801, { depth: 22, hi: 0.035, jitter: 0.002 });

  // 标题带：压在面板顶部的一条陶土
  clayBlock(ctx, px + 22, py + 20, pw - 44, 82, 30, CLAY.terracotta, 802, { depth: 7, hi: 0.06 });
  clayText(
    ctx,
    isAllCleared ? '🎉 全部通关！' : skipped ? `第 ${levelIdx} 关 已跳过` : `第 ${levelIdx} 关 通关！`,
    cx, py + 61, isAllCleared ? 42 : 46,
    {
      fill: '#FFF6E9',
      outline: 'rgba(90,38,16,0.45)',
      outlineWidth: 5,
    },
  );

  // 三星（金色黏土星，在奶油底上最跳）
  const isCover = coverUndos !== undefined && coverUndos !== null;
  if (skipped) {
    // 跳过：不画星，改成一行说明 —— 与地图上的「没星」保持一致
    clayText(ctx, '已跳过 · 未获星', cx, py + 152, 30, {
      weight: 600,
      fill: 'rgba(74,51,39,0.72)',
      outlineWidth: 0,
      emboss: false,
    });
  } else {
    const stars = isCover ? starOfCover(coverUndos) : starOf(steps, shortest);
    for (let i = 0; i < 3; i++) {
      const on = i < stars;
      clayStar(ctx, cx + (i - 1) * 78, py + 152, i === 1 ? 39 : 34, on ? CLAY.mustard : CLAY.sand, 861 + i, {
        depth: on ? 7 : 3,
        lit: on,
      });
    }
  }

  // 关卡进度：文字 → 细胶囊条 → 数据胶囊
  const pr = Math.min(1, Math.max(0, progressRatio));
  clayText(ctx, `关卡进度 ${(pr * 100).toFixed(1)}%`, cx, py + 212, 24, {
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
  const stats: Array<[string, string]> = isCover
    ? [
        ['重来', `${coverUndos} 次`],
        ['用时', `${(timeMs / 1000).toFixed(1)}s`],
      ]
    : [
        ['步数', `${steps} / 最短 ${shortest}`],
        ['用时', `${(timeMs / 1000).toFixed(1)}s`],
      ];
  stats.forEach(([k, v], i) => {
    const sx = px + 30 + i * (sW + 14);
    clayInset(ctx, sx, sY, sW, sH, 22, CLAY.sand, 810 + i, { jitter: 0.004 });
    clayText(ctx, k, sx + sW / 2, sY + 26, 22, {
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
  //
  // 全部通关后没有「下一关」可点了 —— 把主按钮换成「重玩本关」，
  // 免得玩家点了得到一句「已经是最后一关啦」。
  const mainBtn: Button = isAllCleared
    ? { x: 120, y: py + 456, w: DESIGN_W - 240, h: 88, label: '重玩本关', kind: 'primary', id: 'retry' }
    : { x: 120, y: py + 456, w: DESIGN_W - 240, h: 88, label: '下一关', kind: 'primary', id: 'next' };
  const shareBtn: Button = { x: 120, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '分享', kind: 'secondary', id: 'share' };
  const skinBtn: Button = { x: 140 + (DESIGN_W - 260) / 2, y: py + 562, w: (DESIGN_W - 260) / 2, h: 64, label: '皮肤', kind: 'secondary', id: 'skins' };
  const homeBtn: Button = { x: 120, y: py + 642, w: DESIGN_W - 240, h: 64, label: '返回大厅', kind: 'ghost', id: 'home' };

  drawButton(ctx, mainBtn, false);
  drawButton(ctx, shareBtn, false);
  drawButton(ctx, skinBtn, false);
  drawButton(ctx, homeBtn, false);

  return [mainBtn, shareBtn, skinBtn, homeBtn];
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

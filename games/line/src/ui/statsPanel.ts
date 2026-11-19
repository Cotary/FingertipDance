/**
 * 战绩详情弹层（我的页「战绩」行点开）。
 *
 * ## 为什么单独一个文件
 *
 * `profile.ts` 是主页面版式，一行一个精确坐标；弹层是另一套模态结构
 * （遮罩 + 居中卡 + 关闭），混在一起会让本来就很密的坐标表更难读。
 *
 * ## 色板与主页面同源
 *
 * 直接复用 `profile.ts` 的 `P` 色板语义（深瓷底 + 金读数），不另立一套 ——
 * 弹层是从我的页长出来的，颜色跑偏会一眼看出是"贴上去的"。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedTextRight, trackedWidth, type Button } from './hud';

/** 弹层要展示的战绩数据。 */
export interface StatsPanelState {
  /** 最高已通关关号 */
  maxLevel: number;
  /** 当前该打的关（= maxLevel + 1） */
  currentLevel: number;
  /** 星星总数 */
  starCount: number;
  /** 三星（零重来）关卡数 */
  threeStarCount: number;
  /** 累计重来次数 */
  totalRetries: number;
  /** 累计步数 */
  totalSteps: number;
  /** 累计用时（毫秒） */
  totalTimeMs: number;
  /** 累计看广告次数 */
  adWatchCnt: number;
  /** 总关数（用于「通关 46 / 1000」这类分母） */
  levelCount: number;
}

/** 色板（与 profile.ts 的 P 同源）。 */
const P = {
  ink: '#E4EDE6',
  muted: '#7A7468',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  cellBg: 'rgba(22,36,30,0.92)',
  cellBorder: 'rgba(147,179,162,0.14)',
  line: 'rgba(147,179,162,0.10)',
} as const;

/** 把毫秒压成人读的时长。 */
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '不足 1 分';
  if (totalMin < 60) return `${totalMin} 分`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} 时 ${m} 分` : `${h} 时`;
}

/** 大数字加千分位，步数动辄上万。 */
function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * 卡片几何。
 *
 * ## 高度怎么来的
 *
 * 自上而下累加，不留「大概够」的余量：
 *
 * ```
 * 标题区 158 + 8 行 × 64 = 512 → 列表底 670
 * 关闭键 84 高 + 上方间隙 40 + 底部留白 40 → 需要 164
 * 合计 834，取 880 留一点呼吸
 * ```
 *
 * 初版写死 720 且行高 62（8 行 496），列表底 654 与按钮顶 596 重叠 ——
 * 第 8 行「看广告次数」直接被关闭键压住。**弹层高度必须由内容累加得出**，
 * 写死一个「看着够大」的数字，加一行就会撞。
 */
const CARD = { w: 622, h: 880, r: 36 };

/**
 * 绘制战绩弹层。
 * @returns 可点击按钮（只有「关闭」和遮罩）
 */
export function drawStatsPanel(ctx: CanvasRenderingContext2D, st: StatsPanelState): Button[] {
  const cx = DESIGN_W / 2;
  const x = cx - CARD.w / 2;
  const y = (DESIGN_H - CARD.h) / 2;
  const right = x + CARD.w - 44;

  // ── 遮罩：压暗底下的我的页 ──
  ctx.fillStyle = 'rgba(6,12,9,0.72)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // ── 卡片 ──
  roundRect(ctx, x, y, CARD.w, CARD.h, CARD.r);
  ctx.fillStyle = P.cellBg;
  ctx.fill();
  ctx.strokeStyle = P.cellBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── 标题 ──
  const pad = 48;
  trackedText(ctx, '战 绩', x + pad, y + 82, 34, P.ink, 8.2, 600);
  trackedText(ctx, '全 部 征 途 读 数', x + pad, y + 120, 17, P.muted, 4.6, 400);

  // ── 读数列表 ──
  //
  // 每行「标签 …… 值」，右侧对齐。行高 64 × 8 行 = 512。
  const rows: Array<[string, string]> = [
    ['最高通关', `${st.maxLevel} / ${st.levelCount}`],
    ['当前进度', `第 ${st.currentLevel} 关`],
    ['星星总数', fmtCount(st.starCount)],
    ['零重来通关', `${st.threeStarCount} 关`],
    ['累计重来', `${fmtCount(st.totalRetries)} 次`],
    ['累计步数', fmtCount(st.totalSteps)],
    ['累计用时', fmtDuration(st.totalTimeMs)],
    ['看广告次数', `${fmtCount(st.adWatchCnt)} 次`],
  ];

  const listTop = y + 158;
  const rowH = 64;
  rows.forEach(([label, value], i) => {
    const ry = listTop + i * rowH;
    const base = ry + 41;

    // 行底线（最后一行不画，避免和按钮挤）
    if (i < rows.length - 1) {
      ctx.fillStyle = P.line;
      ctx.fillRect(x + pad, ry + rowH, CARD.w - pad * 2, 1.5);
    }

    trackedText(ctx, label, x + pad, base, 21, P.ink, 4.6, 400);
    trackedTextRight(ctx, value, right, base, 21, P.goldHi, 1.2, 500);
  });

  // ── 关闭按钮 ──
  //
  // 位置由**列表底部**推出，而不是从卡片底部反推 —— 后者在行数变化时会撞上最后一行。
  const bw = CARD.w - pad * 2;
  const bh = 84;
  const listBottom = listTop + rows.length * rowH;
  const by = listBottom + 40;
  roundRect(ctx, x + pad, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(79,122,102,0.92)';
  ctx.fill();

  const label = '关 闭';
  const lw = trackedWidth(ctx, label, 24, 6, 600);
  trackedText(ctx, label, x + pad + (bw - lw) / 2, by + bh / 2 + 9, 24, '#F2EEE6', 6, 600);

  return [
    // 遮罩也算按钮：点卡外区域关闭（id 用 panelDismiss 与关闭键区分，逻辑相同）
    { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H, label: '', kind: 'ghost', id: 'statsClose' },
    { x: x + pad, y: by, w: bw, h: bh, label: '', kind: 'ghost', id: 'statsClose' },
  ];
}

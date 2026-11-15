/**
 * 我的页 —— 「瓷生统计」版式（2026-11-15 定稿，07 屏）。
 *
 * ## 坐标怎么来的
 *
 * 设计稿是 375×812 CSS，我们画 750×1334。换算只有两条：
 *
 *     x = designCss × 2
 *     y = (designCss − 36) × 2      ← 36 是设计稿画出来的假状态栏
 *
 * 真机状态栏在画布之外（safeArea），所以不重复画。减掉 36 之后整页刚好
 * 落进画布，顶行贴齐、底栏仍由 nav.ts 自己撑。
 *
 * 实测值（设计稿 CSS → 画布）：
 *
 * | 元素 | 设计稿 | 画布 |
 * |---|---|---|
 * | 页级出血 | 22 | 44 |
 * | 头行（头像 62 圆） | 24,58 | 48,44 |
 * | 三格统计 | 22,140 高 66 间距 10 | 44,208 高 132 间距 20 |
 * | 主题墙标题 | y224 | y376 |
 * | 主题墙色片 42 间距 8 | 22,247（**左对齐**） | 44,422（84 间距 16） |
 * | 功能行顶线 | y307 | y542 |
 *
 * ## 为什么主题墙是左对齐而不是均分
 *
 * 六枚色片从左边排到 x=314 就停了，右侧留 39 CSS 的空 —— 那是有意的
 * 「未完待续」：主题还会长，右边永远留着位置。做成 space-between 会
 * 显得像六个已经凑满的勋章。
 *
 * ## 五条功能行 vs 设计稿四条
 *
 * 设计稿只画了音效/振动/分享/战绩。真实功能里还有「清除缓存」
 * （只删 `levels_cache`，不动进度），不能悄悄砍掉 —— 补在第 5 行，
 * 行高与分隔线完全沿用前四条。
 *
 * 按钮 id 不变（shareGame / toggleSound / toggleVibrate / clearCache
 * —— main.ts 依赖）。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedTextRight, trackedWidth, SERIF_FONT, type Button } from './hud';
import { SKINS, paletteOf } from '../render/skins';

/** 我的页状态。 */
export interface ProfilePageState {
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalSteps: number;
  totalTimeMs: number;
  adWatchCnt: number;
  unlockedSkins: string[];
  totalSkins: number;
  soundOn: boolean;
  vibrateOn: boolean;
  /** 星星总数。 */
  starCount: number;
  /** 累计重来次数。 */
  totalRetries: number;
  /** 三星关卡数（战绩行「零重来 ★★★ ×N」）。 */
  threeStarCount: number;
  /**
   * 当前该打哪一关（= `maxLevel + 1`，与首页/地图同源）。
   *
   * 不用 `maxLevel` 直接显示：那是「最高已通关关号」，新玩家是 0，
   * 副行会写成「无尽征途 · 第 0 关」—— 像 bug。语义见 HomePageState。
   */
  currentLevel: number;
  /** 玩家 ID（头行「ID xxx」）。 */
  uid: number;
}

// ── 色（定稿 07 我的色板）──
const P = {
  ink: '#E4EDE6',
  muted: '#7A7468',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  cellBg: 'rgba(22,36,30,0.80)',
  cellBorder: 'rgba(147,179,162,0.14)',
  line: 'rgba(147,179,162,0.10)',
  swOn: '#4F7A66',
  swOff: 'rgba(74,92,82,0.55)',
} as const;

/** 版面尺寸（设计稿 07 屏实测 ×2）。 */
const M = {
  /** 页级出血 22 → 44 */
  pad: 44,
  /** 头行比卡片再右移 2 CSS（pf-head 的 margin: 0 2px）→ 48 */
  headX: 48,
  /** 头像：62 直径 → 124，圆心 (55+24, 58+31) CSS → (110, 106) */
  avaCX: 110,
  avaCY: 106,
  avaR: 62,
  /** 昵称/副行的左沿：id.x 101 → 202 */
  idX: 202,
  /** 昵称基线：盒顶 70 CSS → 68，34px 字，基线 ≈ 68 + 27 */
  nameBase: 100,
  /** 副行基线：盒顶 94 → 116，19px 字 */
  subBase: 138,
  /** 三格统计 */
  statsY: 208,
  statsH: 132,
  statGap: 20,
  statsR: 28,
  /** 主题墙标题基线（盒顶 224 → 376，22px 字） */
  wallLabelBase: 394,
  /** 主题墙色片 */
  wallY: 422,
  sw: 84,
  swGap: 16,
  swR: 22,
  /** 功能行顶线 */
  fnTop: 542,
  rowH: 92,
} as const;

/** 玉青渐变头像球 + 衬线首字（定稿 pf-ava）。 */
function drawAva(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, name: string): void {
  // box-shadow: inset 0 2px 5px 高光、inset 0 -6px 12px 暗部、外投影 —— Canvas 没有 inset，
  // 用「径向渐变 + 底部叠一层暗弧」模拟：光从左上来，底部吃阴影。
  const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.44, r * 0.04, cx, cy, r * 1.12);
  g.addColorStop(0, '#DCEBDD');
  g.addColorStop(0.34, '#8FB6A0');
  g.addColorStop(0.68, '#4F7A66');
  g.addColorStop(1, '#1D3A2E');

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // 底部内侧暗弧（inset 阴影）
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.clip();
  const shade = ctx.createLinearGradient(0, cy + r * 0.22, 0, cy + r);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.72, 'rgba(0,0,0,0.16)');
  shade.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - r, cy, r * 2, r);
  // 顶缘一道极细的高光弧：玉件「有釉」全靠这一笔
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.04, r - 4, Math.PI * 1.02, Math.PI * 1.76);
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  const ch = (name || '玩').trim().slice(0, 1) || '玩';
  ctx.save();
  ctx.font = `900 46px ${SERIF_FONT}`;
  ctx.fillStyle = '#1D3A2E';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, cx, cy);
  ctx.restore();
}

/** 一颗小金星（战绩行的「零重来 ★★★」）。 */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.44;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * 绘制我的页。
 * @returns 可点击按钮列表
 */
export function drawProfilePage(ctx: CanvasRenderingContext2D, st: ProfilePageState, _now: number): Button[] {
  const right = DESIGN_W - M.pad;

  // ── 1. 头行：玉青头像球 + 昵称 + 征途读数 ──
  drawAva(ctx, M.avaCX, M.avaCY, M.avaR, st.nickname || '旅人');

  // 昵称只靠字距撑开（设计稿 letter-spacing .3em），不插空格 ——
  // 插空格会让「两字名」看起来像四个字符，而且宽度不可控。
  trackedText(ctx, st.nickname || '玩家', M.idX, M.nameBase, 34, P.ink, 10.2, 600);

  const uid = st.uid ? String(st.uid) : '—';
  trackedText(
    ctx,
    `无尽征途 · 第 ${st.currentLevel} 关　|　ID ${uid}`,
    M.idX,
    M.subBase,
    18,
    P.muted,
    3.9,
    400,
  );

  // ── 2. 三格统计：通关 / 星星 / 重来累计（定稿 pf-stats）──
  const stats: Array<[string, string]> = [
    [String(st.maxLevel), '通关'],
    [String(st.starCount), '星星'],
    [String(st.totalRetries), '重来累计'],
  ];
  const cellW = (DESIGN_W - M.pad * 2 - M.statGap * 2) / 3;
  stats.forEach(([v, k], i) => {
    const x = M.pad + i * (cellW + M.statGap);

    roundRect(ctx, x, M.statsY, cellW, M.statsH, M.statsR);
    ctx.fillStyle = P.cellBg;
    ctx.fill();
    ctx.strokeStyle = P.cellBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 数字与标签都居中：用 trackedWidth 反推左沿，比 textAlign=center 更能保住字距
    const vW = trackedWidth(ctx, v, 38, 1.5, 400);
    trackedText(ctx, v, x + (cellW - vW) / 2, M.statsY + 62, 38, P.goldHi, 1.5, 400);

    const kW = trackedWidth(ctx, k, 17, 4.7, 400);
    trackedText(ctx, k, x + (cellW - kW) / 2, M.statsY + 101, 17, P.muted, 4.7, 400);
  });

  // ── 3. 主题墙（定稿：单行色片，左对齐，右侧留白给「未完待续」）──
  trackedText(
    ctx,
    `主 题 墙 · ${st.unlockedSkins.length} / ${st.totalSkins}`,
    M.pad + 2,
    M.wallLabelBase,
    22,
    P.gold,
    7.3,
    600,
  );

  const owned = new Set(st.unlockedSkins);
  const cols = 6;
  SKINS.slice(0, cols).forEach((skin, i) => {
    const x = M.pad + i * (M.sw + M.swGap);
    const has = owned.has(skin.id);

    ctx.save();
    if (!has) ctx.globalAlpha = 0.35;
    roundRect(ctx, x, M.wallY, M.sw, M.sw, M.swR);
    const pal = paletteOf(skin);
    // 定稿 sw：150° 线性渐变（light → dark）
    const g = ctx.createLinearGradient(x, M.wallY, x + M.sw, M.wallY + M.sw);
    g.addColorStop(0, pal.light);
    g.addColorStop(1, pal.dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  });

  // ── 4. 功能行（定稿 pf-funcs：衬线标签 + 右值 / 玉青开关）──
  ctx.fillStyle = P.cellBorder;
  ctx.fillRect(M.pad, M.fnTop, DESIGN_W - M.pad * 2, 1.5);

  const rows: Array<{ id: string; label: string; value?: string; on?: boolean; accent?: boolean }> = [
    { id: 'toggleSound', label: '音 效', value: st.soundOn ? '开' : '关', on: st.soundOn },
    { id: 'toggleVibrate', label: '振 动', value: st.vibrateOn ? '开' : '关', on: st.vibrateOn },
    { id: 'shareGame', label: '分享挑战', value: '带关卡 + 重来数' },
    { id: 'profileStats', label: '战 绩', value: '', accent: true },
    { id: 'clearCache', label: '清除缓存', value: '本地关卡' },
  ];

  const buttons: Button[] = [];
  rows.forEach((r, i) => {
    const ry = M.fnTop + 2 + i * M.rowH;
    // 不压底部导航（nav 顶 1214）
    if (ry + M.rowH > DESIGN_H - 120) return;

    // 行底线
    ctx.fillStyle = P.line;
    ctx.fillRect(M.pad, ry + M.rowH, DESIGN_W - M.pad * 2, 1.5);

    const base = ry + M.rowH / 2 + 9;
    trackedText(ctx, r.label, M.pad + 2, base, 24, P.ink, 5.28, 500);

    if (r.on !== undefined) {
      // 玉青滑轨开关（定稿 .sw-on：34×19 圆丸 + 白点）
      const swW = 68;
      const swH = 38;
      const sx = right - swW;
      const sy = ry + (M.rowH - swH) / 2;
      roundRect(ctx, sx, sy, swW, swH, swH / 2);
      ctx.fillStyle = r.on ? P.swOn : P.swOff;
      ctx.fill();
      const knobR = swH / 2 - 5;
      const knobX = r.on ? sx + swW - swH / 2 : sx + swH / 2;
      ctx.beginPath();
      ctx.arc(knobX, sy + swH / 2, knobR, 0, Math.PI * 2);
      ctx.fillStyle = '#F2EEE6';
      ctx.fill();
    } else if (r.accent) {
      // 战绩：零重来 ★★★ ×N —— 星级是「零重来通关」的关数，永远三颗满星
      const times = `×${st.threeStarCount}`;
      const tW = trackedWidth(ctx, times, 20, 3.6, 600);
      trackedTextRight(ctx, times, right, base, 20, P.gold, 3.6, 600);

      const sr = 9;
      const sGap = 7;
      const starsW = sr * 2 * 3 + sGap * 2;
      const starsRight = right - tW - 16;
      for (let s = 0; s < 3; s++) {
        const cx = starsRight - starsW + sr + s * (sr * 2 + sGap);
        ctx.fillStyle = P.goldHi;
        star(ctx, cx, base - 7, sr);
      }

      const label = '零重来';
      const lW = trackedWidth(ctx, label, 20, 3.6, 500);
      trackedText(ctx, label, starsRight - starsW - 14 - lW, base, 20, P.gold, 3.6, 500);
    } else if (r.value !== undefined) {
      trackedTextRight(ctx, r.value, right, base, 20, P.muted, 3.6, 400);
    }

    buttons.push({ x: M.pad, y: ry, w: DESIGN_W - M.pad * 2, h: M.rowH, label: '', kind: 'ghost', id: r.id });
  });

  return buttons;
}

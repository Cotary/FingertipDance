/**
 * 我的页 —— 「瓷生统计」版式（2026-11-15 定稿，07 屏；2026-11-20 去掉主题墙）。
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
 * | 功能行顶线 | y307 | y537（居中，见下） |
 *
 * ## 主题墙为什么删了（2026-11-20）
 *
 * 设计稿 07 屏原有一条「主题墙」色片行，实际做出来发现三个问题，整块移除：
 *
 * 1. **不可点** —— 色片不在按钮列表里，玩家点了没反应；而底下每行功能都有去处。
 * 2. **数字自相矛盾** —— 标题写「2 / 16」，色片只画 `SKINS.slice(0, 6)` 六片，
 *    读起来像「6 个里解锁 2 个」。剩下 10 个凭空消失。
 * 3. **名不副实** —— 叫「主题墙」，画的却是皮肤（`SKINS`）；项目里另有 themes
 *    系统。而且皮肤页（底栏 tab）才是完整的收集 + 装备界面，这里是重复展示。
 *
 * ## 功能行从五行回到四行（2026-11-20）
 *
 * 第 5 行「清除缓存 · 本地关卡」是个**假功能**，已删。原因：
 *
 * 它唯一做的事是 `storage.remove('levels_cache')`，但那个 key 现在**没人写**
 * —— 写它的是 `progressStore.ts` 的 `LevelStore`，而主入口实例化的是
 * `CoverLevelStore`，全项目已无 `new LevelStore()`。`CoverLevelStore` 更是
 * 完全不落盘（关卡表要么在 bundle 内置 JSON，要么从服务端实时拉）。
 * 也就是说：本地根本没有可清的关卡缓存，点下去零效果零反馈。
 *
 * 同期一并清掉了 `CoverLevelStore.clearCache()`（删 `cover_levels_cache`，
 * 同样从未被写入、也从未被调用）。
 *
 * 现在正好回到设计稿的四条。
 *
 * ## 为什么功能行居中而不是贴顶
 *
 * 统计格底 340、底栏顶 1214 → 可用 874。4 行 × 120 = 480，从 537 起
 * 上下各留 197，整块在可用区里居中。设计稿原值（顶线 542 / 行高 92）
 * 是五行紧凑贴顶的排法，四行还那样排会在底部留出 300+ 的空白。
 *
 * 按钮 id（shareGame / toggleSound / toggleVibrate / profileStats
 * —— main.ts 依赖）。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedTextRight, trackedWidth, SERIF_FONT, type Button } from './hud';
import { getAvatarImage, drawAvatarImage } from './avatar';

/** 我的页状态。 */
export interface ProfilePageState {
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalSteps: number;
  totalTimeMs: number;
  adWatchCnt: number;
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
  /**
   * 昵称头像是否已经填过（服务端有值）。
   *
   * 用它决定「昵称头像」行右值是「已同步」还是「未设置」——
   * 光看 `nickname` 不行：服务端对新用户下发的是空串，
   * 而本地会兜成「玩家」，两个都看不出"你到底填没填过"。
   */
  profileFilled?: boolean;
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
  /**
   * 功能行顶线。
   *
   * 统计格底 340、底栏顶 1214 → 可用 874。
   * **6 行 × 100 = 600**，从 477 起上下各留 137，整块在可用区里居中。
   *
   * 2026-11-22 加了「昵称头像」与「适龄提示」两行，行数从 4 变 6：
   * 原来的 4 行 × 120（起 537）塞不下第 5 行 —— 第 6 行会被
   * `DESIGN_H - 120` 那条防线直接丢掉（按钮消失且没有任何提示）。
   * 所以改成 6 行 × 100，间距略收紧，视觉密度和原来接近。
   */
  fnTop: 477,
  rowH: 100,
} as const;

/**
 * 玉青渐变头像球。
 *
 * 有头像图（服务端下发的微信头像）就画图，没有就画昵称首字。
 * 首字不是「兜底凑数」而是**正常形态** —— 大量玩家没设头像，
 * 玉球 + 首字的观感比一个灰色占位图好得多。
 */
function drawAva(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  name: string,
  avatarUrl: string,
): void {
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

  // ── 内容层：有图贴图，无图画首字 ──
  //
  // 这一步必须在「底部暗弧 + 顶缘高光」**之前**：那两层是玉球的釉面，
  // 要压在头像图上面才有「嵌在玉里」的观感。反过来先画釉面再贴图，
  // 头像会把高光盖掉，看起来像一张贴纸糊在球上。
  const img = getAvatarImage(avatarUrl);
  if (img) {
    drawAvatarImage(ctx, cx, cy, r - 1, img);
  } else {
    const ch = (name || '玩').trim().slice(0, 1) || '玩';
    ctx.save();
    ctx.font = `900 46px ${SERIF_FONT}`;
    ctx.fillStyle = '#1D3A2E';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy);
    ctx.restore();
  }

  // ── 釉面：底部内侧暗弧 + 顶缘高光 ──
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
  drawAva(ctx, M.avaCX, M.avaCY, M.avaR, st.nickname || '旅人', st.avatar);

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

  // ── 3. 功能行（定稿 pf-funcs：衬线标签 + 右值 / 玉青开关）──
  ctx.fillStyle = P.cellBorder;
  ctx.fillRect(M.pad, M.fnTop, DESIGN_W - M.pad * 2, 1.5);

  const rows: Array<{ id: string; label: string; value?: string; on?: boolean; accent?: boolean }> = [
    { id: 'toggleSound', label: '音 效', value: st.soundOn ? '开' : '关', on: st.soundOn },
    { id: 'toggleVibrate', label: '振 动', value: st.vibrateOn ? '开' : '关', on: st.vibrateOn },
    // 昵称头像：微信不给「静默拿资料」，必须玩家点一下才弹授权框。
    // 没填过时右值是「未设置」，填过就显示「已同步」—— 玩家一眼知道点它有东西可改。
    { id: 'editProfile', label: '昵称头像', value: st.profileFilled ? '已同步' : '未设置' },
    { id: 'shareGame', label: '分享挑战', value: '带关卡 + 重来数' },
    // 适龄提示：首次启动已经弹过一次，这里给个随时能回看的入口。
    { id: 'ageGate', label: '适龄提示', value: '8+' },
    { id: 'profileStats', label: '战 绩', value: '', accent: true },
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

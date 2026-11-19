/**
 * 分享海报生成 + 分享文案。
 */
import { skinById } from '../render/skins';
import { platform } from '../platform';

/**
 * 分享文案池。
 *
 * **逐字照抄设计稿**（`2026-11-20-秘色天青-分享挑战.html` 的 COPY_POOL），四条，不多不少。
 *
 * 顺序是固定的，因为分享面板要提供「换一条」：
 * 随机取一条 + 一个 index 游标会重复抽到同一条，玩家点三次还是那一条。
 * 所以改成按 index 取，换一条 = index + 1 取模。
 *
 * 第三条「敢不敢试试我的主题？」不带 `{lv}` —— 它卖的是主题而不是关卡，
 * 这是设计稿里唯一一条不涉及关号的文案，别顺手给它补个占位符。
 */
const COPY_POOL = [
  '我卡在第 {lv} 关，你能连过去吗？',
  '这关我重来 {undos} 次，你呢？',
  '敢不敢试试我的主题？',
  '第 {lv} 关，我不信你过得去',
];

/** 文案池长度（分享面板「换一条」要用）。 */
export function shareCopyCount(): number {
  return COPY_POOL.length;
}

/**
 * 生成分享文案。
 *
 * @param levelIdx 关号
 * @param undos   重来次数（cover 模式的对比维度）
 * @param index   文案游标；不给则随机。**给了就一定按 index 取**，
 *                这样「换一条」是可预期的（见 COPY_POOL 注释）。
 */
export function shareCopy(levelIdx: number, undos: number, index?: number): string {
  const i = index === undefined
    ? Math.floor(Math.random() * COPY_POOL.length)
    : ((index % COPY_POOL.length) + COPY_POOL.length) % COPY_POOL.length;
  return COPY_POOL[i].replace('{lv}', String(levelIdx)).replace('{undos}', String(undos));
}

/** 离屏 canvas 类型（兼容微信 offscreen 与浏览器 canvas）。 */
interface PosterCanvas {
  width: number;
  height: number;
  getContext: (type: '2d') => CanvasRenderingContext2D | null;
  toDataURL?: (type: string) => string;
}

/**
 * 创建离屏 canvas（平台分支）。
 */
function createPosterCanvas(): PosterCanvas {
  if (platform.name === 'wechat') {
    const wx = (globalThis as { wx?: { createOffscreenCanvas?: (o: { type: '2d'; width: number; height: number }) => PosterCanvas } }).wx;
    const off = wx?.createOffscreenCanvas?.({ type: '2d', width: 750, height: 1334 });
    if (off) return off;
  }
  const c = document.createElement('canvas');
  c.width = 750;
  c.height = 1334;
  return c;
}

/**
 * 分享海报只需要关号与盘面尺寸。
 *
 * cover 模式的关卡对象跟经典模式结构不同（没有 `grid: Cell[][]`），
 * 所以这里定义一个最小接口，两种模式都能喂。
 */
export interface PosterLevel {
  idx: number;
  w: number;
  h: number;
}

/** 海报文案参数。 */
export interface PosterCopy {
  /** 文案正文（已替换占位符） */
  text: string;
}

/** 天青海报色板（逐字照抄设计稿 :root）。 */
const PP = {
  gold100: '#FFF3D6',
  gold200: '#F2DCA8',
  gold300: '#D4AF6A',
  gold400: '#B8945A',
  gold500: '#8A6B3C',
  c050: '#E4EDE6',
  c200: '#B8CFC0',
  c500: '#4F7A66',
  c700: '#1D3A2E',
  i300: '#B9B2A4',
  i500: '#7A7468',
  i700: '#454038',
} as const;

/** 衬线栈（海报是全屏大图，必须用衬线）；与 hud 的 SERIF_FONT 同序。 */
const SERIF = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';

/**
 * 生成分享海报 —— 750×1334，**零图片素材**，五段构图。
 *
 * 构图（自上而下，设计稿定死）：
 *
 * ```
 * 品牌眉 → 大关号 → 金缮光迹 → 文案 → 落款与码
 * ```
 *
 * 取色只走天青一套（设计稿的丹青版是同一构图换色，等主题系统接进来再参数化）。
 *
 * @param level    关卡信息
 * @param skinId   皮肤 id（**当前不参与取色**，见下）
 * @param undos    重来次数（cover 模式唯一有区分度的成绩）
 * @param nickname 昵称
 * @param copy     文案（由调用方决定用哪一条，面板要能「换一条」）
 * @param uid      玩家 ID（落款小字）
 * @param ms       用时毫秒（0 = 不显示，挑战邀请场景拿不到用时）
 */
export function renderPoster(
  level: PosterLevel,
  skinId: string,
  undos: number,
  nickname: string,
  copy?: PosterCopy,
  uid?: number,
  ms?: number,
): PosterCanvas {
  const canvas = createPosterCanvas();
  const ctx = canvas.getContext('2d')!;
  const W = 750;
  const H = 1334;
  const cx = W / 2;

  // 皮肤参数目前只用于「盘面预览」这一处装饰；
  // 海报主色是**主题**色（天青），不是皮肤色 —— 皮肤只换格子色相。
  const skin = skinById(skinId);
  void skin;

  // ── 底：深釉 + 右上金晕（设计稿 radial 90% 60% at 82% 4%）──
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  // 165deg 的近似：从左上到右下
  bg.addColorStop(0, '#1A2B23');
  bg.addColorStop(0.55, '#122019');
  bg.addColorStop(1, '#0D1712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.82, H * 0.04, 0, W * 0.82, H * 0.04, W * 0.9);
  glow.addColorStop(0, 'rgba(212,175,106,0.16)');
  glow.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── 一段：品牌眉 ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = PP.gold300;
  ctx.font = `600 24px ${SERIF}`;
  tracked(ctx, 'SHARE CHALLENGE · 同关竞速', cx, 132, 24, 0.34 * 24);

  ctx.fillStyle = PP.c050;
  ctx.font = `700 44px ${SERIF}`;
  tracked(ctx, '秘色 · 天青', cx, 186, 44, 0.32 * 44);

  // ── 二段：大关号 ──
  //
  // 「第 / 047 / 关」三段基线对齐，中间那个数最大。
  // 关号补零到三位（设计稿写 047）—— 位数变化会让整行左右跳动。
  const lvStr = String(level.idx).padStart(3, '0');
  ctx.textBaseline = 'alphabetic';
  const numSize = 172;
  const sideSize = 40;

  ctx.font = `900 ${numSize}px ${SERIF}`;
  const numW = ctx.measureText(lvStr).width;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  const sideW = ctx.measureText('第').width;
  const gap = 26;
  const totalW = sideW * 2 + numW + gap * 2;
  const startX = cx - totalW / 2;
  const baseY = 470;

  ctx.textAlign = 'left';
  ctx.fillStyle = PP.gold300;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  ctx.fillText('第', startX, baseY - 18);

  ctx.fillStyle = PP.gold200;
  ctx.font = `900 ${numSize}px ${SERIF}`;
  ctx.fillText(lvStr, startX + sideW + gap, baseY);

  ctx.fillStyle = PP.gold300;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  ctx.fillText('关', startX + sideW + gap + numW + gap, baseY - 18);
  ctx.textAlign = 'center';

  // 细金线
  ctx.fillStyle = PP.gold400;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(cx - 26, 512, 52, 1);
  ctx.globalAlpha = 1;

  // ── 成绩行：重来 N 次 · ★★★ · 用时 ──
  const stars = undos === 0 ? 3 : undos <= 2 ? 2 : 1;
  const parts: string[] = [`重来 ${undos} 次`, '★'.repeat(stars)];
  if (ms && ms > 0) parts.push(`${(ms / 1000).toFixed(1)}s`);

  ctx.font = `600 30px ${SERIF}`;
  const statLine = parts.join('  ·  ');
  ctx.fillStyle = PP.i300;
  tracked(ctx, statLine, cx, 570, 30, 0.12 * 30);

  // ── 三段：金缮光迹（设计稿的折线一笔，粗底 + 渐变 + 细高光）──
  drawGoldTrail(ctx, cx, 648);

  // ── 四段：文案 ──
  const text = copy?.text ?? shareCopy(level.idx, undos);
  ctx.fillStyle = PP.gold100;
  ctx.font = `600 42px ${SERIF}`;
  wrapTracked(ctx, `「${text}」`, cx, 800, 42, 0.14 * 42, 620, 74, PP.gold100);

  // ── 五段：落款与码 ──
  // 虚线分隔
  ctx.save();
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = 'rgba(212,175,106,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 1010);
  ctx.lineTo(W - 96, 1010);
  ctx.stroke();
  ctx.restore();

  // 头像玉球
  const avaR = 44;
  const avaX = 120;
  const avaY = 1090;
  const ag = ctx.createRadialGradient(
    avaX - avaR * 0.36, avaY - avaR * 0.48, avaR * 0.05,
    avaX, avaY, avaR * 1.1,
  );
  ag.addColorStop(0, PP.c200);
  ag.addColorStop(0.6, PP.c500);
  ag.addColorStop(1, PP.c700);
  ctx.beginPath();
  ctx.arc(avaX, avaY, avaR, 0, Math.PI * 2);
  ctx.fillStyle = ag;
  ctx.fill();

  ctx.fillStyle = PP.c700;
  ctx.font = `900 40px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((nickname || '我').trim().slice(0, 1) || '我', avaX, avaY + 2);

  // 昵称 + 副行
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PP.c050;
  ctx.font = `600 34px ${SERIF}`;
  tracked(ctx, nickname || '我', avaX + avaR + 28, avaY + 2, 34, 0.16 * 34);

  ctx.fillStyle = PP.i500;
  ctx.font = `400 21px ${SERIF}`;
  const sub = uid ? `无尽征途 · ID ${uid}` : '无尽征途';
  tracked(ctx, sub, avaX + avaR + 28, avaY + 42, 21, 0.18 * 21);

  // slogan
  ctx.textAlign = 'center';
  ctx.fillStyle = PP.i700;
  ctx.font = `600 22px ${SERIF}`;
  tracked(ctx, 'COVER THE BOARD · ONE GOLD TRAIL', cx, 1250, 22, 0.32 * 22);

  return canvas;
}

/**
 * 带字距的一行文字（海报用）。
 *
 * 逐字画，因为 Canvas 的 `letterSpacing` 在微信端支持不全。
 * 宽度按 `size + spacing` 累加，保证和 `trackedWidth` 一致。
 */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  size: number,
  spacing: number,
): void {
  ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  // 先量总宽（含字距），居中
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  total -= spacing;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = cx - total / 2;
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prevAlign;
}

/** 带字距的自动折行（海报文案用，最多两行）。 */
function wrapTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  size: number,
  spacing: number,
  maxW: number,
  lineH: number,
  color: string,
): void {
  ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  ctx.fillStyle = color;

  // 按宽度切行（中文按字，不按词）
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width + spacing;
    if (curW + w > maxW && cur) {
      lines.push(cur);
      cur = ch;
      curW = w;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur) lines.push(cur);

  lines.forEach((ln, i) => {
    tracked(ctx, ln, cx, y + i * lineH, size, spacing);
  });
}

/**
 * 金缮光迹：一条折线，三层叠加。
 *
 * 设计稿的 path 是固定的手画折线（`M 20 44 L 84 44 L 84 20 ...`），
 * 三层：粗底（暗金 · 半透）+ 渐变主线 + 细高光。刻意**不**随关号变化 ——
 * 它是纹样不是数据，变了就成了另一种东西。
 */
function drawGoldTrail(ctx: CanvasRenderingContext2D, cx: number, top: number): void {
  // 240×58 的设计稿 path，按 1.1 倍放大
  const s = 1.1;
  const pts = [
    [20, 44], [84, 44], [84, 20], [156, 20], [156, 38], [220, 38],
  ].map(([x, y]) => [cx - (240 * s) / 2 + x * s, top + y * s] as const);

  const stroke = (width: number, style: string | CanvasGradient) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  stroke(9 * s, 'rgba(212,175,106,0.3)');

  const g = ctx.createLinearGradient(pts[0][0], top + 44 * s, pts[5][0], top + 20 * s);
  g.addColorStop(0, PP.gold500);
  g.addColorStop(1, PP.gold200);
  stroke(4 * s, g);

  stroke(1.2 * s, 'rgba(255,243,214,0.5)');

  // 两端圆点：起点带环，终点实心
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[5];
  ctx.beginPath();
  ctx.arc(sx, sy, 4.2 * s, 0, Math.PI * 2);
  ctx.fillStyle = PP.gold400;
  ctx.fill();
  ctx.strokeStyle = PP.gold200;
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ex, ey, 4.2 * s, 0, Math.PI * 2);
  ctx.fillStyle = PP.gold200;
  ctx.fill();
}

/**
 * 分享海报生成 + 分享文案。
 */
import { skinById } from '../render/skins';
import { createOffscreenCanvas } from '../platform/offscreen';
import { encodeQr } from '../core/qr';

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
export interface PosterCanvas {
  width: number;
  height: number;
  getContext: (type: '2d') => CanvasRenderingContext2D | null;
  toDataURL?: (type: string) => string;
}

/**
 * 创建离屏 canvas。
 *
 * 抖音端此前没有分支 —— 直接 `document.createElement` 会崩（`document` 不存在）。
 * 现在统一走 `platform/offscreen`，两端都由它决定用哪套 API。
 */
function createPosterCanvas(): PosterCanvas | null {
  return createOffscreenCanvas(750, 1334) as unknown as PosterCanvas | null;
}

/**
 * 创建分享卡图的离屏画布 —— **5:4**（1080×864）。
 *
 * 微信卡片的最佳比例就是 5:4（详见 `renderShareCard` 的说明）。
 * 用 1080×864 而不是 500×400：微信会按原图缩放，
 * 大图在高分屏上不糊（传 500×400 的图会被拉糊）。
 */
function createShareCardCanvas(): PosterCanvas | null {
  return createOffscreenCanvas(1080, 864) as unknown as PosterCanvas | null;
}

/**
 * 在画布上画一个二维码。
 *
 * ## 为什么自己生成而不是让服务端出图
 *
 * 微信的 `wxacode.getUnlimited` 需要 access_token + 小程序已发布，
 * 抖音还得另接一套接口；而且它**必须有网络** ——
 * 海报是离线生成的（玩家可能在没网的时候分享），不能依赖网络才有码。
 *
 * 自己做（`core/qr.ts`）就没有这些约束：两端通用、不联网、
 * 离线可生成。
 *
 * ## 为什么要画「白底方块」
 *
 * 深色底上直接画深色模块 = 扫不出来。扫码器靠**明暗对比**
 * 定位模块，所以码区必须有一圈**浅色底**（标准里的 quiet zone）。
 * 这里在深色海报上垫一块浅色方块，把码画在上面。
 *
 * ## 画不出码时
 *
 * 返回 false，调用方**不画任何东西** —— 宁可海报上没码，
 * 也不要画一个「看着像码但扫不出来」的方块（那比没有更糟：
 * 玩家扫不出来会以为游戏坏了）。
 */
function drawQr(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): boolean {
  const m = encodeQr(text);
  if (!m) return false;

  const n = m.length;
  // 每个模块多少像素（取整后可能略小于 size，最后居中）
  const cell = size / n;
  const used = Math.floor(cell * n);
  const offX = x + (size - used) / 2;
  const offY = y + (size - used) / 2;

  // 浅色底（含 quiet zone —— 标准要求码区四周留 4 个模块的空白）
  const quiet = Math.ceil(cell * 2);
  ctx.fillStyle = '#FFFDF7';
  ctx.fillRect(x - quiet, y - quiet, size + quiet * 2, size + quiet * 2);

  // 深色模块
  ctx.fillStyle = '#122019';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      ctx.fillRect(
        offX + c * cell,
        offY + r * cell,
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
  }
  return true;
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
 * @param shareUrl 分享链接（**二维码的内容**）。空串 / 缺省 = 不画码。
 */
export function renderPoster(
  level: PosterLevel,
  skinId: string,
  undos: number,
  nickname: string,
  copy?: PosterCopy,
  uid?: number,
  ms?: number,
  shareUrl?: string,
): PosterCanvas | null {
  const canvas = createPosterCanvas();
  // 极端环境（既无 DOM 也拿不到小游戏离屏画布）返回 null，由调用方提示
  // 「当前环境不支持保存海报」—— 比在这里抛异常把分享整个打断要好
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
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
  //
  // **优先压成一行**：设计稿的文案是一行居中（`.p-copy` 没给宽度上限），
  // 旧实现固定 42px、620 宽，最长那条「这关我重来 0 次，你呢？」放不下就折行，
  // 收尾的 `」` 被孤零零甩到第二行。这里先按宽度缩字号（最低 32px），
  // 缩到 32 还放不下才折行 —— 折行时也不让标点单独起行。
  const text = copy?.text ?? shareCopy(level.idx, undos);
  const quoted = `「${text}」`;
  const copyMaxW = 620;
  const copyTrack = 0.14;
  const copySize = fitSize(ctx, quoted, 42, copyTrack, copyMaxW, 32);
  const copySpacing = copyTrack * copySize;
  ctx.fillStyle = PP.gold100;
  if (measureLine(ctx, quoted, copySize, copySpacing) <= copyMaxW) {
    tracked(ctx, quoted, cx, 800, copySize, copySpacing);
  } else {
    wrapTracked(ctx, quoted, cx, 800, copySize, copySpacing, copyMaxW, 74, PP.gold100);
  }

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

  // 头像里的首字：取**字素**的第一个 —— 英文 / emoji 昵称按 UTF-16 切会切出半个字符
  const initial = Array.from((nickname || '我').trim())[0] ?? '我';
  ctx.fillStyle = PP.c700;
  ctx.font = `900 40px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, avaX, avaY + 2);

  // ── 昵称 + 副行 ──
  //
  // **左对齐**接在头像右侧，整块以头像中心垂直居中（设计稿 `.p-foot` 是
  // `align-items: center` 的横向 flex，`p-user` 是个左对齐的两行块）。
  //
  // 这里必须用 `tracked(..., 'left')`。旧实现把「左起点」当成 `tracked` 的
  // 「中心点」传了进去：昵称整体左移半个字宽，副行（长得多）直接横穿头像球 ——
  // 截图里「无尽征途 · ID 333」压在玉球上就是这么来的。
  const nameSize = 34;
  const subSize = 21;
  const nameGap = 12;
  const nameX = avaX + avaR + 28;
  // 右边界和虚线分隔对齐（`W - 96`），长昵称截断，不许冲出海报
  const nameMaxW = W - 96 - nameX;
  const blockTop = avaY - (nameSize + nameGap + subSize) / 2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const shownName = fitLine(ctx, (nickname || '我').trim() || '我', nameSize, 0.16 * nameSize, nameMaxW);
  ctx.fillStyle = PP.c050;
  ctx.font = `600 ${nameSize}px ${SERIF}`;
  tracked(ctx, shownName, nameX, blockTop + nameSize, nameSize, 0.16 * nameSize, 'left');

  const sub = uid ? `无尽征途 · ID ${uid}` : '无尽征途';
  const shownSub = fitLine(ctx, sub, subSize, 0.18 * subSize, nameMaxW);
  ctx.fillStyle = PP.i500;
  ctx.font = `400 ${subSize}px ${SERIF}`;
  tracked(ctx, shownSub, nameX, blockTop + nameSize + nameGap + subSize, subSize, 0.18 * subSize, 'left');

  // ── 二维码（落款右侧）──
  //
  // 扫了它就能直接进这一关 —— 海报上唯一的「入口」。
  // 没有链接时不画（宁可没有，也不要画一个扫不出东西的方块）。
  if (shareUrl) {
    const qrSize = 150;
    const qrX = W - 96 - qrSize;
    const qrY = avaY - qrSize / 2;
    drawQr(ctx, shareUrl, qrX, qrY, qrSize);

    // 码下面一行小字，说明扫的是啥
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PP.i500;
    ctx.font = `400 19px ${SERIF}`;
    tracked(ctx, '扫码挑战同关', qrX + qrSize / 2, qrY + qrSize + 40, 19, 0.2 * 19);
  }

  // slogan
  //
  // `i500` 而不是 `i700`：底是深釉（#1A2B23 → #0D1712），
  // i700（#454038）上去对比度只有 ~1.9:1，渲染出来**基本看不见**
  // —— 一行看不见的标语等于没写，还占了版面。i500 与落款副行同色，
  // 已经是这个底色上「次级文字」的既有口径。
  ctx.textAlign = 'center';
  ctx.fillStyle = PP.i500;
  ctx.font = `600 22px ${SERIF}`;
  tracked(ctx, 'COVER THE BOARD · ONE GOLD TRAIL', cx, 1250, 22, 0.32 * 22);

  return canvas;
}

/**
 * 分享卡图 —— **5:4**（1080×864）。
 *
 * ## 为什么海报（9:16）不能直接当卡片图
 *
 * 微信聊天里的分享卡片是**横向**的，最佳比例 **5:4**
 * （500×400 / 1080×864）。把 750×1334 的竖海报塞进 `imageUrl`，
 * 微信会**居中裁切** —— 上下两个大标题都被切掉，只剩中间那条
 * 金缮光迹，看起来像一张空图。
 *
 * 所以要**另出一张**卡图：横向构图，信息量比海报少，
 * 但**在卡片那个尺寸里排得下、看得清**。
 *
 * ## 版式（自左向右）
 *
 * ```
 * ┌──────────────────────────────┐
 * │  第 047 关        │  ┌────┐  │
 * │  零重来           │  │ QR │  │
 * │  「文案」         │  └────┘  │
 * │  秘色 · 天青      │          │
 * └──────────────────────────────┘
 * ```
 *
 * 左边是文字块，右边是二维码 —— 二维码不能省：
 * 卡片在聊天列表里是**小图**，点进去才有链接，
 * 而「扫一眼就想扫」的人看到的是卡片本身。
 *
 * @param level   关卡信息
 * @param undos   重来次数（0 = 零重来，是最好的成绩）
 * @param copy    文案
 * @param shareUrl 二维码内容；空串 = 不画码（右边留白）
 */
export function renderShareCard(
  level: PosterLevel,
  undos: number,
  copy: string,
  shareUrl?: string,
): PosterCanvas | null {
  const canvas = createShareCardCanvas();
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const W = 1080;
  const H = 864;

  // ── 底：与海报同一套深釉 ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1A2B23');
  bg.addColorStop(0.6, '#122019');
  bg.addColorStop(1, '#0D1712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.86, H * 0.1, 0, W * 0.86, H * 0.1, W * 0.7);
  glow.addColorStop(0, 'rgba(212,175,106,0.16)');
  glow.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const PAD = 76;
  const leftW = shareUrl ? W - PAD * 2 - 300 : W - PAD * 2;
  const cx = PAD + leftW / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // ── 眉：品牌 ──
  ctx.fillStyle = PP.gold300;
  ctx.font = `600 26px ${SERIF}`;
  tracked(ctx, '秘色 · 天青', cx, PAD + 6, 26, 0.32 * 26);

  // ── 主：关号 ──
  //
  // 「第 047 关」一行。字号比海报小 —— 卡片高度只有 864，
  // 大字会把下面挤没。
  ctx.textBaseline = 'alphabetic';
  const lvStr = String(level.idx).padStart(3, '0');
  const numSize = 132;
  const sideSize = 36;
  ctx.font = `900 ${numSize}px ${SERIF}`;
  const numW = ctx.measureText(lvStr).width;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  const sideW = ctx.measureText('第').width;
  const gap = 20;
  const totalW = sideW * 2 + numW + gap * 2;
  const startX = cx - totalW / 2;
  const baseY = PAD + 250;

  ctx.fillStyle = PP.c050;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  ctx.textAlign = 'left';
  ctx.fillText('第', startX, baseY);
  ctx.fillStyle = PP.gold100;
  ctx.font = `900 ${numSize}px ${SERIF}`;
  ctx.fillText(lvStr, startX + sideW + gap, baseY);
  ctx.fillStyle = PP.c050;
  ctx.font = `600 ${sideSize}px ${SERIF}`;
  ctx.fillText('关', startX + sideW + gap + numW + gap, baseY);

  // ── 成绩 ──
  //
  // 「零重来」是 cover 模式唯一有区分度的成绩（步数恒定）。
  // 有重来次数就写成「N 次重来」—— 两种说法都诚实。
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = undos === 0 ? PP.gold100 : PP.i500;
  ctx.font = `600 40px ${SERIF}`;
  tracked(ctx, undos === 0 ? '零重来' : `${undos} 次重来`, cx, baseY + 74, 40, 0.28 * 40);

  // ── 文案 ──
  const quoted = `「${copy}」`;
  const copyMaxW = leftW - 40;
  const copySize = fitSize(ctx, quoted, 38, 0.14, copyMaxW, 26);
  const copySpacing = 0.14 * copySize;
  ctx.fillStyle = PP.gold100;
  if (measureLine(ctx, quoted, copySize, copySpacing) <= copyMaxW) {
    tracked(ctx, quoted, cx, baseY + 168, copySize, copySpacing);
  } else {
    wrapTracked(ctx, quoted, cx, baseY + 168, copySize, copySpacing, copyMaxW, 62, PP.gold100);
  }

  // ── 底部：slogan ──
  // 同海报：深底上不用 i700（看不见），与落款副行统一到 i500
  ctx.textAlign = 'center';
  ctx.fillStyle = PP.i500;
  ctx.font = `600 24px ${SERIF}`;
  tracked(ctx, 'COVER THE BOARD · ONE GOLD TRAIL', cx, H - PAD + 6, 24, 0.3 * 24);

  // ── 右：二维码 ──
  if (shareUrl) {
    const qrSize = 240;
    const qrX = W - PAD - qrSize;
    const qrY = (H - qrSize) / 2 - 10;
    drawQr(ctx, shareUrl, qrX, qrY, qrSize);
  }

  return canvas;
}

/**
 * 画一行带字距的文字。
 *
 * 逐字画，因为 Canvas 的 `letterSpacing` 在微信端支持不全。
 * 宽度按 `size + spacing` 累加，保证和 `trackedWidth` 一致。
 *
 * @param x      `align='center'` 时是**中心点**，`align='left'` 时是**左起点**
 * @param align  对齐方式。默认居中 —— 海报里绝大多数行都是居中排的；
 *               落款那种「接在头像右侧」的块必须显式传 `'left'`，
 *               否则就会像 2026-11-21 的截图那样，副行横穿头像球。
 */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  align: 'center' | 'left' = 'center',
): void {
  ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  // 先量总宽（含字距）
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  total -= spacing;

  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cx = align === 'left' ? x : x - total / 2;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prevAlign;
}

/** 一行带字距文字的宽度（会顺手改当前 font）。 */
function measureLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  spacing: number,
): number {
  ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}

/** 一行放不下就截断补省略号（昵称 / ID 用）。 */
function fitLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  spacing: number,
  maxW: number,
): string {
  ctx.font = ctx.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  const chars = Array.from(text);
  let w = 0;
  let out = '';
  for (const ch of chars) {
    const cw = ctx.measureText(ch).width + spacing;
    if (w + cw > maxW) break;
    out += ch;
    w += cw;
  }
  if (out.length === text.length) return out;

  // 放不下：给省略号腾位置
  const ell = ctx.measureText('…').width + spacing;
  while (out) {
    const last = Array.from(out).pop()!;
    if (w + ell <= maxW) break;
    out = out.slice(0, out.length - last.length);
    w -= ctx.measureText(last).width + spacing;
  }
  return `${out}…`;
}

/**
 * 一行为目标时的字号：超宽就逐像素缩，缩到 `minSize` 还不够就交给折行。
 *
 * 文案池里最长的一条在 42px 下是放不进 620 的，旧实现直接折行，
 * 把收尾的「」」孤零零甩到第二行 —— 那不是折行，是排版事故。
 */
function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  track: number,
  maxW: number,
  minSize: number,
): number {
  let s = size;
  while (s > minSize && measureLine(ctx, text, s, track * s) > maxW) s -= 1;
  return s;
}

/** 不能出现在行首的标点（中文排版的「避头尾」）。 */
const NO_LINE_START = '」』，。、！？：；）》…';

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

  // 两行时**配平**：把第一行尾部的字搬到第二行，直到再搬会让差距变大。
  //
  // 贪心切出来的两行常常是「14 个字 + 3 个字」——
  // 第二行孤零零「吗？」，看着像排版断了。
  // 为什么要搬字而不是按 `总宽/2` 预先算切点：中文字宽不等
  // （数字、空格窄，「关」宽），按平均值切会在 2 行与 3 行之间横跳。
  if (lines.length === 2) balanceLines(ctx, lines, size, spacing, maxW);

  // 配平可能把标点挪到行首 —— 再把上一个字带下来
  if (lines.length === 2) {
    let head = Array.from(lines[1])[0] ?? '';
    while (NO_LINE_START.includes(head) && Array.from(lines[0]).length > 1) {
      const a = Array.from(lines[0]);
      lines[0] = a.slice(0, -1).join('');
      lines[1] = a[a.length - 1] + lines[1];
      head = Array.from(lines[1])[0] ?? '';
    }
  }

  lines.forEach((ln, i) => {
    tracked(ctx, ln, cx, y + i * lineH, size, spacing);
  });
}

/** 把第一行尾部的字搬到第二行，直到两行宽度差不再变小。 */
function balanceLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  size: number,
  spacing: number,
  maxW: number,
): void {
  const widthOf = (s: string) => measureLine(ctx, s, size, spacing);
  for (;;) {
    const first = Array.from(lines[0]);
    if (first.length <= 1) return;

    const head = first.slice(0, -1).join('');
    const tail = first[first.length - 1] + lines[1];
    // 别把第二行撑破（那样就真成三行了）
    if (widthOf(tail) > maxW) return;
    if (Math.abs(widthOf(head) - widthOf(tail)) >= Math.abs(widthOf(lines[0]) - widthOf(lines[1]))) {
      return;
    }
    lines[0] = head;
    lines[1] = tail;
  }
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

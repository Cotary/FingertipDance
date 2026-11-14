/**
 * 「金缮瓷盘」· 器物轴。
 *
 * ## 为什么是金缮
 *
 * 金缮（kintsugi）是拿金漆修补碎瓷的手艺，它的美学主张是**不掩饰裂痕，
 * 反而把裂缝描成金色**。这和「连连看」是同构的 —— 玩家本来就是在把一条路径连起来，
 * 而这条路径恰恰是「走过的裂」。所以这套主题里，线不是装饰，是**修复本身**。
 *
 * ## 三根骨头（抽掉颜色也成立）
 *
 * 1. **格子是「片」，不是「格」。** 盘面铺一层暗釉（缝底），每片瓷比缝底亮、
 *    内缩留出 3px 的缝。所以画面里**没有一条网格线**，只有一片片瓷。
 *    灰度下看到的是「马赛克」，不是「表格」。
 * 2. **走 = 修。** 走过的片同时变两件事：片里染浓钴（分水），片缝填金（金缮）。
 *    只提亮会退回成换色主题；只描金边会像「选中状态」。
 * 3. **一切靠釉，不靠描边。** 高光、积釉、开片全用低透明度叠色做。
 *    瓷器的边是「釉流过去积起来」的，不是画上去的。
 *
 * ## 色温是这套的命
 *
 * 全theme只有 4 个色相：冷白（瓷）、冷灰（缝）、靛（桌）、金（缮）。
 *
 * **瓷必须是冷白，不能是米黄。** 第一版用了 #F7F1E5 这种暖白，
 * 60 片叠在一起整张图变成「一块牛皮纸板」—— 暖白在大面积重复时
 * 会读成「旧纸」，只有冷白（微微泛青）才读成「釉」。
 * 反过来，金是画面里**唯一**的暖色，所以它一出现就是焦点。
 */
import type { BoardLayout } from '../layout';
import { roundRect } from '../board';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { composeTheme, type CellGeom, type Pt } from './kit';

// ────────────────────────────── 色板 ──────────────────────────────

const K = {
  /** 桌面：深靛丝绒 */
  clothDeep: '#070E16',
  cloth: '#0B1622',
  /** 瓷：冷白 / 缝底冷灰 */
  tile: '#F5F4ED',
  tileTop: '#FCFBF6',
  seam: '#C8CCC2',
  seamDeep: '#B6BBB0',
  /** 钴：勾线的浓、分水的淡、积釉的深 */
  cobalt: '#1E4B6E',
  cobaltDeep: '#0D2A42',
  cobaltWash: 'rgba(44,95,140,0.34)',
  /** 金：缮线 / 边 / 高光 */
  gold: '#A8813A',
  goldLit: '#E9CC8A',
  goldHot: '#FFF6DC',
  /** 胎：露胎的深褐 */
  bisque: '#3B2718',
  bisqueDeep: '#1D1109',
} as const;

const CHROME: ThemeChrome = {
  // 关号胶囊用白瓷底 + 深钴字：它读作「盘子上的一枚款」，不是又一个 UI 块
  pill: '#F0EFE8', pillInk: '#123A5E',
  primary: '#1E4B6E', primaryInk: '#F5F4ED',
  // 次要按钮压到深靛：米黄按钮和盘沿同色，会读成「盘子的延伸」
  ghost: '#132A3E', ghostInk: '#DCC9A0',
  ink: '#F2F1EA', inkSoft: 'rgba(214,216,208,0.72)',
  groove: 'rgba(20,40,60,0.42)', fill: '#D9B25E',
};

/** 稳定伪随机（同一格每帧必须同值，否则釉面会闪）。 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 深靛丝绒 + 盘下的一圈冷光。
 *
 * 背景的任务只有一件：**把视线压在盘上**。所以中间比四周亮一档、四周压到近黑。
 * 那圈光是「桌子被盘面反光照到」—— 没有它，盘会像浮在虚空里的贴图。
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;

  ctx.fillStyle = K.clothDeep;
  ctx.fillRect(x, y, w, h);

  const cx = x + w / 2;
  const cy = y + h * 0.44;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.66);
  glow.addColorStop(0, 'rgba(58,96,136,0.34)');
  glow.addColorStop(0.40, 'rgba(28,54,84,0.18)');
  glow.addColorStop(1, 'rgba(7,14,22,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 丝绒的绒光：七条极淡的斜带。静态图里几乎看不见，
  // 但它是「布」和「纯色背景」的全部区别 —— 一条都没有时会读作「深色底」
  for (let i = 0; i < 7; i++) {
    const bx = x - w * 0.2 + (i + hash(i * 3.3)) * (w * 0.2);
    ctx.beginPath();
    ctx.moveTo(bx, y + h);
    ctx.lineTo(bx + w * 0.24, y);
    ctx.lineTo(bx + w * 0.24 + 26 + hash(i * 7.1) * 40, y);
    ctx.lineTo(bx + 26 + hash(i * 7.1) * 40, y + h);
    ctx.closePath();
    ctx.fillStyle = `rgba(120,168,214,${0.008 + hash(i * 5.7) * 0.012})`;
    ctx.fill();
  }

  // 桌上的金粉：盘外零星几粒，暗示「这里有一只修补过的器」
  for (let i = 0; i < 9; i++) {
    const sx = x + hash(i * 13.1) * w;
    const sy = y + hash(i * 23.7) * h;
    // 盘面范围内不放，否则会压在瓷上
    if (sx > x + w * 0.06 && sx < x + w * 0.94 && sy > y + h * 0.14 && sy < y + h * 0.86) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.9 + hash(i * 31.3) * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(233,204,138,${0.10 + hash(i * 41.9) * 0.16})`;
    ctx.fill();
  }

  ctx.restore();
}

// ────────────────────────────── 瓷盘 ──────────────────────────────

/**
 * 瓷盘：反光 → 投影 → 盘身 → 口沿金线 → 盘沿斜面 → 盘面 → 边饰 → 釉光 → 开片。
 *
 * 五层白，缺任何一层都会塌成「一张白卡片」：
 *
 * | 层 | 亮度 | 它代表什么 |
 * |---|---|---|
 * | 口沿金线 | 金 | 盘的「镶口」，器物的边界 |
 * | 盘身外缘 | 最亮 | 受光的立面 |
 * | 盘沿斜面 | 中 | 从沿到面的过渡（壁的厚度就在这 12px 里） |
 * | 盘面 | 最暗 | **缝底** —— 瓷片之间的暗，全靠这一层的暗衬出来 |
 * | 盘下反光 | 极淡冷白 | 盘把光反射回桌上，盘才「有光」而不是「有边」 |
 *
 * 四角做「委角」：一段 45° 的斜切 + 小圆角。这是明清方盘的做法，
 * 也是「方器」和「卡片」的分界 —— 卡片是圆角矩形，方器是委角方。
 */
function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const pad = Math.max(16, layout.cell * 0.52);
  const x = layout.originX - pad;
  const y = layout.originY - pad;
  const w = layout.boardW + pad * 2;
  const h = layout.boardH + pad * 2;
  const r = Math.max(8, layout.cell * 0.14);
  const cut = Math.max(10, layout.cell * 0.30);

  /** 委角方盘的路径：四角各切一刀，用二次曲线把直边接起来。 */
  const dishPath = (px: number, py: number, pw: number, ph: number, rr: number, cc: number) => {
    const c = Math.min(cc, Math.min(pw, ph) * 0.22);
    const k = rr * 0.55;
    ctx.beginPath();
    ctx.moveTo(px + c, py);
    ctx.lineTo(px + pw - c, py);
    ctx.quadraticCurveTo(px + pw, py, px + pw, py + c);
    ctx.lineTo(px + pw, py + ph - c);
    ctx.quadraticCurveTo(px + pw, py + ph, px + pw - c, py + ph);
    ctx.lineTo(px + c, py + ph);
    ctx.quadraticCurveTo(px, py + ph, px, py + ph - c);
    ctx.lineTo(px, py + c);
    ctx.quadraticCurveTo(px, py, px + c, py);
    ctx.closePath();
    // 用不到 rr，留着是为了以后加「圆中带方」的写法
    void k;
  };

  // ── 盘下的反光：盘把桌面的光反射回去，在盘底晕开一圈冷白。
  //    这一层在桌上、不在盘上，所以画在投影之前
  const refl = ctx.createRadialGradient(
    x + w / 2, y + h * 0.58, Math.min(w, h) * 0.18,
    x + w / 2, y + h * 0.58, Math.max(w, h) * 0.60,
  );
  refl.addColorStop(0, 'rgba(210,224,232,0.15)');
  refl.addColorStop(0.5, 'rgba(150,180,200,0.05)');
  refl.addColorStop(1, 'rgba(150,180,200,0)');
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.64, h * 0.54, 0, 0, Math.PI * 2);
  ctx.fillStyle = refl;
  ctx.fill();

  // ── 投影：三层，越远越淡。单层投影会让盘像贴纸
  for (const [dy, spread, a] of [[22, 12, 0.30], [10, 5, 0.32], [3, 0, 0.28]] as const) {
    dishPath(x - spread, y + dy - spread * 0.4, w + spread * 2, h + spread * 1.4, r + spread, cut);
    ctx.fillStyle = `rgba(3,7,12,${a})`;
    ctx.fill();
  }

  // ── 盘身（外立面）：左上最亮、右下最暗，这是「一只方器」的体积
  const rimG = ctx.createLinearGradient(x, y, x + w * 0.45, y + h);
  rimG.addColorStop(0, '#FEFDFA');
  rimG.addColorStop(0.34, '#F6F7EF');
  rimG.addColorStop(0.70, '#E6E7DC');
  rimG.addColorStop(1, '#D3D5C8');
  dishPath(x, y, w, h, r, cut);
  ctx.fillStyle = rimG;
  ctx.fill();

  // ── 口沿金线：描金口。1.4px、alpha 0.42 —— 再重就成土豪金了
  dishPath(x + 1.8, y + 1.8, w - 3.6, h - 3.6, r, cut);
  ctx.strokeStyle = 'rgba(168,129,58,0.42)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 口沿的釉光：沿上缘一条窄亮线（釉在立面顶部流得薄，反光最强）
  ctx.beginPath();
  ctx.moveTo(x + cut, y + 2.8);
  ctx.lineTo(x + w - cut, y + 2.8);
  ctx.strokeStyle = 'rgba(255,254,250,0.85)';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // ── 盘沿斜面：用一条很宽的深色描边做「内阴影」。
  //    从外缘往内 12px 由暗转亮，盘壁的厚度就出来了
  const slope = Math.max(9, pad * 0.42);
  ctx.save();
  ctx.beginPath();
  dishPath(x + slope * 0.5, y + slope * 0.5, w - slope, h - slope, r, cut - slope * 0.4);
  ctx.strokeStyle = 'rgba(104,100,80,0.20)';
  ctx.lineWidth = slope;
  ctx.stroke();
  ctx.restore();

  // ── 盘面（缝底）：比盘沿暗一档。**这一层的暗是整套主题的地基** ——
  //    瓷片之所以能读成「一片片」，全靠缝底比片暗
  const inPad = Math.max(9, layout.cell * 0.22);
  const ix = x + inPad;
  const iy = y + inPad;
  const iw = w - inPad * 2;
  const ih = h - inPad * 2;

  const faceG = ctx.createLinearGradient(ix, iy, ix + iw * 0.5, iy + ih);
  // 盘面是「暖灰」，瓷片是「冷白」—— 冷白压在暖灰上才读得出「瓷浮在釉上」。
  // 反过来（冷灰底 + 冷白片）整盘会读成「灰色网格 + 白方块」，退回网格感
  faceG.addColorStop(0, '#E7E5D8');
  faceG.addColorStop(0.42, '#DAD8C9');
  faceG.addColorStop(1, '#C9C8B7');
  dishPath(ix, iy, iw, ih, r * 0.6, cut * 0.7);
  ctx.fillStyle = faceG;
  ctx.fill();

  // 盘面内缘的积釉：宽 stroke 做一圈柔和的暗 ——
  // 真实的瓷盘，釉在靠近盘壁的地方最厚、颜色最深，这一圈是「盘底凹陷」的来源
  ctx.save();
  ctx.beginPath();
  dishPath(ix, iy, iw, ih, r * 0.6, cut * 0.7);
  ctx.clip();
  ctx.beginPath();
  dishPath(ix + 9, iy + 9, iw - 18, ih - 18, r * 0.6, cut * 0.6);
  ctx.strokeStyle = 'rgba(92,90,72,0.13)';
  ctx.lineWidth = 20;
  ctx.stroke();
  ctx.restore();

  // 盘沿与盘面的转折：暗线 + 内侧亮线（釉积在转折处，转折处的釉最厚、最亮）
  dishPath(ix, iy, iw, ih, r * 0.6, cut * 0.7);
  ctx.strokeStyle = 'rgba(104,100,78,0.28)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  dishPath(ix + 1.6, iy + 1.6, iw - 3.2, ih - 3.2, r * 0.6, cut * 0.65);
  ctx.strokeStyle = 'rgba(255,254,248,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 盘沿外侧一道钴线，给回纹带「框」住
  dishPath(x + 4, y + 4, w - 8, h - 8, r, cut - 4);
  ctx.strokeStyle = 'rgba(30,75,110,0.34)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // ── 盘沿的回纹带：一圈连续的「雷纹」。
  //
  // 这是青花盘最典型的边饰，也是这套主题里**唯一一处「密」**。
  // 盘心必须疏、盘沿必须密 —— 画面才有「一只盘」的构图，而不是「一张网格」。
  // 密度全均匀的东西看起来一定是「程序生成的」。
  //
  // 只画上下两条边：左右盘沿宽 33px，竖排回纹会挤成一团墨点；
  // 上下长边才画得开，也正好形成「边密、侧疏」的不对称。
  const bandH = Math.min(21, pad * 0.60);
  const step = bandH * 1.16;
  const bInset = Math.max(7, inPad * 0.56);
  if (bandH > 10) {
    ctx.strokeStyle = 'rgba(26,68,102,0.62)';
    ctx.lineWidth = Math.max(1.5, bandH * 0.082);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    /** 一个回纹单元：一个「已」字形的方折。朝下是默认方向。 */
    const unit = (ux: number, uy: number, flip: boolean) => {
      ctx.save();
      ctx.translate(ux, uy);
      if (flip) ctx.scale(1, -1);
      ctx.beginPath();
      ctx.moveTo(0, bandH);
      ctx.lineTo(0, 0);
      ctx.lineTo(bandH * 0.76, 0);
      ctx.lineTo(bandH * 0.76, bandH * 0.60);
      ctx.lineTo(bandH * 0.32, bandH * 0.60);
      ctx.lineTo(bandH * 0.32, bandH * 0.30);
      ctx.stroke();
      ctx.restore();
    };

    for (let px = x + cut * 0.8; px + step < x + w - cut * 0.8; px += step) {
      unit(px, y + bInset, false);
      // 下边镜像：盘沿的上下纹样要对称，否则整盘会「歪」
      unit(px, y + h - bInset, true);
    }
  }

  // ── 釉光：左上一个大高光 + 右下一条极淡的反光（瓷器的「水头」）
  const hx = ix + iw * 0.24;
  const hy = iy + ih * 0.12;
  const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(iw, ih) * 0.48);
  hl.addColorStop(0, 'rgba(255,255,253,0.42)');
  hl.addColorStop(0.42, 'rgba(255,254,248,0.12)');
  hl.addColorStop(1, 'rgba(255,254,248,0)');
  dishPath(ix, iy, iw, ih, r * 0.6, cut * 0.7);
  ctx.fillStyle = hl;
  ctx.fill();

  ctx.save();
  dishPath(ix, iy, iw, ih, r * 0.6, cut * 0.7);
  ctx.clip();
  // 开片：釉在冷却时裂出的网。只在盘面空白处，极淡 ——
  // 它存在的意义是「近看有东西」，不是「远看有花纹」
  ctx.strokeStyle = 'rgba(96,96,78,0.12)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 18; i++) {
    let px = ix + hash(i * 17.3) * iw;
    let py = iy + hash(i * 29.1) * ih;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const seg = 2 + Math.floor(hash(i * 5.1) * 3);
    let a = hash(i * 11.7) * Math.PI * 2;
    for (let j = 0; j < seg; j++) {
      a += (hash(i * 7.9 + j) - 0.5) * 1.5;
      px += Math.cos(a) * iw * 0.05;
      py += Math.sin(a) * ih * 0.04;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();

  // ── 方向光：整个盘右下角压一档暖灰。
  //
  // 画在最后、盖住所有层（包括回纹和口沿）—— 真实的阴影不会「绕开」花纹。
  // alpha 只 0.13：再多盘就脏，再少就还是「一张均匀的纸」。
  // 这一层是「平面」和「有光的东西」之间差的最后那一口气。
  const shade = ctx.createLinearGradient(x + w * 0.30, y + h * 0.22, x + w, y + h);
  shade.addColorStop(0, 'rgba(92,88,68,0)');
  shade.addColorStop(0.55, 'rgba(92,88,68,0.05)');
  shade.addColorStop(1, 'rgba(92,88,68,0.14)');
  dishPath(x, y, w, h, r, cut);
  ctx.fillStyle = shade;
  ctx.fill();

  // ── 窗影：一道斜射进来的光，从左上方切到盘心。
  //
  // 它不照亮任何东西，只是「告诉眼睛这里有一扇窗」。
  // 少了这一笔，盘是「被均匀照亮的板」；有了它，盘是「放在房间里的器」。
  ctx.save();
  dishPath(x, y, w, h, r, cut);
  ctx.clip();
  const ray = ctx.createLinearGradient(x, y, x + w * 0.8, y + h * 0.95);
  ray.addColorStop(0, 'rgba(255,255,255,0.13)');
  ray.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  ray.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.moveTo(x - w * 0.05, y + h * 0.02);
  ctx.lineTo(x + w * 0.40, y - h * 0.04);
  ctx.lineTo(x + w * 0.78, y + h * 1.02);
  ctx.lineTo(x + w * 0.26, y + h * 1.02);
  ctx.closePath();
  ctx.fillStyle = ray;
  ctx.fill();
  ctx.restore();
}

// ────────────────────────────── 格 ──────────────────────────────

/**
 * 一片瓷：片 → 积釉 → 水头 → 倒角 →（走过时）分水 + 金缮。
 *
 * ## 为什么每片都要「积釉」
 *
 * 第一版只在走过的片上画积釉，未走的片是一片纯白 —— 整块盘就读成
 * 「白底上画了格子」，还是网格。瓷片真正的辨识点是**边缘比心深**：
 * 釉在烧制时往边上流，所以每片的四缘都有一圈更深的釉。
 * 这一圈只 alpha 0.07，但 70 片叠起来，整盘就有了「一片片」的颗粒感。
 *
 * `shade` 是这一片自己的明度偏移。差值必须小（±7/255 以内）：
 * 再大就像「有坏点」，再小就完全均质。
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  r: number,
  shade: number,
  walk: boolean,
  gx: number,
  gy: number,
): void {
  // ── 片：冷白（R 略高于 G/B，模拟釉里那一点点青）
  ctx.beginPath();
  roundRect(ctx, x, y, s, s, r);
  const base = 243 + shade;
  ctx.fillStyle = `rgb(${Math.round(base + 2)},${Math.round(base)},${Math.round(base - 6)})`;
  ctx.fill();

  // ── 积釉：内缘一圈深色。宽 s*0.09 —— 再宽片就变成「有黑边的方块」
  const poolW = Math.max(1.6, s * 0.09);
  ctx.beginPath();
  roundRect(ctx, x + poolW / 2, y + poolW / 2, s - poolW, s - poolW, Math.max(2, r - poolW / 2));
  ctx.strokeStyle = 'rgba(96,104,92,0.075)';
  ctx.lineWidth = poolW;
  ctx.stroke();

  // ── 水头：左上角一小块极淡的反光，每片的强弱按 hash 抖动。
  //    这一笔是「釉」和「白纸」的唯一区别
  const spec = 0.12 + hash(gx * 13.1 + gy * 7.7) * 0.14;
  ctx.beginPath();
  roundRect(ctx, x + s * 0.10, y + s * 0.07, s * 0.44, s * 0.30, r * 0.8);
  ctx.fillStyle = `rgba(255,255,253,${spec})`;
  ctx.fill();

  if (walk) {
    // 分水：浓钴从左上漫进去、右下留一点白 —— 这是「染」不是「刷」。
    // 0.13 那档实测在白瓷上几乎看不见，压到 0.34 才读得出「青花」
    const wg = ctx.createLinearGradient(x, y, x + s, y + s);
    wg.addColorStop(0, 'rgba(36,84,128,0.40)');
    wg.addColorStop(0.55, 'rgba(36,84,128,0.30)');
    wg.addColorStop(1, 'rgba(36,84,128,0.18)');
    ctx.beginPath();
    roundRect(ctx, x, y, s, s, r);
    ctx.fillStyle = wg;
    ctx.fill();

    // 积釉加深：染过的片区，边上那圈釉更浓
    ctx.beginPath();
    roundRect(ctx, x + poolW * 0.9, y + poolW * 0.9, s - poolW * 1.8, s - poolW * 1.8, Math.max(2, r - poolW * 0.6));
    ctx.strokeStyle = 'rgba(13,42,66,0.26)';
    ctx.lineWidth = poolW * 0.9;
    ctx.stroke();

    // 金缮：片缝描金。四条边都描 —— 走过的片是「被修好的」，边界必须完整；
    // 未走的片一条都不描，两者才有「修过 / 没修过」的对比。
    // 线宽跟着缝走（s*0.034 ≈ 2px）：比缝粗一倍，金才像「填进去又高出来一点」
    ctx.beginPath();
    roundRect(ctx, x, y, s, s, r);
    ctx.strokeStyle = 'rgba(168,129,58,0.90)';
    ctx.lineWidth = Math.max(1.4, s * 0.034);
    ctx.stroke();

    // 金在缝里会溢出来一点：一颗小金点，位置固定
    if (hash(gx * 31.7 + gy * 17.3) > 0.44) {
      const ex = x + s * (0.18 + hash(gx * 3.1) * 0.64);
      const ey = y + s * (0.18 + hash(gy * 5.3) * 0.64);
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(1, s * 0.030), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(233,204,138,0.55)';
      ctx.fill();
    }
  }

  // ── 倒角：左上受光、右下背光。宽度只 1px，但一片片叠起来就是「瓷有厚度」
  ctx.beginPath();
  ctx.moveTo(x + r * 0.6, y + 1.1);
  ctx.lineTo(x + s - r * 0.6, y + 1.1);
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + r * 0.6, y + s - 1.1);
  ctx.lineTo(x + s - r * 0.6, y + s - 1.1);
  ctx.strokeStyle = 'rgba(112,118,104,0.22)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

/** 露胎：碎掉的瓷，露出深褐的胎土，边缘一圈金缮。 */
function drawBisque(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  idx: number,
): void {
  const r = s * 0.46;
  // 不规则边缘：十个顶点各带一点抖动，读作「碎口」而不是「方块」
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = r * (0.86 + hash(idx * 3.1 + i * 1.7) * 0.18);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }

  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  g.addColorStop(0, '#4A3220');
  g.addColorStop(0.45, '#2A1B10');
  g.addColorStop(1, '#0B0603');
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // 碎口的釉层：断口上还留着一点白釉，就在边缘内侧一圈
  ctx.strokeStyle = 'rgba(245,244,237,0.34)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 金缮：这块是被金漆粘住的
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(168,129,58,0.62)';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // 胎土上的两道裂纹
  ctx.strokeStyle = 'rgba(12,7,3,0.60)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy - r * 0.12);
  ctx.lineTo(cx + r * 0.05, cy + r * 0.18);
  ctx.lineTo(cx + r * 0.44, cy - r * 0.06);
  ctx.stroke();
}

/** 哥窑开片：白瓷底 + 金丝铁线。ICE 格用它 —— 「冰裂」和「瓷器开片」是同一件事。 */
function drawCrackle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  idx: number,
): void {
  const r = s * 0.46;

  ctx.beginPath();
  roundRect(ctx, cx - r, cy - r, r * 2, r * 2, s * 0.10);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, '#FEFDF8');
  g.addColorStop(1, '#E4E5DA');
  ctx.fillStyle = g;
  ctx.fill();

  // 铁线：粗、黑褐，从中心向外放射
  ctx.strokeStyle = 'rgba(52,38,22,0.46)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 5; i++) {
    let a = (i / 5) * Math.PI * 2 + hash(idx * 7.7) * 1.2;
    let px = cx;
    let py = cy;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let j = 0; j < 2; j++) {
      a += (hash(idx * 3.1 + i * 5.3 + j) - 0.5) * 1.1;
      px += Math.cos(a) * r * 0.5;
      py += Math.sin(a) * r * 0.5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 金丝：细、淡金，横向的短裂
  ctx.strokeStyle = 'rgba(190,154,80,0.46)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const sy = cy - r * 0.6 + hash(idx * 5.1 + i * 2.9) * r * 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - r * (0.2 + hash(i * 3.3) * 0.5), sy);
    ctx.lineTo(cx + r * (0.15 + hash(i * 7.1) * 0.55), sy + (hash(i * 11.3) - 0.5) * r * 0.3);
    ctx.stroke();
  }

  // 片缝也描金：开片格是「裂得最厉害、修得最彻底」的那一片
  ctx.beginPath();
  roundRect(ctx, cx - r, cy - r, r * 2, r * 2, s * 0.10);
  ctx.strokeStyle = 'rgba(168,129,58,0.68)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, x, y, walk, type, gx, gy, idx } = g;
  const cx = x + cell / 2;
  const cy = y + cell / 2;

  if (type === CoverCell.BLOCK) {
    drawBisque(ctx, cx, cy, cell, idx);
    return;
  }
  if (type === CoverCell.ICE) {
    drawCrackle(ctx, cx, cy, cell, idx);
    return;
  }

  // 缝宽：cell*0.030 在 64px 格上是 1.9px。
  //
  // 上一版用 0.048（3.1px），缝太宽 —— 整盘读成「灰底上摆着一堆白瓷片」，
  // 又回到了网格感。真实的瓷片镶嵌，缝**细如发丝**，靠「细」分格而不是靠「宽」。
  // 1.9px 在 DPR 2 上是 4 个物理像素，细但清楚。
  const inset = cell * 0.030;
  const s = cell - inset * 2;
  const r = Math.max(2.5, cell * 0.070);
  // 明度偏移：大部分片贴在 0 附近，少数明显偏暗。
  // 均匀分布（±7）会让整盘像「随机噪点」，这个二次曲线才是「同窑不同片」
  const t = hash(gx * 37.9 + gy * 21.3) - 0.5;
  const shade = (t < 0 ? -1 : 1) * Math.pow(Math.abs(t) * 2, 2) * 7;
  drawTile(ctx, x + inset, y + inset, s, r, shade, walk, gx, gy);
}

// ────────────────────────────── 线 ──────────────────────────────

function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[], width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * 金缮线：晕 → 金体 → 金亮 → 高光 → 漆点。
 *
 * 四遍是必须的。只画一遍金色 = 一根黄线（像「选中的路径」）；
 * 三遍以上才有「漆堆起来的厚度」。
 */
function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number): void {
  if (pts.length < 2) return;

  strokePath(ctx, pts, cell * 0.34, 'rgba(233,204,138,0.08)');
  strokePath(ctx, pts, cell * 0.19, 'rgba(233,204,138,0.17)');
  strokePath(ctx, pts, cell * 0.115, K.gold);
  strokePath(ctx, pts, cell * 0.055, K.goldLit);

  // 高光：整条线往上偏 0.6px —— 光从左上打来，金漆的脊在偏上那侧
  ctx.save();
  ctx.translate(0, -Math.max(0.6, cell * 0.012));
  strokePath(ctx, pts, Math.max(1.2, cell * 0.022), 'rgba(255,248,226,0.70)');
  ctx.restore();

  // 漆点：金漆在拐弯处会积一点。位置固定（不能每帧随机，否则会爬）
  for (let i = 1; i < pts.length - 1; i++) {
    if (hash(i * 7.3) < 0.42) continue;
    const p = pts[i];
    const off = (hash(i * 13.9) - 0.5) * cell * 0.16;
    ctx.beginPath();
    ctx.arc(p.x + off, p.y - cell * 0.06, Math.max(0.8, cell * 0.020), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,246,214,0.48)';
    ctx.fill();
  }

  // 起点那一滴：金漆从裂缝的头上滴下来，会积成一小滩
  const head = pts[0];
  const pulse = 0.72 + 0.28 * Math.sin(now / 620);
  ctx.beginPath();
  ctx.arc(head.x, head.y, cell * 0.075, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,246,222,${0.42 * pulse})`;
  ctx.fill();
}

// ────────────────────────────── 端点 ──────────────────────────────

export const KINTSUGI_THEME = composeTheme({
  id: 'kintsugi',
  name: '金缮瓷盘',
  tagline: '一条裂缝，被描成了金色',
  unlock: { type: 'milestone', value: 300 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(233,204,138,0.22)', core: K.goldLit, hot: K.goldHot },
    hintColor: K.gold,

    glyph: {
      style: 'porcelain',
      // 青花只有两档钴：勾线的浓、分水的淡。第三档一加就脏。
      // 淡的那档压到 0.58 —— 0.38 在白瓷上几乎看不见，图标会读成「空心线稿」
      pal: {
        ink: K.cobaltDeep,
        accent: 'rgba(38,86,130,0.74)',
        chip: K.tileTop,
        deep: K.cobaltDeep,
      },
      // 小瓷章：钥匙/传送门的编号要有底，白瓷底上压白字读不出来
      back: 'rgba(247,246,239,0.96)',
      backEdge: 'rgba(13,42,66,0.40)',
      backR: 0.245,
      // 白瓷底上 0.50 的图标会漂在大片留白里，推到 0.66
      scale: 0.66,
    },

    hint(ctx, p, cell, i) {
      const inset = cell * 0.11;
      ctx.save();
      ctx.setLineDash(i === 0 ? [] : [cell * 0.14, cell * 0.10]);
      ctx.beginPath();
      roundRect(ctx, p.x - cell / 2 + inset, p.y - cell / 2 + inset, cell - inset * 2, cell - inset * 2, cell * 0.14);
      ctx.strokeStyle = K.gold;
      ctx.lineWidth = i === 0 ? Math.max(2.6, cell * 0.062) : Math.max(1.6, cell * 0.038);
      ctx.stroke();
      ctx.restore();
    },

    head(ctx, p, cell, now) {
      const r = cell * 0.10;
      const pulse = 0.78 + 0.22 * Math.sin(now / 300);
      // 金珠的光
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
      g.addColorStop(0, `rgba(255,246,222,${0.46 * pulse})`);
      g.addColorStop(0.45, `rgba(233,204,138,${0.18 * pulse})`);
      g.addColorStop(1, 'rgba(233,204,138,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // 金珠本体：亮面在左上，暗面在右下
      const bg = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      bg.addColorStop(0, K.goldHot);
      bg.addColorStop(0.65, K.goldLit);
      bg.addColorStop(1, K.gold);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
    },

    endpoint(ctx, kind, p, cell) {
      const r = cell * 0.32;
      if (kind === 'start') {
        // 底款：双圈 + 一朵五瓣花。盘底才有的东西，放在起点正好是「这只盘的签名」。
        //
        // 试过把这里做成朱红小印（全画面唯一一点红），最后撤掉了 ——
        // 青花本身就是蓝白两色，「青花釉里红」是另一个门类。
        // 硬加一点红，画面会从「雅」掉到「民俗」，而且 20px 的红圆在浅底上
        // 读起来更像「报错」而不是「款」。
        const ring = 'rgba(26,68,102,';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = ring + '0.70)';
        ctx.lineWidth = Math.max(2, cell * 0.038);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.74, 0, Math.PI * 2);
        ctx.strokeStyle = ring + '0.42)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 五瓣花：五个小椭圆绕一圈 + 花心一点金
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          const px = p.x + Math.cos(a) * r * 0.36;
          const py = p.y + Math.sin(a) * r * 0.36;
          ctx.beginPath();
          ctx.ellipse(px, py, r * 0.20, r * 0.16, a, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(38,86,130,0.30)';
          ctx.fill();
          ctx.strokeStyle = ring + '0.56)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168,129,58,0.90)';
        ctx.fill();
      } else {
        // 终：一朵缠枝莲。八瓣外圈 + 内圈 + 花心一点金，青花最典型的纹样
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const px = p.x + Math.cos(a) * r * 0.62;
          const py = p.y + Math.sin(a) * r * 0.62;
          ctx.beginPath();
          ctx.ellipse(px, py, r * 0.34, r * 0.20, a, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(44,95,140,0.30)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(13,42,66,0.64)';
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.30, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(247,246,239,0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(13,42,66,0.66)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168,129,58,0.92)';
        ctx.fill();
      }
    },
  },
});

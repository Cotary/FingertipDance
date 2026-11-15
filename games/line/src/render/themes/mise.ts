/**
 * 「秘色·天青」· 釉面轴（主题矩阵 01 · 默认旗舰）。
 *
 * ## 为什么是秘色
 *
 * 原型是宋瓷汝窑（"雨过天青云破处"）——中国文化语境里最高级的质感符号。
 * 隐喻是**博物馆展柜**：墨石暗面上摆着刚出窑的青瓷棋子，
 * 玩家连出的路径是全屏唯一发光的东西——一条**鎏金缮线**。
 *
 * ## 三根骨头（抽掉颜色也成立）
 *
 * 1. **釉面三层，不多不少。** 每颗棋子只有：釉面渐变 → 扫光高光 → 冰裂细纹。
 *    多一层就脏，质感是减法。灰度下看到的是「一片片有弧面的釉」，
 *    不是「网格里的色块」。
 * 2. **一器一光。** 全画面只有一个光源：左上 35°。釉面高光、投影（右下 12°）、
 *    盘沿明暗全部服从它。统一光源是真实感和平面感的分水岭。
 * 3. **金贵如缮。** 金色覆盖 ≤8%：只给路径和端点的款。金缮的价值在"少而准"——
 *    金线一出现就是焦点，满盘都是金就什么都不算了。
 *
 * ## 和「金缮瓷盘」的分界
 *
 * kintsugi 是「冷白瓷片 + 碎缝填金」（器物轴：裂→修）；
 * mise 是「青釉棋子 + 金缮光迹」（釉面轴：暗展柜里的一条光路）。
 * 灰度下也分得开：kintsugi 是白面马赛克，mise 是暗底上的浮雕釉块。
 */
import { BOARD_GAP, cardOf, type BoardLayout } from '../layout';
import { roundRect } from '../board';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { fillGrain } from '../grain';
import type { GlyphPalette } from './glyphs';
import { composeTheme, type CellGeom, type Pt } from './kit';

// ────────────────────────────── 色板 ──────────────────────────────

const K = {
  /** 页面底色（设计稿游戏内 = 平涂墨玉） */
  page: '#0E1815',
  /** 墨石：展柜暗面（背景 / 底板） */
  stoneDeep: '#080D0B',
  stone: '#0E1713',
  stoneLit: '#1B2C24',
  /** 青釉：未铺（浅）/ 已铺（深）/ 影 */
  glazePale: '#DCE7DC',
  glazePaleTop: '#EDF3EA',
  glazePaleFoot: '#B7CBBB',
  glazeDeep: '#4F7A66',
  glazeDeepTop: '#6E9E82',
  glazeDeepFoot: '#2D5245',
  glazePool: 'rgba(38,74,58,0.26)',
  /** 鎏金：缮线 / 款 / 高光 */
  gold: '#B89045',
  goldLit: '#F2DCA8',
  goldHot: '#FFF6DC',
  goldDeep: '#8A6B3C',
  /** 朱砂：唯一的红，只给终点头款 */
  seal: '#C04B33',
  sealDeep: '#8E3424',
  /** 冰：更亮、更透（占「亮」的生态位） */
  ice: '#C2DAD6',
  iceLit: '#EAF5F2',
  iceDeep: '#7FA8A0',
  /** 墨：刻线 / 描边 */
  inkLine: '#1D332A',
} as const;

const CHROME: ThemeChrome = {
  // 关号胶囊：墨石底 + 纸色字——展柜里的一枚标签，不是又一个 UI 块
  pill: '#16241D', pillInk: '#EDE7DA',
  // 主按钮是全 UI 唯一的金（与盘面光迹同源）
  primary: '#C9A227', primaryInk: '#2A2114',
  ghost: '#22382E', ghostInk: '#C5BFAF',
  ink: '#EDE7DA', inkSoft: 'rgba(197,191,175,0.72)',
  // 微文案另给一档：#7A7468 就是设计稿的 --i500。
  // 底注 / 图例名用 inkSoft 会亮到和读数抢眼 —— 那两行是"注"，该退到背景里
  inkDim: '#7A7468',
  groove: 'rgba(10,18,14,0.55)', fill: '#D4AF6A',
};

/** 暗格上的款：浅釉线 + 金 */
const LIGHT_PAL: GlyphPalette = {
  // 米白要带一点暖：设计稿的款是 `rgba(255,240,210,.85)`（不是纯白）。
  // 纯白在暖金 + 墨绿里是唯一的"冷点"，整盘会显得有点凉
  ink: 'rgba(255,240,210,0.85)',
  accent: '#F2DCA8',
  chip: '#F2EEE6',
  deep: 'rgba(12,22,18,0.86)',
};
/** 石面上的款：只比石面亮一点点的刻痕 */
const STONE_PAL: GlyphPalette = {
  ink: 'rgba(150,178,162,0.26)',
  accent: 'rgba(120,150,134,0.22)',
  chip: 'rgba(255,255,255,0.06)',
  deep: 'rgba(0,0,0,0.4)',
};

/**
 * 亮格（冰面）上的款：墨青线。
 *
 * 只给**霜青**用 —— 冰面是唯一一块偏冷的浅底。
 */
const DARK_PAL: GlyphPalette = {
  ink: 'rgba(20,50,45,0.72)',
  accent: '#2A2114',
  chip: '#F2EEE6',
  deep: '#2A2114',
};

/**
 * 金 / 铜面上的款：暖褐刻痕。
 *
 * 设计稿在鎏金格上刻的是 `#4A3510`（星）、`#2A2114`（钥匙）—— **暖褐**。
 * 早先图省事把它和冰面共用一套"墨绿"，金格上就出现一颗发绿的星，
 * 像贴了张塑料贴纸：深色本身没错，错在它是冷色。
 */
const BROWN_PAL: GlyphPalette = {
  ink: '#4A3510',
  accent: '#2A2114',
  chip: '#7A5E2C',
  deep: '#3A2A0E',
};

/** 稳定伪随机（同一格每帧必须同值，否则釉面会闪）。 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ────────────────────────────── 背景 ──────────────────────────────

/**
 * 展柜底板：设计稿的游戏内底色是**一张平涂的墨玉**（#0E1815）。
 *
 * 没有渐变、没有光斑、没有颗粒。以前这里有一束「展柜灯」+ 60 粒石屑，
 * 但把设计稿的 03 屏放大到 1:1 就能看到：页面是纯色，所有纵深都由
 * **卡片自己**给（卡比页亮一档 + 内影 + 金线）。页面一花，卡片就退成一块贴图。
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  ctx.fillStyle = K.page;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

// ────────────────────────────── 展柜卡片 ──────────────────────────────

/**
 * 棋盘卡片（展柜）。
 *
 * 结构照设计稿的 `.board-well` 一层层落：
 * 外投影 → 卡体（175° 压暗）→ 顶部青光 → 上/下内影 → 冷青卡沿 → 内缩金线 → 颗粒。
 *
 * 为什么卡片不能比页面亮太多：青瓷棋子本身已经很暗（未铺是深釉），
 * 卡片一亮，棋子就变成「贴在亮板上的暗块」；卡片只比页面亮 **两档**、
 * 靠内影把自己压成「凹进去的柜子」，棋子才像**摆在里面**。
 */
function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const card = cardOf(layout);
  const { x, y, w, h } = card;
  const r = 36;

  // ── 外投影：设计稿 0 40px 90px rgba(0,0,0,.55)。
  //    canvas 只用一次模糊：投影落在平涂页面上，太实像贴纸、太虚会浮起来
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.62)';
  ctx.shadowBlur = 64;
  ctx.shadowOffsetY = 20;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = '#101B16';
  ctx.fill();
  ctx.restore();

  // ── 卡体：设计稿 `linear-gradient(158deg, #16241E, #0F1915 60%, #16241E)`
  //
  // 注意**首尾同色**：卡片四边一样亮、中间最暗，读起来才是一个"凹陷的展柜"。
  // 老版把末段压到 #0C1512（比页面 #0E1815 还黑），卡片下半截直接化进背景，
  // 只剩上沿一条边 —— 于是整块盘看起来"没有底"。
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, r);
  const body = ctx.createLinearGradient(x, y, x + w * 0.375, y + h * 0.927);
  body.addColorStop(0, '#16241E');
  body.addColorStop(0.60, '#0F1915');
  body.addColorStop(1, '#16241E');
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  ctx.clip(); // 卡片路径还挂在 ctx 上

  // ── 内影：设计稿 `inset 0 3px 18px rgba(0,0,0,.55)` +
  //    `inset 0 -8px 20px rgba(0,0,0,.35)`。18/20 的模糊半径落到 2 倍图上
  //    是 36/40 —— 第一版写 48/56 且底部给到 .45，卡片上下各黑掉一条宽带，
  //    盘面等于是沉在一个坑里。
  const topIn = ctx.createLinearGradient(0, y, 0, y + 42);
  topIn.addColorStop(0, 'rgba(0,0,0,0.55)');
  topIn.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topIn;
  ctx.fillRect(x, y, w, 42);
  const botIn = ctx.createLinearGradient(0, y + h - 56, 0, y + h);
  botIn.addColorStop(0, 'rgba(0,0,0,0)');
  botIn.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = botIn;
  ctx.fillRect(x, y + h - 56, w, 56);
  ctx.restore();

  // ── 卡沿：冷青 1px（设计稿 border rgba(147,179,162,.1)）。
  //    卡片和页面只差 1~2 个色阶，全靠这根发丝分出"里 / 外"
  ctx.beginPath();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = 'rgba(147,179,162,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── 石面颗粒：5.5%。它是「石头」和「纯色渐变」的全部区别
  fillGrain(ctx, x, y, w, h, 0.055);
}

// ────────────────────────────── 格 ──────────────────────────────

/**
 * 一格釉的六种面色。
 *
 * 从设计稿的 `.pc` 系（03 屏）搬来：每个面色都是
 * `radial-gradient(120% 110% at 30% 22%, 亮, 中 48%, 暗)` ——
 * 圆心偏左上，所以整片读起来是**一个朝左上的穹顶**，不是一块平色。
 *
 * 亮／暗两态：
 * - 未铺 `pale`：暗一档、再压 0.82 透明度（釉还没被点过，是"生"的）
 * - 已铺 `lit`：亮一档（点过之后像被灯照到）
 *
 * 这个方向是设计稿定的（`.pc` = 已铺 / `.pc.pale` = 未铺）。
 * 反过来的话，满盘开局就是一片亮绿，金色光迹就没地方发光了。
 */
const TINT = {
  pale: ['#2E4740', '#22362F', '#1B2B25'],
  lit: ['#4D7A74', '#35574F', '#26423C'],
  dark: ['#3A4A52', '#26333B', '#1B252C'],
  violet: ['#7C70B8', '#5C5192', '#443A72'],
  frost: ['#9FC4BC', '#7FA8A0', '#628A82'],
  star: ['#D9B86A', '#B89045', '#8A6B3C'],
  key: ['#C8A45E', '#A07E3C', '#7A5E2C'],
} as const;

type Tint = readonly [string, string, string];

/**
 * 一片釉：投影 → 穹顶 → 扫光 → 冰裂 → 倒角。
 *
 * 投影不用 `ctx.shadowBlur`：64 片 × 每帧一次高斯模糊在低端机上直接掉帧。
 * 这里用「下移一个圆角矩形 + 内部竖向渐变」——只在棋子下沿露一道暗边，
 * 和设计稿 `0 3px 7px rgba(0,0,0,.4)` 的观感一致，代价接近零。
 */
function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  r: number,
  tint: Tint,
  seed: number,
  alpha = 1,
): void {
  // ── 投影
  const dy = s * 0.085;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y + dy, s, s, r);
  ctx.clip();
  const sh = ctx.createLinearGradient(0, y + dy, 0, y + dy + s * 0.5);
  sh.addColorStop(0, `rgba(0,0,0,${0.38 * alpha})`);
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x, y + dy, s, s * 0.5);
  ctx.restore();

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;

  // ── 穹顶
  const gcx = x + s * 0.30;
  const gcy = y + s * 0.22;
  const dome = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, s * 1.15);
  dome.addColorStop(0, tint[0]);
  dome.addColorStop(0.48, tint[1]);
  dome.addColorStop(1, tint[2]);
  ctx.beginPath();
  roundRect(ctx, x, y, s, s, r);
  ctx.fillStyle = dome;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, Math.max(1, r - 0.5));
  ctx.clip();

  // ── 高光：设计稿 `.pc .glint` 是**一枚椭圆**（宽 52% / 高 28%，
  //    落在 12% / 8% 的位置、再 blur 2.5px），不是一层通铺白晕。
  //
  //    通铺白晕会把每颗棋子推成一颗玻璃糖（第一版就是这样，整盘像果冻）；
  //    椭圆才是"一滴釉上凝的光" —— 有形状、有边、照在同一个方向。
  //    亮心要压在 **10% 高**（椭圆上沿），不是椭圆的几何中心：
  //    中心偏下会让最亮处落在 y≈16%，和设计稿比就"光掉了一格"
  ctx.save();
  ctx.translate(x + s * 0.38, y + s * 0.22);
  ctx.scale(1, 0.54);
  const glint = ctx.createRadialGradient(0, -s * 0.20, 0, 0, -s * 0.20, s * 0.32);
  glint.addColorStop(0, `rgba(255,255,255,${0.48 * alpha})`);
  glint.addColorStop(0.5, `rgba(255,255,255,${0.16 * alpha})`);
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = glint;
  ctx.fill();
  ctx.restore();

  // ── 冰裂：两根细纹，暗线 + 错位亮线（真实的裂缝两侧一明一暗）。
  //    存在的意义是"近看有东西"，不是远看有花纹 —— 所以只给 0.5px 级的线
  const cw = Math.max(0.6, s * 0.011);
  for (let i = 0; i < 2; i++) {
    let px = x + s * (0.18 + hash(seed * 9.7 + i * 3.1) * 0.6);
    let py = y + s * (0.16 + hash(seed * 7.3 + i * 5.7) * 0.6);
    ctx.beginPath();
    ctx.moveTo(px, py);
    let a = hash(seed * 5.1 + i * 2.9) * Math.PI * 2;
    const segs = i === 2 ? 1 : 2;
    for (let j = 0; j < segs; j++) {
      a += (hash(seed * 3.3 + i * 4.7 + j) - 0.5) * 1.4;
      px += Math.cos(a) * s * 0.17;
      py += Math.sin(a) * s * 0.14;
      ctx.lineTo(px, py);
    }
    // 62px 的釉面上，裂纹只能是"凑近才看得见"的一丝：
    // 0.34 的暗线在整盘上会连成一片划痕（第一版就是这样，像刮花了）
    ctx.strokeStyle = 'rgba(8,20,15,0.13)';
    ctx.lineWidth = cw;
    ctx.stroke();
    ctx.save();
    ctx.translate(cw * 0.7, cw * 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.stroke();
    ctx.restore();
  }

  // ── 倒角：设计稿的两道 inset shadow（上 `0 1px 2px` 白 .22、
  //    下 `0 -3px 6px` 黑 .30）。用 4px / 12px 的软渐变还原，
  //    不要用 1.2px 的硬直线 —— 硬线在暗釉上读成"描边"，软渐变才读成"厚度"
  const topLip = ctx.createLinearGradient(0, y, 0, y + s * 0.075);
  topLip.addColorStop(0, `rgba(255,255,255,${0.22 * alpha})`);
  topLip.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topLip;
  ctx.fillRect(x, y, s, s * 0.075);
  const botLip = ctx.createLinearGradient(0, y + s * 0.82, 0, y + s);
  botLip.addColorStop(0, 'rgba(0,0,0,0)');
  botLip.addColorStop(1, `rgba(0,0,0,${0.34 * alpha})`);
  ctx.fillStyle = botLip;
  ctx.fillRect(x, y + s * 0.82, s, s * 0.18);

  ctx.restore(); // clip
  ctx.restore(); // alpha
}

/**
 * 墨石：不可走的死物。哑光、层理、不反光——
 * 它存在的意义是**反衬釉面**：盘上唯一没有光的东西，让釉更像釉。
 */
function drawStone(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, idx: number): void {
  const r = s * 0.40;

  // 石块：八边形带抖动（不是圆也不是方——自然的碎石）
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + hash(idx * 3.7) * 0.35;
    const rr = r * (0.88 + hash(idx * 2.3 + i * 1.9) * 0.18);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }

  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.7, cy + r);
  g.addColorStop(0, '#1B2A22');
  g.addColorStop(0.5, '#111C16');
  g.addColorStop(1, '#080F0B');
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // 层理：两道平行短痕。石头是「压出来的」，不是「长出来的」
  ctx.strokeStyle = 'rgba(3,7,5,0.6)';
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy - r * 0.18);
  ctx.lineTo(cx + r * 0.15, cy - r * 0.02);
  ctx.lineTo(cx + r * 0.55, cy - r * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.35, cy + r * 0.28);
  ctx.lineTo(cx + r * 0.3, cy + r * 0.4);
  ctx.stroke();

  // 受光棱：只左上缘一线。死物也有光，只是光到棱为止
  ctx.beginPath();
  ctx.moveTo(pts[7][0], pts[7][1]);
  ctx.lineTo(pts[0][0], pts[0][1]);
  ctx.lineTo(pts[1][0], pts[1][1]);
  ctx.strokeStyle = 'rgba(140,170,152,0.16)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, x, y, walk, type, gx, gy, idx } = g;
  const cx = x + cell / 2;
  const cy = y + cell / 2;

  // 槽位 → 棋子：内缩半个间距（设计稿 7 CSS）
  const inset = BOARD_GAP / 2;
  const s = cell - inset * 2;
  // 圆角 10/31 ≈ 0.32 —— 比常见卡片圆得多，接近"瓷片"而不是"按钮"
  const r = Math.max(6, s * 0.323);
  const seed = gx * 37.9 + gy * 21.3 + 1;

  if (type === CoverCell.BLOCK) {
    drawStone(ctx, cx, cy, s, idx);
    return;
  }

  // 机制格有自己的面色（设计稿：门/单向=石板青，传送=暮紫，星=鎏金，钥=铜，冰=霜青）
  switch (type) {
    case CoverCell.ICE:
      drawTile(ctx, x + inset, y + inset, s, r, TINT.frost as Tint, seed, walk ? 0.92 : 1);
      return;
    case CoverCell.SHARD:
      drawTile(ctx, x + inset, y + inset, s, r, TINT.star as Tint, seed);
      return;
    case CoverCell.KEY:
      drawTile(ctx, x + inset, y + inset, s, r, TINT.key as Tint, seed);
      return;
    case CoverCell.PORTAL:
      drawTile(ctx, x + inset, y + inset, s, r, TINT.violet as Tint, seed);
      return;
    case CoverCell.ONEWAY:
    case CoverCell.GATE:
      drawTile(ctx, x + inset, y + inset, s, r, TINT.dark as Tint, seed);
      return;
    default:
      break;
  }

  // 普通格：未铺是"生釉"（暗一档 + 0.82），已铺是"点过的釉"（亮一档）
  drawTile(ctx, x + inset, y + inset, s, r, (walk ? TINT.lit : TINT.pale) as Tint, seed, walk ? 1 : 0.82);
}

// ────────────────────────────── 金缮光迹 ──────────────────────────────

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
 * 金缮光迹：辉光 → 金体 → 亮金 → 高光线 → 转折糖珠。
 *
 * 五层是「光」和「一根黄线」的全部差别。路径是全屏唯一的发光体——
 * 它必须比任何一颗棋子都亮，但金色面积仍要克制（线宽吃到 0.30 格为止）。
 */
function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number): void {
  if (pts.length < 2) return;

  // 线宽全部按设计稿的 4 层换算（槽位 38 CSS）：
  // 11 / 5.5 / 2.2 / 0.8 CSS → 0.31 / 0.155 / 0.062 / 0.022 格。
  //
  // 辉光只能**一层**。老版叠了两层（0.29@.10 + 0.19@.22），
  // 中间那条比设计稿的芯亮一倍，整条线就读成"金胶带"而不是"一道光"。
  strokePath(ctx, pts, cell * 0.31, 'rgba(212,175,106,0.32)');
  strokePath(ctx, pts, cell * 0.155, K.gold);
  strokePath(ctx, pts, cell * 0.062, K.goldLit);

  // 高光：整条线往上偏半像素——光从左上打来，金脊在偏上那侧
  ctx.save();
  ctx.translate(0, -Math.max(0.5, cell * 0.010));
  strokePath(ctx, pts, Math.max(1.2, cell * 0.021), 'rgba(255,246,220,0.58)');
  ctx.restore();

  // 转折糖珠：金在拐弯处积成小珠。位置固定（每帧随机会爬）
  for (let i = 1; i < pts.length - 1; i++) {
    if (hash(i * 7.3) < 0.40) continue;
    const p = pts[i];
    const off = (hash(i * 13.9) - 0.5) * cell * 0.14;
    ctx.beginPath();
    ctx.arc(p.x + off, p.y - cell * 0.055, Math.max(0.9, cell * 0.022), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,246,220,0.52)';
    ctx.fill();
  }

  // 线头光晕：描金笔停处积起的一粒热金
  const head = pts[pts.length - 1];
  const pulse = 0.72 + 0.28 * Math.sin(now / 560);
  const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, cell * 0.30);
  hg.addColorStop(0, `rgba(255,246,222,${0.38 * pulse})`);
  hg.addColorStop(0.5, `rgba(233,204,138,${0.14 * pulse})`);
  hg.addColorStop(1, 'rgba(233,204,138,0)');
  ctx.beginPath();
  ctx.arc(head.x, head.y, cell * 0.30, 0, Math.PI * 2);
  ctx.fillStyle = hg;
  ctx.fill();
}

// ────────────────────────────── 主题 ──────────────────────────────

export const MISE_THEME = composeTheme({
  id: 'mise',
  name: '秘色天青',
  tagline: '雨过天青云破处',
  unlock: { type: 'free', value: 0 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(212,175,106,0.20)', core: K.goldLit, hot: K.goldHot },
    hintColor: K.goldLit,

    glyph: {
      style: 'porcelain',
      // 錾刻语言：浅釉勾线 + 鎏金填面。棋子是暗釉，款必须是**浅色**——
      // 旧版的墨绿勾线在暗格上等于没画
      pal: LIGHT_PAL,
      // 亮格（鎏金星屑 / 铜钥匙 / 霜冰）上换墨色：浅线压浅底会整片消失
      palFor: (type: number) => {
        // 金格（星屑）/ 铜格（钥匙）上是暖褐刻痕；冰面才用冷墨
        if (type === CoverCell.SHARD || type === CoverCell.KEY) return BROWN_PAL;
        if (type === CoverCell.ICE) return DARK_PAL;
        // 石块上的记号只能是**刻痕**：浅色填面会在暗盘上变成一块奶油，
        // 读起来像"可以点的按钮"，而它恰恰是唯一不能走的地方
        if (type === CoverCell.BLOCK) return STONE_PAL;
        return LIGHT_PAL;
      },
      // 不要底盘：设计稿的机制是直接錾在格面上的。
      // 一个浅色圆底在暗盘上会变成 64 个白点，抢掉光迹
      back: '',
      backEdge: 'transparent',
      backR: 0.26,
      terrainAccent: 'rgba(238,242,234,0.70)',
      // 图标 = 格的 46%（设计稿 inset 22% → 56% 的棋子面，换算到槽位）
      scale: 0.46,
      // 五角星顶满画布，缩到 0.82 才和钥匙/门同重（设计稿的星只有棋子的 42%）
      scaleFor: (type: number) => (type === CoverCell.SHARD ? 0.82 : 1),
    },

    hint(ctx, p, cell, i) {
      const inset = cell * 0.11;
      ctx.save();
      ctx.setLineDash(i === 0 ? [] : [cell * 0.14, cell * 0.10]);
      ctx.beginPath();
      roundRect(ctx, p.x - cell / 2 + inset, p.y - cell / 2 + inset, cell - inset * 2, cell - inset * 2, cell * 0.16);
      ctx.strokeStyle = K.goldLit;
      ctx.lineWidth = i === 0 ? Math.max(2.6, cell * 0.062) : Math.max(1.6, cell * 0.038);
      ctx.stroke();
      ctx.restore();
    },

    head(ctx, p, cell, now) {
      const r = cell * 0.105;
      const pulse = 0.78 + 0.22 * Math.sin(now / 300);
      // 金珠的光
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.4);
      g.addColorStop(0, `rgba(255,246,222,${0.44 * pulse})`);
      g.addColorStop(0.45, `rgba(212,175,106,${0.16 * pulse})`);
      g.addColorStop(1, 'rgba(212,175,106,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // 金珠本体：亮面在左上，暗面在右下
      const bg = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      bg.addColorStop(0, K.goldHot);
      bg.addColorStop(0.62, K.goldLit);
      bg.addColorStop(1, K.goldDeep);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
    },

    endpoint(ctx, kind, p, cell) {
      const r = cell * 0.30;
      if (kind === 'start') {
        // 起点·玉璧：双圈 + 好。青玉的款——展柜里器物的身份
        const ring = 'rgba(110,158,130,';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        const jade = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
        jade.addColorStop(0, '#BFD8C6');
        jade.addColorStop(0.7, '#7FA892');
        jade.addColorStop(1, '#4A7260');
        ctx.fillStyle = jade;
        ctx.fill();
        ctx.strokeStyle = ring + '0.60)';
        ctx.lineWidth = Math.max(1.6, cell * 0.032);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(29,51,42,0.42)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 好（璧心）：一点金
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,144,69,0.92)';
        ctx.fill();
      } else {
        // 终点·朱印：全盘唯一一点红。篆意方印：外框 + 两横一竖的文
        const half = r * 0.92;
        ctx.save();
        ctx.translate(p.x, p.y);
        // 印泥的不匀：底色带一点径向渐变
        const sealG = ctx.createRadialGradient(-half * 0.3, -half * 0.3, half * 0.1, 0, 0, half * 1.25);
        sealG.addColorStop(0, '#D25B40');
        sealG.addColorStop(0.6, K.seal);
        sealG.addColorStop(1, K.sealDeep);
        ctx.beginPath();
        roundRect(ctx, -half, -half, half * 2, half * 2, half * 0.22);
        ctx.fillStyle = sealG;
        ctx.fill();
        // 印边：略微破口的框
        ctx.strokeStyle = 'rgba(142,52,36,0.85)';
        ctx.lineWidth = Math.max(1.4, cell * 0.028);
        ctx.stroke();
        // 印文：两横一竖（抽象的「工」，器物的款）
        ctx.strokeStyle = 'rgba(255,236,224,0.88)';
        ctx.lineWidth = Math.max(1.6, cell * 0.042);
        ctx.lineCap = 'square';
        const iw = half * 0.52;
        ctx.beginPath();
        ctx.moveTo(-iw, -half * 0.34);
        ctx.lineTo(iw, -half * 0.34);
        ctx.moveTo(-iw, half * 0.34);
        ctx.lineTo(iw, half * 0.34);
        ctx.moveTo(0, -half * 0.34);
        ctx.lineTo(0, half * 0.34);
        ctx.stroke();
        ctx.restore();
      }
    },
  },
});

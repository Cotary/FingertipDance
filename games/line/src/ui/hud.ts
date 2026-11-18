import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { THEME, type Theme } from './theme';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayInset, clayStar, clayText, rrectPts, tracePts, type ClayColor } from './clay';
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
      : b.kind === 'ghost' ? CLAY_UI.inkOnLight : '#FFF6E9',
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
 * 对局屏底注（定稿）：「本关重来 N 次 · 零重来 = ★★★」。
 *
 * 替代老的「37 / 1000 关」进度条 —— 无尽模式下进度没有刻度感，
 * 而重来次数才是星级的口径（见 `starOfCover`），底注就该说这件事。
 *
 * 版式照设计稿：9.5 CSS / 字距 .26em / 无衬线 / `--i500`，
 * 中间那个次数单独走 `--c200`（它是决定星级的那一个数，不该和注解同色）。
 */
export function drawPlayFootnote(
  ctx: CanvasRenderingContext2D,
  undos: number,
  chrome?: ThemeChrome,
): void {
  const size = 19;
  const track = 5;
  const dim = chrome?.inkDim ?? chrome?.inkSoft ?? CLAY_UI.inkSoft;
  const num = chrome ? (chrome.inkStrong ?? 'rgba(184,207,192,0.92)') : CLAY_UI.ink;
  const head = '本关重来 ';
  const mid = String(undos);
  const tail = ' 次 · 零重来 = ★★★';

  ctx.save();
  ctx.font = `300 ${size}px ${SANS_FONT}`;
  const w = (s: string) =>
    [...s].reduce((a, ch) => a + advanceOf(ctx, ch, size), 0) + track * Math.max(0, [...s].length - 1);
  const total = w(head) + w(mid) + w(tail) + track * 2;
  ctx.restore();

  let x = DESIGN_W / 2 - total / 2;
  const base = 1140;
  sansTextLeft(ctx, head, x, base, size, dim, track, 300);
  x += w(head) + track;
  sansTextLeft(ctx, mid, x, base, size, num, track, 300);
  x += w(mid) + track;
  sansTextLeft(ctx, tail, x, base, size, dim, track, 300);
}

// ────────────────────────── 通关：棋盘上落印 ──────────────────────────

/** 落印动画时长（对齐设计稿 `.seal.show` 的 500ms）。 */
export const WIN_SEAL_MS = 520;

/**
 * 通关瞬刻：在棋盘中央**砸**下一枚朱印「过」。
 *
 * 这一下是"打完了"唯一的一次现场宣告 —— 早先通关只有一格一格的波次点亮，
 * 而波次点的是**已经亮着**的格子（通关时 `covered` 本来就是满的），
 * 于是玩家看到的只是：最后一格连上 → 停顿 1.2 秒 → 突然跳结算页。
 * 中间那 1.2 秒什么都没有，像是卡了一下。
 *
 * 动画照设计稿 `@keyframes stamp`：
 *   `0% rotate(-16deg) scale(1.7) opacity 0`
 *   `55% rotate(-6deg) scale(0.96) opacity 1`
 *   `100% rotate(-8deg) scale(1)`
 * 先冲到 0.96 再回弹到 1 —— 那 4% 的回弹是"按下去又弹起"的全部信息量，
 * 少了它印章就只是"放大出现"。
 *
 * @param cx,cy 印章中心（棋盘正中）
 * @param size  印章直径（设计稿 132 / 棋子 80 → 1.65 个棋子）
 * @param elapsed 距离通关的毫秒数
 */
export function drawWinSeal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  elapsed: number,
): void {
  if (elapsed < 0) return;
  const u = Math.min(1, elapsed / WIN_SEAL_MS);
  let scale: number;
  let rot: number;
  if (u < 0.55) {
    const k = u / 0.55;
    // 三次缓出：前三成时间走完七成距离 —— 才有"砸下来"的速度感
    const e = 1 - Math.pow(1 - k, 3);
    scale = 1.7 + (0.96 - 1.7) * e;
    rot = -16 + 10 * e;
  } else {
    const k = (u - 0.55) / 0.45;
    scale = 0.96 + 0.04 * k;
    rot = -6 - 2 * k;
  }
  const alpha = Math.min(1, u / 0.22);
  if (alpha <= 0) return;

  const r = (size / 2) * scale;
  ctx.save();
  ctx.globalAlpha = alpha;

  // ── 印章压出来的接触影：贴地的一团暖红，不是黑
  const sh = ctx.createRadialGradient(cx, cy + r * 0.22, 0, cx, cy + r * 0.22, r * 1.5);
  sh.addColorStop(0, 'rgba(140,47,30,0.34)');
  sh.addColorStop(0.55, 'rgba(140,47,30,0.12)');
  sh.addColorStop(1, 'rgba(140,47,30,0)');
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.22, r * 1.5, r * 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = sh;
  ctx.fill();

  ctx.translate(cx, cy);
  ctx.rotate((rot * Math.PI) / 180);

  // ── 印面：`radial-gradient(circle at 35% 30%, #D9614A, #C04B33 55%, #8C2F1E)`
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.05, 0, 0, r * 1.12);
  g.addColorStop(0, '#D9614A');
  g.addColorStop(0.55, '#C04B33');
  g.addColorStop(1, '#8C2F1E');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // ── 印泥的厚：上沿受光、下沿吃土（走 clip，不描边）
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  const hi = ctx.createLinearGradient(0, -r, 0, -r * 0.15);
  hi.addColorStop(0, 'rgba(255,226,214,0.30)');
  hi.addColorStop(1, 'rgba(255,226,214,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(-r, -r, r * 2, r * 0.85);
  const lo = ctx.createLinearGradient(0, r * 0.25, 0, r);
  lo.addColorStop(0, 'rgba(74,18,8,0)');
  lo.addColorStop(1, 'rgba(74,18,8,0.40)');
  ctx.fillStyle = lo;
  ctx.fillRect(-r, r * 0.25, r * 2, r * 0.75);
  ctx.restore();

  // ── 印文「过」：衬线 900，字面中心在基线上方 0.36em
  const fs = size * 0.47;
  ctx.font = `900 ${fs}px ${SERIF_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,244,238,0.94)';
  ctx.shadowColor = 'rgba(90,25,12,0.45)';
  ctx.shadowBlur = size * 0.05;
  ctx.shadowOffsetY = size * 0.018;
  ctx.fillText('过', 0, fs * 0.04);
  ctx.restore();
}

// ────────────────────────── 盘底：提示 / 图例 ──────────────────────────

/**
 * 「提示」金按钮（设计稿 03 屏底部那条）。
 *
 * 设计稿把它做成**满栏金条**而不是和「返回 / 跳过」并排的小按钮：
 * 它是这一屏唯一的正向行动点。
 *
 * 早期右端还压过一枚朱砂签（「首提示 · 看视频」），现已去掉 ——
 * 那块红在深盘上是全屏最亮的一团，把唯一的行动点从"提 示"抢到了广告标上；
 * 而它要表达的信息（这次提示要看完一段视频）在点下去的那一刻再说也不迟。
 */
export function drawPlayTip(
  ctx: CanvasRenderingContext2D,
  b: Button,
  pressed: boolean,
): void {
  const dy = pressed ? 3 : 0;
  const r = 32;
  const y = b.y + dy;

  // 厚底边（设计稿 box-shadow 0 4px 0 #8A6B3C）
  //
  // 圆角必须与金面**同半径**、高度也同 b.h，整块只是下移 8 —— 和首页
  // `drawGoldCta` 一个写法。早先这里画的是 `y + h - 10 / 高 16 / 圆角 8`：
  // 一条扁条压在按钮底下，两端的 8px 方角正好从按钮 32px 的圆弧处探出去，
  // 在盘面上读成"按钮下面横着一根线"，非常突兀。
  roundRect(ctx, b.x, y + 8, b.w, b.h, r);
  ctx.fillStyle = '#8A6B3C';
  ctx.fill();

  // 金面：180°，#F2DCA8 → #B8945A 82%（设计稿 `linear-gradient(180deg, --g200, --g400 82%)`）。
  //
  // 外面那圈暖光是设计稿的第二道投影 `0 12px 26px rgba(212,175,106,.22)`：
  // 少了它，金条就是一枚贴上去的贴纸；有了它，金子才"照到"了下面的盘面。
  ctx.save();
  ctx.shadowColor = 'rgba(212,175,106,0.22)';
  ctx.shadowBlur = 52;
  ctx.shadowOffsetY = 24;
  ctx.beginPath();
  roundRect(ctx, b.x, y, b.w, b.h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + b.h);
  g.addColorStop(0, pressed ? '#E8D095' : '#F2DCA8');
  g.addColorStop(0.82, '#B8945A');
  g.addColorStop(1, '#A9853F');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // 设计稿的金面**没有内描边**：上亮下暗全靠那一道 180° 渐变。
  // 加 1.4px 高光边会把金条封成一个圆环（像胶囊药丸），金面反而变平
  spacedText(ctx, b.label, b.x + b.w / 2, y + b.h / 2 + 11, 30, '#2A2114', 9, 700);
}

/**
 * 扁平次级按钮（「跳过 / 返回」）。
 *
 * 不能用 `drawButton` 的黏土块：那是浅色工坊语言，深盘上一块凸起的黏土
 * 会读成"另一个世界的东西"。设计稿的次级按钮是一块**压平的墨玻璃**：
 * rgba(22,36,30,.85) + 一根冷青发丝边。
 *
 * 但「墨玻璃」只在暗盘上成立 —— 亮底的鸣沙上，两块近黑的胶囊是整屏最重的
 * 东西，比「提示」还抢眼。所以底色/字色改由主题的 `ghost / ghostInk` 给：
 * 暗盘仍是墨玻璃，亮盘是一块比墙面浅半档的沙板。不传 chrome 时保留旧值。
 */
export function drawPlaySub(
  ctx: CanvasRenderingContext2D,
  b: Button,
  pressed: boolean,
  chrome?: ThemeChrome,
): void {
  const dy = pressed ? 2 : 0;
  const fill = chrome?.ghost ?? 'rgba(22,36,30,0.85)';
  const ink = chrome?.ghostInk ?? '#D5E3D8';
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, b.x, b.y + dy, b.w, b.h, 28);
  ctx.fillStyle = fill;
  ctx.fill();
  if (pressed) {
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fill();
  }
  ctx.globalAlpha = pressed ? 0.52 : 0.30;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  spacedText(ctx, b.label, b.x + b.w / 2, b.y + dy + b.h / 2 + 8, 22, ink, 6, 600);
}

/**
 * 图例记号：**照搬设计稿 `#gLegend` 的 24 单位 SVG**。
 *
 * 早先这里用「外接半径 r + 自造比例」画了六个近似的记号，
 * 结果每个图标都撑到色块的 76% —— 而设计稿的 SVG 是 `viewBox="0 0 24 24"`
 * 铺满 26px 的色块，箭头实际只占 12/24 = 50%，四周留着一圈空气。
 * 对着看就是「我们的图例又大又挤，设计稿的又小又飘」。
 *
 * 所以不再近似：把画布缩到 24 单位，坐标与描边宽度逐字抄 SVG。
 *
 * @param sw 色块边长（设计稿 `.sw` = 26 CSS → 52）
 */
function drawLegendMark(
  ctx: CanvasRenderingContext2D,
  kind: LegendItem['kind'],
  cx: number,
  cy: number,
  sw: number,
  ink: string,
): void {
  const u = sw / 24; // 1 SVG 单位 = 多少设计像素
  ctx.save();
  ctx.translate(cx - sw / 2, cy - sw / 2);
  ctx.scale(u, u);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'arrow': {
      // M5 12 H15 / M11 7 L17 12 L11 17，stroke-width 2
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(5, 12);
      ctx.lineTo(15, 12);
      ctx.moveTo(11, 7);
      ctx.lineTo(17, 12);
      ctx.lineTo(11, 17);
      ctx.stroke();
      break;
    }
    case 'star': {
      // 纯填充的十点星（fill 无 stroke）
      const pts: Array<[number, number]> = [
        [12, 4], [14, 10], [20, 10], [15, 13.6], [17, 20],
        [12, 16.2], [7, 20], [9, 13.6], [4, 10], [10, 10],
      ];
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'key': {
      // circle(9,9,3) / M11 11 L17 17 / M14.6 14.6 L16.6 12.6，stroke-width 1.8
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(9, 9, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11, 11);
      ctx.lineTo(17, 17);
      ctx.moveTo(14.6, 14.6);
      ctx.lineTo(16.6, 12.6);
      ctx.stroke();
      break;
    }
    case 'gate': {
      // rect(7,5,10,14,rx1.5) + circle(14,12,1)，stroke-width 1.5
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      roundRect(ctx, 7, 5, 10, 14, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(14, 12, 1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'portal': {
      // circle(10,12,4.6) + circle(15,12,4.6)，stroke-width 1.5
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(10, 12, 4.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(15, 12, 4.6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'ice': {
      // M6 16 L10 8 L14 16 / M8.2 13 H11.8 / M15 16 L18 8，stroke-width 1.6
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(6, 16);
      ctx.lineTo(10, 8);
      ctx.lineTo(14, 16);
      ctx.moveTo(8.2, 13);
      ctx.lineTo(11.8, 13);
      ctx.moveTo(15, 16);
      ctx.lineTo(18, 8);
      ctx.stroke();
      break;
    }
    case 'rock': {
      // 墨石：一块带折面的碎石（外轮廓填充 + 一条受光的棱线）
      ctx.beginPath();
      ctx.moveTo(7.2, 8.4);
      ctx.lineTo(13.6, 6.2);
      ctx.lineTo(18.4, 10.2);
      ctx.lineTo(17.4, 16.6);
      ctx.lineTo(11.2, 18.6);
      ctx.lineTo(6.2, 14.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(158,186,168,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(7.2, 8.4);
      ctx.lineTo(13.6, 6.2);
      ctx.lineTo(18.4, 10.2);
      ctx.moveTo(13.6, 6.2);
      ctx.lineTo(11.6, 12.2);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** 图例的一条：色块 + 名称。 */
export interface LegendItem {
  kind: 'arrow' | 'star' | 'key' | 'gate' | 'portal' | 'ice' | 'rock';
  label: string;
  bg: string;
  ink: string;
}

/**
 * 盘面机制图例（设计稿 03 屏「单向门 / 星屑 序 / 钥匙 / 门 / 传送门 / 冰面」）。
 *
 * 固定列出**全部**机制（含墨石），不再按本关实际出现的过滤。
 * 早先只列盘上真有的，理由是"没有传送门的关里画传送门，玩家会去找它"；
 * 但实际读法是反的：这一行在盘下是**世界观的一部分**——它告诉玩家
 * "这个世界有这七种东西"，而每一关只是其中几样登场。逐关变长的图例
 * 反而像一排会自己增减的按钮，玩家既记不住位置，也读不出这是个体系。
 */
export function drawPlayLegend(
  ctx: CanvasRenderingContext2D,
  items: LegendItem[],
  top: number,
  chrome?: ThemeChrome,
  /**
   * 主题自己的记号。
   *
   * 图例是"这个世界有哪几种东西"，记号必须**和盘面同一个形状** ——
   * 鸣沙的冰砖是六边晶，天青的冰面是一道斜坡；用同一笔画，
   * 至少有一边是错的（鸣沙的蓝片上，那道斜坡实测读成字母「A/」）。
   */
  marks?: Partial<Record<LegendItem['kind'], (c: CanvasRenderingContext2D, cx: number, cy: number, sw: number, ink: string) => void>>,
): void {
  // 名称色跟主题走：设计稿是 `--i500`（#7A7468），亮色主题上这行会读不见
  const label = chrome?.inkDim ?? (chrome ? chrome.inkSoft : '#7A7468');
  const n = items.length;
  if (n === 0) return;
  const left = 44;
  const right = DESIGN_W - 44;
  const sw = 52;
  const step = n > 1 ? (right - left - sw) / (n - 1) : 0;

  items.forEach((it, i) => {
    const x = left + i * step;
    // 色块：设计稿 `.sw` 就是**一块平色**（`background: #26333B` 之类）+ 圆角 7，
    // 没有渐变、没有描边。第一版给它套了棋子的穹顶和一圈白边，
    // 结果六枚图例读成六个"小棋子" —— 而它们只是索引，不该有体积
    ctx.beginPath();
    roundRect(ctx, x, top, sw, sw, 14);
    ctx.fillStyle = it.bg;
    ctx.fill();

    const mark = marks?.[it.kind];
    if (mark) mark(ctx, x + sw / 2, top + sw / 2, sw, it.ink);
    else drawLegendMark(ctx, it.kind, x + sw / 2, top + sw / 2, sw, it.ink);

    // 名称：无衬线 8.5 CSS / 字距 .12em / --i500（和底注同一档）
    sansText(ctx, it.label, x + sw / 2, top + sw + 28, 17, label, 2.04, 300);
  });
}

/**
 * 画 HUD 顶部：进度读数（左）+ 衬线关号（右）。
 *
 * 定稿版式（2026-11-15）：顶栏不再放按钮和胶囊 —— 左边「52 / 86」衬线大数
 * +「剩 34 · 下一个 ★2」弱化小字；右边「047」衬线金字 +「关」。
 * 「返回 / 跳过」下沉到盘底行动行（与「提示」同排），顶部只留读数。
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
  // 版心：设计稿 HUD 的左边是 24 CSS（比卡片出血 22 再进 2px）→ 48
  const pad = 48;
  /** 大数基线（设计稿 .big 34px 行顶 52 CSS → 88.5 → 105） */
  const numBaseline = 106;
  /** 小字基线（设计稿 .rest 行 101 CSS → 114.5 → 157） */
  const subBaseline = 157;

  // ── 左：进度大数 + 弱化余数
  if (coverProgress) {
    const done = Math.max(0, coverProgress.done);
    const total = Math.max(0, coverProgress.total);
    const left = Math.max(0, total - done);
    const ink = chrome ? chrome.ink : '#F2EEE6';
    const dim = chrome?.inkDim ?? (chrome ? chrome.inkSoft : 'rgba(185,178,164,0.75)');

    // 「52」大字 +「/ 86」小字：两个数是两件事（铺了多少 / 一共多少），
    // 同号同色会读成一个分数。大数是进度本身，小数只是分母。
    // 分母走 `--i500` 并保持 900（设计稿 `.big i` 就是 900 + #7A7468）：
    // 只是"退色"，不是"变细"，退成细体就成了另一个字体
    const doneW = trackedWidth(ctx, String(done), 68, 2, 900);
    trackedText(ctx, String(done), pad, numBaseline, 68, ink, 2, 900);
    trackedText(ctx, `/ ${total}`, pad + doneW + 16, numBaseline, 36, dim, 4, 900);

    // 「剩 34 · 下一个 ★2」：11 CSS / 300 / 字距 .22em / --i500，**整行同色**。
    // 设计稿里 ★2 并没有单独提金 —— 提了金，这行就从"注"升成了"读数"
    const star = coverProgress.shardNext !== undefined && coverProgress.shardNext >= 0 ? `　·　下一个 ★${coverProgress.shardNext + 1}` : '';
    sansTextLeft(ctx, `剩 ${left}${star}`, pad, subBaseline, 22, dim, 2.4, 300);
  }

  // ── 右：关号（衬线金字，像刻在铜牌上）。两级右对齐：047 在 116，「关」压到 157
  const lv = String(levelIdx).padStart(3, '0');
  const rightX = DESIGN_W - pad;
  const gold = chrome ? chrome.fill : '#D4AF6A';
  // 关号比「关」亮一档（定稿 g200/g300 的层级）。不能用 primaryInk ——
  // 那是金底上的暗字，压在暗底上会读成一块脏棕。
  //
  // 亮色主题（鸣沙）必须自己给一个**更暗**的强调色：同一个 #F2DCA8
  // 压在土壁上等于没写（`inkStrong` 就是为这件事开的）
  const goldHi = chrome?.inkStrong ?? '#F2DCA8';
  // 设计稿 `.g-lv` 是 **300**：关号是铜牌上的铭文，细体才有刻的味儿；
  // 加粗会把它变成"还能点的按钮"
  const lvW = trackedWidth(ctx, lv, 52, 3, 300);
  trackedText(ctx, lv, rightX - lvW, 116, 52, goldHi, 3, 300);
  const gw = trackedWidth(ctx, '关', 24, 8, 300);
  trackedText(ctx, '关', rightX - gw, subBaseline, 24, gold, 8, 300);

  // 皮肤计数挪到底部进度条右侧（见 `drawProgressBar`）。
  void skinName;
  void skinCount;
  void totalSkins;
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
 * 衬线字体栈：关号 / 统计大数 / 印文专用。
 * 「数字衬线」是品牌骨架四条之一 —— 数字要像刻上去的，不是系统默认的。
 */
export const SERIF_FONT = '"Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif';

/**
 * 无衬线字体栈：微文案专用（设计稿的 `--sans`）。
 *
 * 定稿的字法分两档：**衬线给"物"**（关号、大数、印文、按钮），
 * **无衬线给"注"**（图例名、底注、余数、朱砂签）。11px 的宋体在暗底上
 * 是一团极细的横，读不全；无衬线同字号下笔画匀、认得快。
 */
export const SANS_FONT = '"PingFang SC", "Helvetica Neue", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/**
 * 带字距的衬线文字（逐字排版）。
 *
 * Canvas 的 `ctx.letterSpacing` 在微信端不保证可用，这里手动按字距排：
 * 定稿的品牌字全部带 0.26~0.42em 字距（"下 一 关""一 气 呵 成"），
 * 没有字距就不是这套字。
 */
export function spacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  baseline: number,
  size: number,
  fill: string,
  tracking: number,
  weight = 700,
  family: string = SERIF_FONT,
): void {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = fill;
  ctx.textBaseline = 'alphabetic';
  // 必须显式左对齐：逐字排版是按「字的左边缘」推进的，
  // 一旦外部（右对齐的 HUD 读数）把 textAlign 改成 right 没还原，
  // 整行会整体左移半个字宽，居中就变成偏左。
  ctx.textAlign = 'left';
  const chars = [...text];
  const widths = chars.map((ch) => advanceOf(ctx, ch, size));
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, baseline);
    x += widths[i] + tracking;
  });
  ctx.restore();
}

/**
 * 无衬线居中文字（微文案的默认写法）。
 *
 * 只是 `spacedText` 换字族，单独开一个入口是为了让调用点一眼看出
 * 「这行是注，不是物」—— 顺手也免了每次传 `SANS_FONT`。
 */
export function sansText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  baseline: number,
  size: number,
  fill: string,
  tracking: number,
  weight = 400,
): void {
  spacedText(ctx, text, cx, baseline, size, fill, tracking, weight, SANS_FONT);
}

/** 无衬线左对齐文字。 */
export function sansTextLeft(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  size: number,
  fill: string,
  tracking: number,
  weight = 400,
): void {
  trackedText(ctx, text, x, baseline, size, fill, tracking, weight, SANS_FONT);
}

/**
 * 单字的排版宽度。
 *
 * 半角空格按 **0.25em** 算，而不是字体的自带宽度。
 *
 * 定稿里 `第 047 关 通关` 的间隔是「一个空格 + letter-spacing」两段相加，
 * 浏览器给 Noto Serif 的空格是 0.25em（24px 字 → 6px）；而宋体/SimSun 的空格
 * 是 **0.5em**，直接 measureText 会让每个间隔比设计稿宽一倍 ——
 * 一行 4 个词的标题能宽出 30px，居中之后就变成「整体偏松」。
 *
 * 全角空格（U+3000）不动：那是真·全角，不是排版间隔。
 */
function advanceOf(ctx: CanvasRenderingContext2D, ch: string, size: number): number {
  if (ch === ' ') return size * 0.25;
  return ctx.measureText(ch).width;
}

/**
 * 带字距的整行宽度（与 `trackedText` 同一套度量）。
 *
 * CSS 的 `letter-spacing` 会在**每个字之后**补间距（含末字），
 * 但视觉上的行宽只算到末字右缘 —— 这里按「末字不加」算，
 * 好让左对齐 / 右对齐 / 居中三种锚点用同一把尺子。
 */
export function trackedWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  tracking = 0,
  weight = 600,
  family: string = SERIF_FONT,
): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  const chars = [...text];
  const w = chars.reduce((a, ch) => a + advanceOf(ctx, ch, size), 0) + tracking * Math.max(0, chars.length - 1);
  ctx.restore();
  return w;
}

/**
 * 带字距的**左对齐**文字（设计稿大量文字是左对齐的 —— 居中会散掉版心）。
 * @param x 行首
 * @param baseline 基线 y
 */
export function trackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  size: number,
  fill: string,
  tracking = 0,
  weight = 600,
  family: string = SERIF_FONT,
): void {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = fill;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, baseline);
    cx += advanceOf(ctx, ch, size) + tracking;
  }
  ctx.restore();
}

/**
 * 带字距的**右对齐**文字（票券右侧的「∞ / 无 尽」这类镜像位置）。
 * @param right 行尾
 */
export function trackedTextRight(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  baseline: number,
  size: number,
  fill: string,
  tracking = 0,
  weight = 600,
): void {
  const w = trackedWidth(ctx, text, size, tracking, weight);
  trackedText(ctx, text, right - w, baseline, size, fill, tracking, weight);
}

/** 一颗星的几何路径（定稿的扁五角星，不是黏土胖星）。 */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.46;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * 画通关结算页（朱印版式，2026-11-15 定稿）。
 *
 * 版式语言：墨石暗幕上一枚朱印「过」压顶，衬线关号，金星，一语成评
 * （一气呵成 / 渐入佳境 / 来日方长），深石数据格，金主按钮 + 幽灵次按钮。
 * 和老黏土版的区别不是换色：老版是奶油面板 + 金匾标题的「表单」，
 * 新版是「展柜里盖了个章」——暗底、留白、朱砂只出现在印章一处。
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
   * 改成「重玩本关」/「返回大厅」。
   */
  isAllCleared = false,
): Button[] {
  const cx = DESIGN_W / 2;

  // ── 遮罩：定稿的结算是一张**实底**。
  //
  //    设计稿 04 屏的底色是均匀的 #0E1815（不是渐变，也不是压暗的棋盘），
  //    所以这里铺的就是这个色值，0.997 只留一层「盘面还在玻璃后面」的意思。
  //
  //    别再用 0.96：棋盘格是浅色（#D2E1D7 级别），叠 1.5% 就是 +3/255，
  //    在近黑底上能看出一整片方格 —— 像没画完，而不是「幽光」。
  //    底部再补一道同色压暗，把盘面脚注（本关重来 N 次）这种小块彻底吃掉。
  ctx.fillStyle = 'rgba(14,24,21,0.997)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  const botScrim = ctx.createLinearGradient(0, DESIGN_H - 300, 0, DESIGN_H);
  botScrim.addColorStop(0, 'rgba(14,24,21,0)');
  botScrim.addColorStop(1, 'rgba(14,24,21,0.9)');
  ctx.fillStyle = botScrim;
  ctx.fillRect(0, DESIGN_H - 300, DESIGN_W, 300);

  // ── 朱印「过」：全屏唯一一点红。歪 3°，像真的盖上去的
  //
  //    坐标全部取自设计稿 04 屏（CSS × 2）：印盒 96 → 192，
  //    盒子中心 y = 120.05 → 168（已减 36 假状态栏）。
  const SEAL_S = 192;
  const SEAL_CY = 168;
  ctx.save();
  ctx.translate(cx, SEAL_CY);
  ctx.rotate((-3 * Math.PI) / 180);
  const half = SEAL_S / 2;
  const sealPath = () => {
    ctx.beginPath();
    roundRect(ctx, -half, -half, SEAL_S, SEAL_S, 32);
  };
  // 印泥：155° 的斜渐变（上偏左亮 → 下偏右深）+ 一点点外晕
  const sg = ctx.createLinearGradient(-half * 0.4, -half, half * 0.3, half);
  sg.addColorStop(0, '#B9482F');
  sg.addColorStop(0.55, '#A9402A');
  sg.addColorStop(1, '#9C4430');
  sealPath();
  ctx.shadowColor = 'rgba(140,47,30,0.5)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // 内光 / 内暗：走 clip + 渐变，而不是双层描边 ——
  // 描边会画出一圈「双线相框」，真印章是边缘受光、下沿吃土
  ctx.save();
  sealPath();
  ctx.clip();
  const innerHi = ctx.createLinearGradient(0, -half, 0, -half * 0.2);
  innerHi.addColorStop(0, 'rgba(255,214,196,0.08)');
  innerHi.addColorStop(1, 'rgba(255,214,196,0)');
  ctx.fillStyle = innerHi;
  ctx.fillRect(-half, -half, SEAL_S, SEAL_S * 0.62);
  const innerLo = ctx.createLinearGradient(0, half * 0.28, 0, half);
  innerLo.addColorStop(0, 'rgba(72,20,10,0)');
  innerLo.addColorStop(1, 'rgba(72,20,10,0.18)');
  ctx.fillStyle = innerLo;
  ctx.fillRect(-half, half * 0.28, SEAL_S, half * 0.72);
  ctx.restore();
  // 印文：48 CSS → 96。CJK 字面中心在基线之上约 0.36em 处，
  // 所以基线压 +34 才是视觉居中
  spacedText(ctx, isAllCleared ? '全' : '过', 0, 44, 96, 'rgba(255,240,228,0.94)', 0, 900);
  ctx.restore();

  // ── 标题：衬线关号。三位补零 —— 刻在铜牌上的编号
  const lv = String(levelIdx).padStart(3, '0');
  const title = isAllCleared ? '全 部 通 关' : skipped ? `第 ${lv} 关 已跳过` : `第 ${lv} 关 通关`;
  // 设计稿标题行 y = 190（24 CSS），基线 ≈ 216.6 → 361
  spacedText(ctx, title, cx, 363, 48, '#F2EEE6', 14, 700);

  // ── 星级 / 评语
  //
  //    设计稿的星不是「塞满 34px 盒子」的星：viewBox 34 里外接圆半径只有 14，
  //    也就是星本身就是**小一号**的（视觉宽 26.6 CSS）。canvas 里 r 就是外接圆，
  //    所以 r = 28（14 CSS），星距 96（48 CSS）。
  const isCover = coverUndos !== undefined && coverUndos !== null;
  const stars = isCover ? starOfCover(coverUndos) : starOf(steps, shortest);
  const starsCy = 445; // 设计稿星行中心 260 CSS（星形墨迹重心比盒子中心低 3px）
  const STAR_R = 28;
  if (skipped) {
    // 跳过：不画星 —— 与地图上的「没星」保持一致
    spacedText(ctx, '已 跳 过 · 未 获 星', cx, starsCy + 30, 26, 'rgba(185,178,164,0.6)', 8, 600);
  } else {
    for (let i = 0; i < 3; i++) {
      const sx = cx + (i - 1) * 96;
      const on = i < stars;
      starPath(ctx, sx, starsCy, STAR_R);
      if (on) {
        const g = ctx.createLinearGradient(sx - STAR_R, starsCy - STAR_R, sx + STAR_R, starsCy + STAR_R);
        g.addColorStop(0, '#FFF3D6');
        g.addColorStop(1, '#F2DCA8');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = '#B89045';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        // 设计稿的空星只描边不填（fill:none）—— 填深绿会在暗底上变成实心块
        ctx.strokeStyle = 'rgba(185,178,164,0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    const phrase = stars >= 3 ? '一 气 呵 成' : stars === 2 ? '渐 入 佳 境' : '来 日 方 长';
    // 评语基线：设计稿字行 y = 283（12 CSS）→ 520
    spacedText(ctx, phrase, cx, 522, 24, '#D4AF6A', 10, 600);
  }

  // ── 数据格：深石凹格（不是沙色凸块 —— 暗底上凸块会像补丁）
  //
  //    设计稿 128×71 CSS → 256×142，格间距 12 → 24，两格居中对齐
  //    （左格 x = 53.5 → 107）。
  const statTop = 572; // 设计稿 322 CSS
  const sW = 256, sH = 142, sGap = 24;
  const stats: Array<[string, string]> = isCover
    ? [
        [`${coverUndos} 次`, '重 来'],
        [`${(timeMs / 1000).toFixed(1)}s`, '用 时'],
      ]
    : [
        [`${steps}`, '步 数'],
        [`${(timeMs / 1000).toFixed(1)}s`, '用 时'],
      ];
  stats.forEach(([v, k], i) => {
    const sx = cx - sW - sGap / 2 + i * (sW + sGap);
    ctx.beginPath();
    roundRect(ctx, sx, statTop, sW, sH, 26);
    ctx.fillStyle = 'rgba(22,36,30,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(147,179,162,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 值 19 CSS → 38，基线在格顶下 68；标签 8.5 → 17，基线 +108
    spacedText(ctx, v, sx + sW / 2, statTop + 71, 38, '#F2EEE6', 2, 700);
    spacedText(ctx, k, sx + sW / 2, statTop + 111, 17, '#7A7468', 5, 500);
  });
  void progressRatio;

  // ── 解锁主题：一条**发丝金签**（信息，不是按钮）
  //
  //    设计稿没有这一条 —— 它是我们真有的功能（通关解锁主题），必须有反馈。
  //    但不能做成金块：一屏只有主按钮能用实金，「再来一条金胶囊」会立刻
  //    把主次打乱。所以压成描边签，放在按钮组下方的空白里当脚注。
  if (unlockedSkin) {
    const bw = 520, bh = 52, bx = cx - bw / 2, by = 1116;
    ctx.beginPath();
    roundRect(ctx, bx, by, bw, bh, 26);
    ctx.fillStyle = 'rgba(22,36,30,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,106,0.42)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 左端一颗金点：像盖在签上的小印
    ctx.beginPath();
    ctx.arc(bx + 34, by + bh / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#D4AF6A';
    ctx.fill();
    spacedText(ctx, `已 解 锁 新 主 题 · ${unlockedSkin.name}`, cx + 10, by + bh / 2 + 8, 22, '#E8C98A', 4, 600);
  }

  // ── 按钮组：金主按钮（一屏一金，与光迹同源）+ 幽灵/线脚
  //
  //    设计稿：主按钮 331×56 CSS → 662×112（x 22 → 44，满栏不是内缩），
  //    次按钮两枚 (331−10)/2 = 160.5 → 321，间隔 10 → 20。
  //
  // 全部通关后没有「下一关」可点了 —— 把主按钮换成「重玩本关」，
  // 免得玩家点了得到一句「已经是最后一关啦」。
  const btnTop = 766; // 设计稿 419 CSS
  const b1: Button = {
    x: 44, y: btnTop, w: DESIGN_W - 88, h: 112,
    label: isAllCleared ? '重 玩 本 关' : '下 一 关', kind: 'primary', id: isAllCleared ? 'retry' : 'next',
  };
  const shareBtn: Button = { x: 44, y: btnTop + 132, w: 321, h: 88, label: '分 享', kind: 'secondary', id: 'share' };
  const skinBtn: Button = { x: 385, y: btnTop + 132, w: 321, h: 88, label: '主 题', kind: 'secondary', id: 'skins' };
  const homeBtn: Button = { x: 44, y: btnTop + 240, w: DESIGN_W - 88, h: 84, label: '返 回 大 厅', kind: 'ghost', id: 'home' };

  // 金主按钮：渐变金面 + 8px 厚底边 + 微光
  {
    const b = b1;
    // 厚底边先画、金面后压：圆角必须与面同半径、高度同 b.h，只下移 8。
    // 早先是 `y + h - 8 / 高 12 / 圆角 6` 的一条扁条，两端方角从 32px 的
    // 圆弧里探出来，成了"按钮下面横着一根线"（和「提示」按钮同一个错）
    ctx.beginPath();
    roundRect(ctx, b.x, b.y + 8, b.w, b.h, 32);
    ctx.fillStyle = '#8A6B3C';
    ctx.fill();

    ctx.save();
    ctx.shadowColor = 'rgba(212,175,106,0.22)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 12;
    ctx.beginPath();
    roundRect(ctx, b.x, b.y, b.w, b.h, 32);
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, '#F2DCA8');
    g.addColorStop(0.82, '#B8945A');
    g.addColorStop(1, '#A9853F');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    spacedText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 11, 30, '#2A2114', 9, 700);
  }
  // 幽灵对按钮
  for (const b of [shareBtn, skinBtn]) {
    ctx.beginPath();
    roundRect(ctx, b.x, b.y, b.w, b.h, 28);
    ctx.fillStyle = 'rgba(22,36,30,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(147,179,162,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    spacedText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 8, 22, '#D5E3D8', 6, 600);
  }
  // 线脚：返回大厅，最低调
  {
    const b = homeBtn;
    ctx.beginPath();
    roundRect(ctx, b.x, b.y, b.w, b.h, 28);
    ctx.fillStyle = 'transparent';
    ctx.fill();
    ctx.strokeStyle = 'rgba(185,178,164,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    spacedText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 8, 21, '#B9B2A4', 6, 500);
  }

  return [b1, shareBtn, skinBtn, homeBtn];
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

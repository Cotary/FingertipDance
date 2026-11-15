/**
 * 主题页 UI —— 一张「主题货架」。
 *
 * ## 这一版和设计稿（05 屏）的关系
 *
 * 设计稿把主题页做成**一张大卡 + 2 列卡片**，没有页签、没有计数胶囊：
 *
 * ```
 * 主题                                    3 / 16 已解锁
 * ┌────────────────────────────────┐
 * │  秘色 · 天青            [使用中] │   ← 使用中 / 装备 / 解锁条件
 * │  默认主题 · ♪ 瓷叩玉磬           │
 * │  六通道全套：棋盘 / 机制 / …     │
 * │  ■ ■ ■ ■ ■                      │
 * └────────────────────────────────┘
 * ┌───────────┐ ┌───────────┐
 * │  预览条   │ │  预览条   │        ← 卡片是**上下结构**：
 * │ 名字      │ │ 名字      │          预览在上、文字在下
 * │ 轴        │ │ 轴        │
 * │ 解锁      │ │ 解锁      │
 * └───────────┘ └───────────┘
 * ```
 *
 * 旧版是「左方图 + 右三行字」的横卡，而且顶上还挂着「经典 / 主题」两个陶土页签、
 * 右上角一颗「10 / 10」计数胶囊 —— 那三样都是黏土工坊时期的遗物：
 * 页签把「皮肤」这个已经不存在的概念又摆回台面，胶囊则和标题重复。
 *
 * ## 为什么卡片是上下结构
 *
 * 横卡的预览只有 88 见方，右边的名字/卖点/解锁三行要挤在 104 高度里，
 * 卖点稍长就会被卡片右边线切断（旧截图里「一张宣纸，墨块是走过的路」直接缺字）。
 * 上下结构里预览条有 264×100，名字那三行各占一行整宽，断字问题自然消失。
 *
 * ## 为什么这一页要能滚动
 *
 * 设计稿摆 6 张卡；真实目录是 1 张经典 + 10 套主题 = 12 张（6 行）。
 * 按设计稿的卡高（252）一屏只放得下 3 行，剩下 3 行必须能滚 ——
 * 否则后六套主题在界面上等于不存在。滚动条不画（设计稿没有），
 * 靠内容被底栏切一半来暗示「下面还有」。
 */
import { DESIGN_W } from '../render/layout';
import type { Button } from './hud';
import { trackedText, trackedTextRight, trackedWidth } from './hud';
import { THEMES, themeById, themeUnlocked, type BoardTheme } from '../render/themes';
import { hasOwnVoice, voiceFor } from '../render/voice';
import { CoverCell, packCell } from '../core/cover/v3/types';
import { THEME, type Theme } from './theme';
import { fillGrain } from '../render/grain';

/**
 * 页面状态。
 *
 * `tab` / `page` / `selected` / `equipped` / `unlocked` 这几个字段是黏土皮肤页的遗留，
 * 现在只由老存档与 `main.ts` 的公共流程读写；界面**只认主题**。
 * 真正的展示源是 `themeSelected / themeEquipped / maxLevel`。
 */
export interface SkinsPageState {
  /** 遗留：黏土皮肤（只用于「经典」盘的色板，不在这一页展示） */
  equipped: string;
  selected: string;
  unlocked: Set<string>;
  page: number;

  /** 当前装备的棋盘主题 id（'' = 经典黏土盘） */
  themeEquipped?: string;
  /** 货架大卡上展示的主题 id */
  themeSelected?: string;
  /** 最高已通关号；里程碑解锁按它判定 */
  maxLevel?: number;
  /** 调试构建：所有主题视为已解锁 */
  themeAllUnlocked?: boolean;
  /** 货架滚动偏移（设计像素） */
  themeScroll?: number;
  /** 货架甩动速度（设计像素 / 毫秒），由 `stepThemeScroll` 衰减 */
  themeFling?: number;
}

// ────────────────────────────── 尺寸 ──────────────────────────────

/**
 * 坐标映射：`x = designCss × 2`、`y = (designCss − 36) × 2`。
 *
 * 减 36 是设计稿顶部那条假状态栏（9:41 / 秘色·天青）—— 真机状态栏在画布之外，
 * 重复画会让整页下移 36 CSS。去掉之后设计与实现的页内元素一一对应。
 */
const PAD = 44;
/** 标题基线：与地图 / 排行同一把尺（设计 h3 顶部 54 CSS → 36，34px 字基线落在 68） */
const HEAD_BASE = 68;

/** 货架大卡（设计 22..353 × 87..233 CSS）。 */
const FEAT = { x: PAD, y: 102, w: DESIGN_W - PAD * 2, h: 292, r: 36 } as const;

/** 卡片网格（设计 22..353 × 247..665，卡 160×132、间距 11）。 */
const SHELF = {
  x: PAD,
  // 设计稿是 422、卡高 264、间距 11 CSS×2；三者一起收一点点，
  // 才放得下三整行（第三行下沿 1213，底栏 1214）
  y: 418,
  w: DESIGN_W - PAD * 2,
  cardW: 320,
  cardH: 253,
  gapX: 22,
  gapY: 18,
  /** 裁剪上界 = 大卡下沿：卡片从展签底下钻出来，不留一条空隙 */
  viewTop: 394,
  /** 裁剪下界 = 底栏上沿：再往下是导航，卡片该被栏体的渐隐吃掉 */
  viewBottom: 1214,
} as const;

/** 卡片内边距与预览条（设计 13/14/12 + 130×52 → 26/28/24 + 264×100）。 */
const CARD = { padX: 30, padTop: 26, prevH: 92, r: 30, prevR: 18 } as const;

// ────────────────────────────── 配色 ──────────────────────────────

/**
 * 这一页的色板是设计稿写死的（不随主题变）。
 *
 * 为什么不跟随 `chrome`：主题页是**货架**，它的底色一旦跟着当前主题走，
 * 玩家换一套主题就有一半卡片的前景色失效 —— 白纸主题会让整页文字消失。
 */
const P = {
  ink: '#E4EDE6',
  inkHi: '#FFF3D6',
  gold: '#D4AF6A',
  goldHi: '#F2DCA8',
  muted: '#7F7A6E',
  jade: '#6E9180',
  cardFill: 'rgba(22,36,30,0.86)',
  cardLine: 'rgba(147,179,162,0.14)',
  featTop: '#1C2E24',
  featBot: '#142219',
  featLine: 'rgba(212,175,106,0.30)',
} as const;

// ────────────────────────────── 入口 ──────────────────────────────

/**
 * 绘制主题页。
 * @param theme 保留参数（本页配色不跟随主题，见 `P`）
 * @returns 可点按钮（装备 / 看广告）
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme = THEME,
): Button[] {
  void theme;

  drawHead(ctx, st);
  const buttons = drawFeatured(ctx, st);
  drawShelf(ctx, st, now);
  return buttons;
}

/** 货架上全部的卡：0 = 经典，1..N = 十套主题。 */
export function shelfCount(): number {
  return THEMES.length + 1;
}

function themeAt(index: number): BoardTheme | undefined {
  return index <= 0 ? undefined : THEMES[index - 1];
}

/** 已解锁主题数（含经典；调试构建全解锁）。 */
export function unlockedThemeCount(st: SkinsPageState): number {
  if (st.themeAllUnlocked) return shelfCount();
  const maxLevel = st.maxLevel ?? 0;
  const ad = new Set<string>();
  return 1 + THEMES.filter((t) => themeUnlocked(t, maxLevel, ad)).length;
}

/** 某个主题是否已解锁。 */
export function isThemeOwned(st: SkinsPageState, theme: BoardTheme): boolean {
  if (st.themeAllUnlocked) return true;
  return themeUnlocked(theme, st.maxLevel ?? 0, new Set());
}

// ────────────────────────────── 标题 ──────────────────────────────

/**
 * 标题行：左「主题」，右「N / M 已解锁」。
 *
 * 右读数与标题**垂直居中**（设计 `.map-head` 是 align-items:center），
 * 不是压在同一条基线上 —— 同基线会让小字看起来掉了半格。
 */
function drawHead(ctx: CanvasRenderingContext2D, st: SkinsPageState): void {
  trackedText(ctx, '主题', PAD + 4, HEAD_BASE, 34, P.ink, 10.88, 600);

  const label = `${unlockedThemeCount(st)} / ${shelfCount()} 已解锁`;
  trackedTextRight(ctx, label, DESIGN_W - PAD - 8, HEAD_BASE - 6, 20, P.muted, 4.4, 500);
}

// ────────────────────────────── 大卡 ──────────────────────────────

/**
 * 货架大卡：当前选中主题的「展签」。
 *
 * 四段信息：使用中金签 / 名字 / 一行状态与音色 / 六通道清单 / 五色签。
 * 设计稿之所以把它做成一张卡而不是列表行，是因为这里是**唯一**能说明
 * 「主题换的不是颜色，是六个通道」的地方 —— 那句话需要一整行。
 */
function drawFeatured(ctx: CanvasRenderingContext2D, st: SkinsPageState): Button[] {
  const { x, y, w, h, r } = FEAT;

  roundRect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x + w * 0.45, y + h);
  g.addColorStop(0, P.featTop);
  g.addColorStop(1, P.featBot);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = P.featLine;
  ctx.lineWidth = 2;
  ctx.stroke();
  fillGrain(ctx, x, y, w, h, 0.05);

  const selId = st.themeSelected ?? '';
  const sel = themeById(selId);
  const equippedId = st.themeEquipped ?? '';
  const isEquipped = equippedId === selId;
  const owned = sel ? isThemeOwned(st, sel) : true;

  const name = sel ? displayName(sel.name) : '经典 · 陶土盘面';
  const state = sel ? themeUnlockLabel(sel) : '内置盘面';
  const detail = sel
    ? hasOwnVoice(sel.id)
      ? `♪ ${voiceFor(sel.id).desc}`
      : sel.tagline
    : '陶土盘 · 木纹 · 陶哨音';

  // 名字（衬线 38 / 字距 9.12，设计 h4 19px + .24em）
  trackedText(ctx, name, x + 46, y + 72, 38, P.inkHi, 9.12, 700);
  trackedText(ctx, `${state} · ${detail}`, x + 46, y + 125, 20, P.muted, 2.4, 500);
  trackedText(
    ctx,
    '六通道全套：棋盘 / 机制 / 路径 / 音效 / 动效 / 触感',
    x + 46,
    y + 163,
    20,
    P.muted,
    2.4,
    500,
  );

  // 五色签（设计 26px / gap 6 → 52 / 12）
  themeSwatches(selIdOf(sel)).forEach((c, i) => {
    roundRect(ctx, x + 46 + i * 64, y + 198, 52, 52, 20);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  // 右上角：状态 / 动作。
  //
  // 两者**占同一个格子、同一个尺寸**：换主题时按钮不该跳位置，
  // 而且这一格是设计稿留给「使用中」的 —— 动作压在同一个位置上，
  // 玩家一眼就知道「按这里换」。
  const chipX = x + w - 34 - 132;
  const chipY = y + 34;
  if (isEquipped) {
    drawGoldChip(ctx, chipX, chipY, 132, 48, '使用中');
    return [];
  }

  if (owned) {
    drawGoldChip(ctx, chipX, chipY, 132, 48, '使用');
    // 热区比视觉大一圈：48 高的金签按起来太细
    return [{
      x: chipX - 18, y: chipY - 14, w: 132 + 36, h: 48 + 28,
      label: '使用', kind: 'primary' as const, id: 'equipTheme',
    }];
  }

  // 未解锁：只写条件，不给假按钮（设计稿这些卡也没有按钮）
  trackedTextRight(ctx, themeUnlockLabel(sel!), x + w - 46, y + h - 58, 22, P.gold, 3.2, 600);
  return [];
}

/** 右上角的金签：既是「使用中」的状态，也是「使用」的动作。 */
function drawGoldChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
): void {
  roundRect(ctx, x, y, w, h, 16);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#E8C87E');
  g.addColorStop(1, P.gold);
  ctx.fillStyle = g;
  ctx.fill();
  const size = 22;
  const tw = trackedWidth(ctx, text, size, 5, 700);
  trackedText(ctx, text, x + (w - tw) / 2, y + h / 2 + 8, size, '#2A2114', 5, 700);
}

/**
 * 展台名。
 *
 * 设计稿的主题名都是「两字 · 两字」（秘色 · 天青 / 玄漆 · 螺钿 / 掐丝 · 珐琅）——
 * 这是瓷器的款识写法，也正好把衬线字的字距撑开。数据里是连写的四字，
 * 这里按两字切开补一个间隔点；名字不是四字就原样返回，不硬切。
 */
function displayName(name: string): string {
  return name.length === 4 ? `${name.slice(0, 2)} · ${name.slice(2)}` : name;
}

/**
 * 五色签。
 *
 * 设计稿画的是盘面的五个关键色（墨绿 / 中绿 / 浅青 / 金 / 朱砂）。
 * 主题没有暴露自己的色板，只有 `chrome` 的界面五色 —— 那就用它，
 * 但要做两件事：**近黑的色要提亮**（`pill` 是 #16241D，直接画在卡上等于少一格），
 * **顺序按「深 → 中 → 亮 → 金」重排**，读起来才像一块料的分层。
 */
function themeSwatches(id: string): string[] {
  const t = themeById(id);
  const raw = t?.chrome
    ? [t.chrome.pill, t.chrome.ghost, t.chrome.fill, t.chrome.primary, t.chrome.ink]
    : ['#1D3A2E', '#4F7A66', '#B8CFC0', '#D4AF6A', '#C04B33'];

  // 按亮度从深到浅排：五格连起来像一块料的分层，而不是随手点的五个颜色。
  // 浅色主题（水墨）的 chrome 五个值全是米色 —— 排序之后那张深墨色会被顶到最前，
  // 这一排才读得出「纸 + 墨」。
  const chips: string[] = [];
  for (const c of raw.map(liftDark)) {
    const l = lumaOf(c);
    if (chips.some((k) => Math.abs(lumaOf(k) - l) < 14)) continue;
    chips.push(c);
  }
  chips.sort((a, b) => lumaOf(a) - lumaOf(b));
  // 去重后不足五格就补主题金的深浅，保持设计稿的五格节奏
  while (chips.length < 5) chips.push(chips.length % 2 ? '#D4AF6A' : '#8A6B3C');
  return chips.slice(0, 5);
}

function lumaOf(color: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return 128;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * 近黑的色提亮到「在卡面（#16241E）上看得出是一块颜色」。
 *
 * 用**乘性提亮**而不是掺白：掺白会把墨绿洗成灰绿（第一版就是五个灰块），
 * 乘法只放大亮度、不改变色相，深墨绿提上来还是深墨绿。
 */
function liftDark(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luma = 0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2];
  const TARGET = 74;
  if (luma >= TARGET) return hex;
  const k = Math.min(2.8, TARGET / Math.max(8, luma));
  const out = ch.map((v) => Math.min(255, Math.round(v * k)));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function selIdOf(sel: BoardTheme | undefined): string {
  return sel ? sel.id : '';
}

/** 解锁标注（真实口径：默认 / 第 N 关；广告档留给后续主题包）。 */
function themeUnlockLabel(t: BoardTheme): string {
  switch (t.unlock.type) {
    case 'free': return '默认主题';
    case 'ad': return '看广告解锁';
    case 'milestone': return `第 ${t.unlock.value} 关解锁`;
  }
}

// ────────────────────────────── 货架 ──────────────────────────────

/**
 * 滚动上限：内容高度 − 可视高度。
 *
 * 可视高度按「网格顶 → 底栏上沿」算，所以最后一张卡的下沿正好能滚到底栏边，
 * 不会出现「永远差一点滚不到最后一行」。
 */
export function shelfMaxScroll(): number {
  const rows = Math.ceil(shelfCount() / 2);
  const contentH = rows * SHELF.cardH + (rows - 1) * SHELF.gapY;
  return Math.max(0, contentH - (SHELF.viewBottom - SHELF.y));
}

export function clampShelfScroll(v: number): number {
  return Math.max(0, Math.min(shelfMaxScroll(), v));
}

/** 第 i 张卡的外框（已减滚动）。 */
export function shelfCardRect(i: number, scroll = 0): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(i / 2);
  const col = i % 2;
  return {
    x: SHELF.x + col * (SHELF.cardW + SHELF.gapX),
    y: SHELF.y + row * (SHELF.cardH + SHELF.gapY) - scroll,
    w: SHELF.cardW,
    h: SHELF.cardH,
  };
}

/** 每帧推进甩动（与地图的衰减同一条曲线：320ms 时间常数）。 */
export function stepThemeScroll(st: SkinsPageState, dt: number): void {
  const v = st.themeFling ?? 0;
  if (Math.abs(v) < 0.01) {
    st.themeFling = 0;
    return;
  }
  const max = shelfMaxScroll();
  const next = (st.themeScroll ?? 0) + v * dt;
  st.themeScroll = Math.max(0, Math.min(max, next));
  st.themeFling = v * Math.exp(-dt / 320);
  if (st.themeScroll <= 0 || st.themeScroll >= max) st.themeFling = 0;
}

/**
 * 卡片网格。
 *
 * 裁剪在 `SHELF.viewBottom` 之前，避免卡片压到底栏文字上 ——
 * 底栏自己有一层向上渐隐，被裁掉的半行正好消在雾里，读起来是「还有」而不是「断了」。
 */
function drawShelf(ctx: CanvasRenderingContext2D, st: SkinsPageState, now: number): void {
  const scroll = st.themeScroll ?? 0;
  const selId = st.themeSelected ?? '';

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, SHELF.viewTop, DESIGN_W, SHELF.viewBottom - SHELF.viewTop);
  ctx.clip();

  for (let i = 0; i < shelfCount(); i++) {
    const r = shelfCardRect(i, scroll);
    // 视野外的卡不必画：12 张卡每张一次 backdrop + 24 格盘面，不便宜
    if (r.y > SHELF.viewBottom + 40 || r.y + r.h < SHELF.viewTop - 40) continue;
    const t = themeAt(i);
    drawCard(ctx, r, t, i === 0 ? '' : t!.id, now, {
      selected: (i === 0 ? '' : t!.id) === selId,
      owned: i === 0 ? true : isThemeOwned(st, t!),
    });
  }

  ctx.restore();

  // 上缘的淡出：滚动之后卡片是从大卡底下「钻出来」的，
  // 没有这层就会看到一条被切断的横边（像少画了半个卡）。
  // 停在顶部时不画 —— 否则第一行会被无端压暗一条。
  if (scroll > 4) {
    // 前 30px 几乎全遮：被切掉的那半张卡连「圆角消失」都不该看见
    const fade = ctx.createLinearGradient(0, SHELF.viewTop, 0, SHELF.viewTop + 88);
    fade.addColorStop(0, 'rgba(14,24,21,1)');
    fade.addColorStop(0.34, 'rgba(14,24,21,0.94)');
    fade.addColorStop(0.7, 'rgba(14,24,21,0.5)');
    fade.addColorStop(1, 'rgba(14,24,21,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, SHELF.viewTop, DESIGN_W, 88);
  }
}

/** 一张货架卡：卡面 → 预览条 → 名字 / 轴 / 解锁。 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  t: BoardTheme | undefined,
  id: string,
  now: number,
  opt: { selected: boolean; owned: boolean },
): void {
  roundRect(ctx, r.x, r.y, r.w, r.h, CARD.r);
  ctx.fillStyle = P.cardFill;
  ctx.fill();
  ctx.strokeStyle = opt.selected ? 'rgba(212,175,106,0.85)' : P.cardLine;
  ctx.lineWidth = opt.selected ? 2.5 : 2;
  ctx.stroke();
  fillGrain(ctx, r.x, r.y, r.w, r.h, 0.045);

  // 预览条：上下结构的第一段，比横卡的方图宽一倍多，盘面细节才看得见
  drawPreview(
    ctx,
    t,
    r.x + CARD.padX,
    r.y + CARD.padTop,
    r.w - CARD.padX * 2,
    CARD.prevH,
    now,
  );

  const left = r.x + CARD.padX;
  const nm = t ? displayName(t.name) : '经典';
  const ax = t ? t.tagline : '陶土 · 线迹';
  const un = t ? themeUnlockLabel(t) : '内置盘面';

  const innerW = r.w - CARD.padX * 2;
  trackedText(ctx, fitText(ctx, nm, innerW, 23, 5.06, opt.selected ? 700 : 600), left, r.y + 166, 23, P.ink, 5.06, opt.selected ? 700 : 600);
  // 卖点会超宽（「厚玻璃叠在一起，一道斜光带横穿」260 装不下）——
  // 截断而不是缩字号：同一列里出现两种字号，读起来像错版。
  trackedText(ctx, fitText(ctx, ax, innerW, 16, 2.88, 500), left, r.y + 199, 16, P.jade, 2.88, 500);
  trackedText(ctx, un, left, r.y + 230, 17, opt.owned ? P.muted : P.gold, 2.72, 600);

  // 未解锁**不压暗**（设计稿也没压）：
  // 把预览盖一层灰，等于告诉玩家「这张卡坏了」；这里要的是「这张盘面长这样，
  // 打到第 200 关就是你的」—— 唯一的区别是底行换成金色关号。

  void id;
}

// ── 预览条 ──

/**
 * 预览用的 8×3 小盘。
 *
 * 为什么不是 4×4：预览条是 264×100 的横带，塞 4 列只占一半宽；
 * 8 列刚好铺满（格 33），蛇形路径也够长，一眼能看出这套主题的「线怎么走」。
 */
const THUMB_COLS = 8;
const THUMB_ROWS = 3;
const THUMB_PATH = [
  0, 1, 2, 3, 4, 5, 6, 7,
  15, 14, 13, 12, 11, 10,
  18, 19, 20, 21, 22, 23,
];
const THUMB_BOARD = { w: THUMB_COLS, h: THUMB_ROWS, grid: buildThumbGrid() };

function buildThumbGrid(): Uint8Array {
  const n = THUMB_COLS * THUMB_ROWS;
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = packCell(CoverCell.BRICK);
  const put = (idx: number, type: number, dir = 0, group = 0) => {
    g[idx] = packCell(type, dir, group);
  };
  put(0, CoverCell.START);
  put(23, CoverCell.END);
  // 机制格子放在路径外：压在路径上会读成「路上的障碍」，而预览要展示的是语法
  put(9, CoverCell.SHARD, 0, 0);
  put(8, CoverCell.ICE);
  put(17, CoverCell.BLOCK);
  return g;
}

const THUMB_STATE = {
  covered: new Set(THUMB_PATH),
  path: THUMB_PATH,
  keysHeld: new Set<number>(),
  shardsGot: new Set<number>(),
  shardNext: 0,
};

/** 能不能画真盘面：霓虹 / 玻璃主题依赖 CanvasPattern 与离屏画布。 */
function canPaintTheme(): boolean {
  return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
}

/** 画预览条：经典盘用黏土砖，主题盘用主题自己的 backdrop + board。 */
function drawPreview(
  ctx: CanvasRenderingContext2D,
  t: BoardTheme | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  now: number,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, CARD.prevR);
  ctx.clip();

  const cell = Math.floor(Math.min(w / THUMB_COLS, h / THUMB_ROWS));
  const bw = cell * THUMB_COLS;
  const bh = cell * THUMB_ROWS;
  const ox = x + Math.round((w - bw) / 2);
  const oy = y + Math.round((h - bh) / 2);

  if (!t) {
    // 经典：陶土砖 + 陶土线（与盘面管线一致的老手感）
    ctx.fillStyle = '#2A211A';
    ctx.fillRect(x, y, w, h);
    for (let gy = 0; gy < THUMB_ROWS; gy++) {
      for (let gx = 0; gx < THUMB_COLS; gx++) {
        const idx = gy * THUMB_COLS + gx;
        const walk = THUMB_PATH.includes(idx);
        ctx.fillStyle = walk ? '#C48A5E' : (gx + gy) % 2 === 0 ? '#E4D3BC' : '#D8C4A8';
        roundRect(ctx, ox + gx * cell + 1, oy + gy * cell + 1, cell - 2, cell - 2, cell * 0.2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#FFF3E2';
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    THUMB_PATH.forEach((idx, k) => {
      const px = ox + (idx % THUMB_COLS) * cell + cell / 2;
      const py = oy + Math.floor(idx / THUMB_COLS) * cell + cell / 2;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  } else {
    if (!canPaintTheme()) {
      // Node 环境（单元测试 / `ui-gallery` 的 SVG 预览）没有 DOM：
      // 霓虹的点阵、玻璃的折射都要 `createPattern` / 离屏画布，
      // 这里退回一块主题底色 —— 反正这个环境也不看像素。
      ctx.fillStyle = t.chrome?.fill ?? '#1B3A5C';
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    t.backdrop(ctx, { x, y, w, h });
    t.board({
      ctx,
      board: THUMB_BOARD,
      layout: { cell, originX: ox, originY: oy, boardW: bw, boardH: bh },
      state: THUMB_STATE,
      now,
      dpr: 2,
    });
  }

  // 上下各压一道暗边：预览条是「窗」，不是「贴纸」
  const shade = ctx.createLinearGradient(0, y, 0, y + h);
  shade.addColorStop(0, 'rgba(8,12,10,0.28)');
  shade.addColorStop(0.22, 'rgba(8,12,10,0)');
  shade.addColorStop(0.8, 'rgba(8,12,10,0)');
  shade.addColorStop(1, 'rgba(8,12,10,0.3)');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

// ────────────────────────────── 拾取 ──────────────────────────────

/** 点到第几张货架卡（0 = 经典）。没点到返回 -1。 */
export function pickThemeChip(x: number, y: number, scroll = 0): number {
  if (y < SHELF.y - 8 || y > SHELF.viewBottom) return -1;
  for (let i = 0; i < shelfCount(); i++) {
    const r = shelfCardRect(i, scroll);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** 卡片序号 → 主题 id（0 = 经典 = 空串）。 */
export function themeIdAt(index: number): string {
  if (index <= 0) return '';
  return THEMES[index - 1]?.id ?? '';
}

/** 超宽就截断加省略号（本页只有卖点会用到）。 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  size: number,
  tracking: number,
  weight: number,
): string {
  if (trackedWidth(ctx, text, size, tracking, weight) <= maxW) return text;
  let out = text;
  while (out.length > 1 && trackedWidth(ctx, `${out}…`, size, tracking, weight) > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/** 圆角矩形（本页多处用到，避免为一处圆角引入整个 board.ts）。 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

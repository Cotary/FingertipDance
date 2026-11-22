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
import { SKINS, paintSkin, type Skin } from '../render/skins';
import { CoverCell, packCell } from '../core/cover/v3/types';
import { THEME, type Theme } from './theme';
import { fillGrain } from '../render/grain';
import { canCreateOffscreenCanvas } from '../platform/offscreen';

/**
 * 页面分段。
 *
 * ## 为什么皮肤要放在主题页里，而不是单开一页
 *
 * 它们回答的是同一个问题：「我的盘面长什么样」。主题换的是整个世界
 * （背景 / 图标 / 音效 / 动线），皮肤只换格子本身的那层material ——
 * 一个粗、一个细，玩家调的时候是连着调的。分成两页，他就会在两页之间来回跳，
 * 却不知道自己在调同一个东西。
 *
 * 分段放在标题下面（不是侧边）：竖屏 750 宽只放得下两段，
 * 横排胶囊和排行榜的页签是同一套语言，玩家不用重新学。
 */
export type SkinsTab = 'themes' | 'skins';

/**
 * 页面状态。
 *
 * `equipped` / `selected` / `page` 是黏土皮肤页的遗留，现在只由老存档与
 * `main.ts` 的公共流程读写；主题那段只认 `themeSelected / themeEquipped / maxLevel`。
 */
export interface SkinsPageState {
  /** 当前分段 */
  tab?: SkinsTab;

  /** 已拥有的棋子皮肤（原始 id 集合，来自 `progress.unlockedSkins`） */
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
  /** 广告解锁的主题 id（服务端 / 本地缓存） */
  unlockedThemes?: Set<string>;
  /** 货架滚动偏移（设计像素） */
  themeScroll?: number;
  /** 货架甩动速度（设计像素 / 毫秒），由 `stepThemeScroll` 衰减 */
  themeFling?: number;
  /** 皮肤网格滚动偏移 */
  skinScroll?: number;
  /** 皮肤网格甩动速度 */
  skinFling?: number;
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

/** 分段胶囊（设计：两枚 98×26 CSS → 196×52）。 */
const TABS = { x: PAD, y: 96, w: 196, h: 52, gap: 14 } as const;

/**
 * 货架大卡（设计 22..353 × 87..233 CSS，往下让出分段那 62 高）。
 *
 * 分包之后整页多了一条分段，所有内容统一下移 62 ——
 * 不是把分段"挤"进大卡顶部：大卡里已经有一块五色签，再压一行胶囊
 * 会把「主题名」挤到视觉第二位。
 */
const FEAT = { x: PAD, y: 164, w: DESIGN_W - PAD * 2, h: 292, r: 36 } as const;

/** 卡片网格（设计 22..353 × 247..665，卡 160×132、间距 11）。 */
const SHELF = {
  x: PAD,
  // 设计稿是 422、卡高 264、间距 11 CSS×2；三者一起收一点点，
  // 才放得下三整行（第三行下沿 1213，底栏 1214）
  y: 480,
  w: DESIGN_W - PAD * 2,
  cardW: 320,
  cardH: 253,
  gapX: 22,
  gapY: 18,
  /** 裁剪上界 = 大卡下沿：卡片从展签底下钻出来，不留一条空隙 */
  viewTop: 456,
  /** 裁剪下界 = 底栏上沿：再往下是导航，卡片该被栏体的渐隐吃掉 */
  viewBottom: 1214,
} as const;

/**
 * 皮肤网格：3 列。
 *
 * 皮肤是"一格材料"，不需要主题卡那么大的预览 —— 2 列 16 张要滚 8 行，
 * 3 列 6 行就到头了。卡高 206 也刚好放下「预览 + 名字 + 状态」三行。
 */
const SKIN_GRID = {
  x: PAD,
  y: 480,
  cardW: 208,
  cardH: 206,
  gapX: 19,
  gapY: 18,
  viewTop: 456,
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
 * 绘制主题 / 皮肤页。
 * @param theme 保留参数（本页配色不跟随主题，见 `P`）
 * @returns 可点按钮（分段 / 装备 / 看视频解锁）
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme = THEME,
): Button[] {
  void theme;

  const tab = st.tab ?? 'themes';
  drawHead(ctx, st, tab);
  const buttons = drawTabRow(ctx, tab);

  if (tab === 'themes') {
    buttons.push(...drawFeatured(ctx, st));
    drawShelf(ctx, st, now);
  } else {
    buttons.push(...drawSkinGrid(ctx, st, now));
  }
  return buttons;
}

/**
 * 货架上全部的卡 —— **就是主题数**，没有"经典"那一张。
 *
 * 早先这里固定多一张 `0 = 经典（空串 = 黏土盘）`，主题从 1 开始。
 * 结果主题页上永远摆着"经典 · 陶土盘面"，而它在玩法上已经不存在
 * （`main.ts` 的经典 `Session` 早下线了，cover 模式是唯一玩法，
 * 黏土盘只是"没有主题"时的兜底渲染）。
 *
 * 现在只有两套真主题，那张卡就纯粹是噪音：玩家点进去看到的是一张
 * 和另外两张风格完全不同的盘，而它并不属于任何"世界"。
 * 默认就是天青（`progressStore` 的 `currentTheme: 'mise'`）。
 */
export function shelfCount(): number {
  return THEMES.length;
}

function themeAt(index: number): BoardTheme | undefined {
  return THEMES[index];
}

/** 已解锁主题数（不再含"经典"；调试构建全解锁）。 */
export function unlockedThemeCount(st: SkinsPageState): number {
  if (st.themeAllUnlocked) return shelfCount();
  const maxLevel = st.maxLevel ?? 0;
  const ad = st.unlockedThemes ?? new Set<string>();
  return THEMES.filter((t) => themeUnlocked(t, maxLevel, ad)).length;
}

/** 某个主题是否已解锁。 */
export function isThemeOwned(st: SkinsPageState, theme: BoardTheme): boolean {
  if (st.themeAllUnlocked) return true;
  return themeUnlocked(theme, st.maxLevel ?? 0, st.unlockedThemes ?? new Set());
}

/**
 * 某个棋子皮肤是否已拥有。
 *
 * 三档来源：
 * - `default`：开局就有（wood / mint），不需要落盘；
 * - 服务端 `unlocked_skins`：里程碑发放与广告解锁都写在这里；
 * - `milestone` 由 `maxLevel` **推导**（服务端漏发时也不会锁着玩家）。
 */
export function isSkinOwned(st: SkinsPageState, skin: Skin): boolean {
  if (skin.unlockType === 'default') return true;
  if (st.unlocked.has(skin.id)) return true;
  if (skin.unlockType === 'milestone') return (st.maxLevel ?? 0) >= skin.unlockValue;
  return false;
}

/** 已拥有皮肤数。 */
export function ownedSkinCount(st: SkinsPageState): number {
  return SKINS.filter((s) => isSkinOwned(st, s)).length;
}

// ────────────────────────────── 标题 ──────────────────────────────

/**
 * 标题行：左标题，右「N / M 已解锁」。
 *
 * 右读数与标题**垂直居中**（设计 `.map-head` 是 align-items:center），
 * 不是压在同一条基线上 —— 同基线会让小字看起来掉了半格。
 */
function drawHead(ctx: CanvasRenderingContext2D, st: SkinsPageState, tab: SkinsTab): void {
  trackedText(ctx, tab === 'themes' ? '主题' : '棋子皮肤', PAD + 4, HEAD_BASE, 34, P.ink, 10.88, 600);

  const label = tab === 'themes'
    ? `${unlockedThemeCount(st)} / ${shelfCount()} 已解锁`
    : `${ownedSkinCount(st)} / ${SKINS.length} 已解锁`;
  trackedTextRight(ctx, label, DESIGN_W - PAD - 8, HEAD_BASE - 6, 20, P.muted, 4.4, 500);
}

/**
 * 分段胶囊。与排行榜页签同一套画法（选中金底暗字）。
 *
 * 两个分段**永远显示**，不按内容隐藏：玩家需要看到"这里还有另一类东西"，
 * 否则皮肤入口等于不存在（这正是它之前的状态）。
 */
function drawTabRow(ctx: CanvasRenderingContext2D, tab: SkinsTab): Button[] {
  const items: Array<{ id: string; label: string; on: boolean }> = [
    { id: 'themeTab', label: '板面主题', on: tab === 'themes' },
    { id: 'skinTab', label: '棋子皮肤', on: tab === 'skins' },
  ];
  return items.map((it, i) => {
    const b: Button = {
      x: TABS.x + i * (TABS.w + TABS.gap),
      y: TABS.y,
      w: TABS.w,
      h: TABS.h,
      label: it.label,
      kind: 'secondary',
      id: it.id,
    };
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    if (it.on) {
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, '#E8CE96');
      g.addColorStop(1, P.gold);
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(22,36,30,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const size = 22;
    const tw = trackedWidth(ctx, it.label, size, 4.4, it.on ? 700 : 400);
    trackedText(
      ctx, it.label, b.x + (b.w - tw) / 2, b.y + b.h / 2 + 8,
      size, it.on ? '#2A2114' : P.muted, 4.4, it.on ? 700 : 400,
    );
    return b;
  });
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

  /**
   * 兜底不再是"经典 · 陶土盘面"，而是**回落到列表第一套**（天青）。
   *
   * 主题页现在只摆真主题，那张"经典"卡已经摘掉；但老存档 / 首次进入时
   * `themeSelected` 可能是空串。这时如果还显示"经典 · 陶土盘面"，
   * 玩家会以为有一张他点不到的卡 —— 名字指向一个货架上不存在的东西。
   *
   * 回落到 `THEMES[0]` 是安全的：它一定存在，而且那是默认主题。
   */
  const fallback = THEMES[0];
  const shown = sel ?? fallback;

  const name = shown ? displayName(shown.name) : '—';
  const state = shown ? themeUnlockLabel(shown) : '—';
  const detail = shown
    ? hasOwnVoice(shown.id)
      ? `♪ ${voiceFor(shown.id).desc}`
      : shown.tagline
    : '';

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
  themeSwatches(selIdOf(shown)).forEach((c, i) => {
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

  // 未解锁：ad 档给真按钮，里程碑档只写条件。
  //
  // ## 为什么 ad 档必须有按钮
  //
  // 文案写着「看广告解锁」，却没有任何可点的地方 —— 玩家会以为按钮没画出来，
  // 一直点那张卡。而现在后台确实能把主题配成 ad 档，
  // 客户端不给入口的话，那个配置永远只是句空话。
  if (shown && shown.unlock.type === 'ad') {
    const bw = 196;
    const bx = x + w - 34 - bw;
    drawGoldChip(ctx, bx, chipY, bw, 48, '看视频解锁');
    return [{
      x: bx - 14, y: chipY - 14, w: bw + 28, h: 48 + 28,
      label: '看视频解锁', kind: 'primary' as const, id: 'unlockThemeAd',
    }];
  }

  if (shown) trackedTextRight(ctx, themeUnlockLabel(shown), x + w - 46, y + h - 58, 22, P.gold, 3.2, 600);
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

  // 主题自己给了五色签就用它：界面五色 ≠ 盘面五色。
  // 鸣沙的界面全是土黄系，从 chrome 派生出来的五格会是一排土黄 ——
  // 而盘面上真正的五个色是石绿 / 朱砂 / 石青 / 沥金 / 壁土
  if (t?.swatches && t.swatches.length >= 3) return [...t.swatches].slice(0, 5);

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
    if (!t) continue;
    drawCard(ctx, r, t, now, {
      selected: t.id === selId,
      owned: isThemeOwned(st, t),
    });
  }

  ctx.restore();

  // 上缘的淡出：滚动之后卡片是从大卡底下「钻出来」的，
  // 没有这层就会看到一条被切断的横边（像少画了半个卡）。
  // 停在顶部时不画 —— 否则第一行会被无端压暗一条。
  drawTopFade(ctx, SHELF.viewTop, scroll);
}

/** 一张货架卡：卡面 → 预览条 → 名字 / 轴 / 解锁。 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  t: BoardTheme,
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
  // 没有兜底：主题页上每一张卡都是真主题（"经典 · 陶土盘面"那张已摘掉）
  const nm = displayName(t.name);
  const ax = t.tagline;
  const un = themeUnlockLabel(t);

  const innerW = r.w - CARD.padX * 2;
  trackedText(ctx, fitText(ctx, nm, innerW, 23, 5.06, opt.selected ? 700 : 600), left, r.y + 166, 23, P.ink, 5.06, opt.selected ? 700 : 600);
  // 卖点会超宽（「厚玻璃叠在一起，一道斜光带横穿」260 装不下）——
  // 截断而不是缩字号：同一列里出现两种字号，读起来像错版。
  trackedText(ctx, fitText(ctx, ax, innerW, 16, 2.88, 500), left, r.y + 199, 16, P.jade, 2.88, 500);
  trackedText(ctx, un, left, r.y + 230, 17, opt.owned ? P.muted : P.gold, 2.72, 600);

  // 未解锁**不压暗**（设计稿也没压）：
  // 把预览盖一层灰，等于告诉玩家「这张卡坏了」；这里要的是「这张盘面长这样，
  // 打到第 200 关就是你的」—— 唯一的区别是底行换成金色关号。
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
  // 小游戏端没有 `document` 也没有 `OffscreenCanvas` 构造器，
  // 但 `wx/tt.createOffscreenCanvas` 是有的 —— 只判前两者会让
  // 小游戏端的主题预览全部退化成一块底色（静默降级，没人会报 bug）
  return canCreateOffscreenCanvas();
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

// ────────────────────────────── 皮肤网格 ──────────────────────────────

/** 皮肤网格的列数。 */
const SKIN_COLS = 3;

/** 皮肤网格内容总行数。 */
function skinRows(): number {
  return Math.ceil(SKINS.length / SKIN_COLS);
}

export function skinMaxScroll(): number {
  const rows = skinRows();
  const contentH = rows * SKIN_GRID.cardH + Math.max(0, rows - 1) * SKIN_GRID.gapY;
  return Math.max(0, contentH - (SKIN_GRID.viewBottom - SKIN_GRID.y));
}

export function clampSkinScroll(v: number): number {
  return Math.max(0, Math.min(skinMaxScroll(), v));
}

/** 第 i 张皮肤卡的外框（已减滚动）。 */
export function skinCardRect(i: number, scroll = 0): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(i / SKIN_COLS);
  const col = i % SKIN_COLS;
  return {
    x: SKIN_GRID.x + col * (SKIN_GRID.cardW + SKIN_GRID.gapX),
    y: SKIN_GRID.y + row * (SKIN_GRID.cardH + SKIN_GRID.gapY) - scroll,
    w: SKIN_GRID.cardW,
    h: SKIN_GRID.cardH,
  };
}

/** 每帧推进皮肤网格的甩动（与货架同一条衰减曲线）。 */
export function stepSkinScroll(st: SkinsPageState, dt: number): void {
  const v = st.skinFling ?? 0;
  if (Math.abs(v) < 0.01) {
    st.skinFling = 0;
    return;
  }
  const max = skinMaxScroll();
  const next = (st.skinScroll ?? 0) + v * dt;
  st.skinScroll = Math.max(0, Math.min(max, next));
  st.skinFling = v * Math.exp(-dt / 320);
  if (st.skinScroll <= 0 || st.skinScroll >= max) st.skinFling = 0;
}

/** 点到第几张皮肤卡。没点到返回 -1。 */
export function pickSkinChip(x: number, y: number, scroll = 0): number {
  if (y < SKIN_GRID.y - 8 || y > SKIN_GRID.viewBottom) return -1;
  for (let i = 0; i < SKINS.length; i++) {
    const r = skinCardRect(i, scroll);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** 皮肤序号 → 皮肤 id。 */
export function skinIdAt(index: number): string {
  return SKINS[index]?.id ?? '';
}

/**
 * 画皮肤网格。
 *
 * ## 为什么每格都画真材质
 *
 * `paintSkin` 是**现成的资产管线**：大理石、拉丝、冰晶、星尘全是程序化纹理。
 * 用一块纯色方块代替预览的话，10 套纹理皮肤在货架上会长得一模一样 ——
 * 玩家没有任何理由为它们看广告。
 */
function drawSkinGrid(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
): Button[] {
  const buttons: Button[] = [];
  const scroll = st.skinScroll ?? 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, SKIN_GRID.viewTop, DESIGN_W, SKIN_GRID.viewBottom - SKIN_GRID.viewTop);
  ctx.clip();

  for (let i = 0; i < SKINS.length; i++) {
    const r = skinCardRect(i, scroll);
    if (r.y > SKIN_GRID.viewBottom + 40 || r.y + r.h < SKIN_GRID.viewTop - 40) continue;
    drawSkinCard(ctx, r, SKINS[i], i, st, now, buttons);
  }

  ctx.restore();
  drawTopFade(ctx, SKIN_GRID.viewTop, scroll);
  return buttons;
}

/** 一张皮肤卡：预览格 → 名字 → 状态 / 看视频。 */
function drawSkinCard(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  skin: Skin,
  index: number,
  st: SkinsPageState,
  now: number,
  buttons: Button[],
): void {
  const owned = isSkinOwned(st, skin);
  const equipped = st.equipped === skin.id;

  roundRect(ctx, r.x, r.y, r.w, r.h, 28);
  ctx.fillStyle = P.cardFill;
  ctx.fill();
  ctx.strokeStyle = equipped ? 'rgba(212,175,106,0.85)' : P.cardLine;
  ctx.lineWidth = equipped ? 2.5 : 2;
  ctx.stroke();

  // 预览：4×2 的小格阵，比一块纯色更能说明"这是格子"
  const px = r.x + 20;
  const py = r.y + 16;
  const pw = r.w - 40;
  const ph = 92;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.clip();
  ctx.fillStyle = '#141F1A';
  ctx.fillRect(px, py, pw, ph);
  const gap = 5;
  const cw = (pw - gap * 3) / 4;
  const ch = (ph - gap) / 2;
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = px + gx * (cw + gap);
      const y = py + gy * (ch + gap);
      paintSkin(ctx, skin, x, y, cw, ch, index + 1, now);
      roundRect(ctx, x, y, cw, ch, Math.min(8, cw * 0.18));
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  const left = r.x + 20;
  const innerW = r.w - 40;
  trackedText(ctx, fitText(ctx, skin.name, innerW, 22, 4.4, 600), left, r.y + 140, 22, P.ink, 4.4, 600);

  if (equipped) {
    trackedText(ctx, '使用中', left, r.y + 176, 18, P.goldHi, 2.88, 600);
    return;
  }

  if (owned) {
    trackedText(ctx, '点击使用', left, r.y + 176, 18, P.muted, 2.88, 500);
    // 整张卡都是热区：皮肤卡的预览占了大半，只有名字能点会很难按
    buttons.push({
      x: r.x, y: r.y, w: r.w, h: r.h,
      label: '使用', kind: 'secondary' as const, id: `skin:${index}`,
    });
    return;
  }

  if (skin.unlockType === 'ad') {
    const bw = innerW;
    const by = r.y + 152;
    drawGoldChip(ctx, left, by, bw, 38, '看视频解锁');
    buttons.push({
      x: left - 8, y: by - 8, w: bw + 16, h: 38 + 16,
      label: '看视频解锁', kind: 'primary' as const, id: `skinAd:${index}`,
    });
    return;
  }

  trackedText(
    ctx,
    skin.unlockType === 'milestone' ? `第 ${skin.unlockValue} 关解锁` : '未解锁',
    left, r.y + 176, 18, P.gold, 2.88, 600,
  );
}

/** 顶部淡出：滚动之后被切掉的那半张卡不能露出硬边。 */
function drawTopFade(ctx: CanvasRenderingContext2D, top: number, scroll: number): void {
  if (scroll <= 4) return;
  const fade = ctx.createLinearGradient(0, top, 0, top + 88);
  fade.addColorStop(0, 'rgba(14,24,21,1)');
  fade.addColorStop(0.34, 'rgba(14,24,21,0.94)');
  fade.addColorStop(0.7, 'rgba(14,24,21,0.5)');
  fade.addColorStop(1, 'rgba(14,24,21,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, top, DESIGN_W, 88);
}

// ────────────────────────────── 拾取 ──────────────────────────────

/** 点到第几张货架卡。没点到返回 -1。 */
export function pickThemeChip(x: number, y: number, scroll = 0): number {
  if (y < SHELF.y - 8 || y > SHELF.viewBottom) return -1;
  for (let i = 0; i < shelfCount(); i++) {
    const r = shelfCardRect(i, scroll);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** 卡片序号 → 主题 id。 */
export function themeIdAt(index: number): string {
  return THEMES[index]?.id ?? '';
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

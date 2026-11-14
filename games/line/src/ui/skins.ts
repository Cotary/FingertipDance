/**
 * 皮肤页 UI —— 「陶艺陈列柜」。
 *
 * 旧版是 3×3 等权色卡网格，读起来像调色盘：九张一样大的卡、六行重复的「点击装备」、
 * 3×3 的色块样品看不出纹理、稀有度（`tier`）在界面上完全不存在。廉价感来自这四条，
 * 不是配色。
 *
 * 这一版换成**单件陈列**：
 * 1. 一件皮肤占一整个深陶展台，用真实棋盘格展示（6×6），纹理才看得见
 * 2. 稀有度从 `tier` + `texture` 推导成 4 档，写在铭牌上 —— 稀缺性必须可见
 * 3. 索引降级成「陶片 + 名字」，状态只用一个选中环表达，不再每张卡写一行字
 * 4. 深陶台面托住彩色皮肤：浅底上十几块彩板会互相打架
 *
 * 交互：点陶片 = 选中（展台切换），点展台上的按钮 = 装备。
 * 旧版是「点卡即装备」，两件事挤在一次点击里，选的过程被跳过了。
 */
import { DESIGN_W } from '../render/layout';
import type { BoardLayout } from '../render/layout';
import { drawButton, type Button } from './hud';
import { SKINS, paletteOf, skinById, paintSkin, type Skin, type SkinPalette } from '../render/skins';
import { THEMES, themeById, themeUnlocked, type BoardTheme, type ThemeState } from '../render/themes';
import { hasOwnVoice, voiceFor } from '../render/voice';
import { CoverCell, DIR, packCell } from '../core/cover/v3/types';
import { THEME, type Theme } from './theme';
import {
  CLAY, CLAY_UI, clayBlock, clayInset, clayLock, clayText,
  rrectPts, tracePts, type ClayColor,
} from './clay';

/** 页签。皮肤只换格子色相，主题连背景 / 图标族 / 路线画法一起换 —— 两层，不是一个列表的两段。 */
export type SkinsTab = 'skin' | 'theme';

export interface SkinsPageState {
  /** 当前装备的皮肤 */
  equipped: string;
  /** 展台上展示的皮肤（点陶片切换，点按钮才真正装备） */
  selected: string;
  /** 已解锁的皮肤 id 集合 */
  unlocked: Set<string>;
  /** 当前页 */
  page: number;

  // ── 主题页签（可选：老调用方不传就当作只有皮肤页） ──

  /** 当前页签，默认 `skin` */
  tab?: SkinsTab;
  /** 当前装备的棋盘主题 id（'' = 不启用，走黏土皮肤管线） */
  themeEquipped?: string;
  /** 展台上展示的主题 id */
  themeSelected?: string;
  /** 最高已通关号；里程碑解锁按它判定 */
  maxLevel?: number;
  /** 调试构建：所有主题视为已解锁（方便在测试环境里试） */
  themeAllUnlocked?: boolean;
}

// ────────────────────────────── 布局 ──────────────────────────────

/** 页边距。整个页面只有这一个对齐基准 —— 标题、展台、铭牌、陶片网格都从它起。 */
const PAD = 52;

const STAGE = { x: PAD, y: 150, w: DESIGN_W - PAD * 2, h: 490 };

/**
 * 展台里的样品板：396 见方（6×6 格，格 66）。
 *
 * 这里**不再是一格一块黏土砖** —— 36 块各自带体积和独立的木纹 / 石纹，
 * 读起来是「一堆石头」。样品该是一整块料，格线只是刻上去的分格。
 */
const SAMPLE = 396;
const SAMPLE_N = 6;
/**
 * 样品板在台面上的垂直位置（相对台顶）。
 *
 * 不给它居中：陈列柜的样品是「摆在下半截」的，上方要留出射灯落下来的空间。
 * 上下等距会读成「一张贴在正中的图」。
 */
const SAMPLE_TOP = 62;

/** 铭牌（稀有度 + 名字）与操作按钮的水平带。 */
const INFO_Y = 686;

/** 陶片索引：4 列 × 2 行。 */
const CHIP_W = 145;
const CHIP_H = 106;
const CHIP_GAP = 24;
const CHIP_COLS = 4;
const CHIP_ROWS = 2;
const CHIP_Y = 776;
/** 陶片 + 名字的整体行高。34 = 名字占的高度，别再压缩 —— 压到 30 名字就贴住下一行陶片 */
const ROW_H = CHIP_H + 34;
const GRID_X = (DESIGN_W - (CHIP_COLS * CHIP_W + (CHIP_COLS - 1) * CHIP_GAP)) / 2;

/** 每页显示数量。 */
export const PER_PAGE = CHIP_COLS * CHIP_ROWS;

// ────────────────────────────── 稀有度 ──────────────────────────────

/**
 * 稀有度分档。
 *
 * 数据里只有 `tier`（free/normal/premium），但「普通档」里既有纯色板也有大理石 / 冰晶，
 * 直接三档会让纹理皮肤和纯色皮肤一个价。所以把 `texture` 也算进来，得到 4 档。
 */
type Rarity = 'basic' | 'fine' | 'rare' | 'legend';

const RARITY_META: Record<Rarity, { label: string; color: string }> = {
  basic: { label: '基础', color: '#8A6F58' },
  fine: { label: '精制', color: '#4F6776' },
  rare: { label: '稀有', color: '#8A6410' },
  legend: { label: '典藏', color: '#A8451F' },
};

function rarityOf(skin: Skin): Rarity {
  if (skin.tier === 'premium') return 'legend';
  if (skin.tier === 'free') return 'basic';
  return skin.texture === 'none' ? 'fine' : 'rare';
}

// ────────────────────────────── 入口 ──────────────────────────────

/**
 * 绘制皮肤页。
 * @param theme 主题参数保留以兼容既有调用（黏土版内部不读它）
 * @returns 按钮列表
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme = THEME,
): Button[] {
  void theme;

  drawHeader(ctx, st);

  if ((st.tab ?? 'skin') === 'theme') return drawThemeTab(ctx, st, now, theme);

  const sel = skinById(st.selected);
  const owned = st.unlocked.has(sel.id);
  const equipped = st.equipped === sel.id;

  drawStage(ctx, sel, now, owned);
  const buttons = drawInfo(ctx, sel, owned, equipped, theme);
  drawChips(ctx, st, now);
  drawPager(ctx, st, theme, buttons);

  return buttons;
}

// ────────────────────────────── 标题 ──────────────────────────────

/**
 * 标题区 = 两个页签 + 计数胶囊。
 *
 * 没有单独的「皮肤」大标题：底部导航已经说明了这一页是什么，
 * 再写一遍标题只是把顶部那一行字重复两次。页签本身就能读作页眉。
 */
function drawHeader(ctx: CanvasRenderingContext2D, st: SkinsPageState): void {
  const tab = st.tab ?? 'skin';

  for (let i = 0; i < TABS.length; i++) {
    const t = TABS[i];
    const on = t.id === tab;
    if (on) {
      clayBlock(ctx, t.x, t.y, t.w, t.h, t.h * 0.5, CLAY.terracotta, 880 + i, {
        depth: 8,
        hi: 0.07,
        jitter: 0.004,
      });
    } else {
      clayInset(ctx, t.x, t.y, t.w, t.h, t.h * 0.5, CLAY.sand, 884 + i, { jitter: 0.003 });
    }
    clayText(ctx, t.label, t.x + t.w / 2, t.y + t.h / 2, 27, {
      weight: on ? 800 : 600,
      fill: on ? '#FFF6E9' : CLAY_UI.inkSoft,
      outline: on ? 'rgba(90,38,16,0.42)' : undefined,
      outlineWidth: on ? 4 : 0,
      emboss: false,
    });
  }

  // 计数胶囊：沙色内凹，右上角
  const w = 132;
  const h = 48;
  const x = DESIGN_W - PAD - w;
  const y = 70;
  clayInset(ctx, x, y, w, h, h / 2, CLAY.sand, 902, { jitter: 0.003 });
  clayText(ctx, tab === 'theme' ? `${unlockedThemeCount(st)} / ${THEMES.length}` : `${st.unlocked.size} / ${SKINS.length}`, x + w / 2, y + h / 2, 22, {
    weight: 700,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
}

/** 页签的几何（绘制与命中都用它，避免两处对不上）。 */
const TABS: Array<{ id: SkinsTab; label: string; x: number; y: number; w: number; h: number }> = [
  { id: 'skin', label: '皮肤', x: PAD, y: 58, w: 172, h: 66 },
  { id: 'theme', label: '棋盘', x: PAD + 186, y: 58, w: 172, h: 66 },
];

/** 点到了哪个页签。 */
export function pickSkinsTab(x: number, y: number): SkinsTab | null {
  for (const t of TABS) {
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t.id;
  }
  return null;
}

/** 已解锁主题数（调试构建全解锁）。 */
function unlockedThemeCount(st: SkinsPageState): number {
  if (st.themeAllUnlocked) return THEMES.length;
  const maxLevel = st.maxLevel ?? 0;
  return THEMES.filter((t) => themeUnlocked(t, maxLevel, new Set())).length;
}

/** 某个主题是否已解锁。 */
export function isThemeOwned(st: SkinsPageState, theme: BoardTheme): boolean {
  if (st.themeAllUnlocked) return true;
  return themeUnlocked(theme, st.maxLevel ?? 0, new Set());
}

// ────────────────────────────── 陈列台 ──────────────────────────────

/**
 * 陈列台的三层框架：台子（凸）→ 内衬（凹）→ 射灯（径向柔光）。
 *
 * 抽出来是因为主题页要用同一座台子 —— 陈列柜是这一页的骨架，
 * 换页签只换台面上的样品，不换柜子。
 *
 * @returns 内衬矩形（放样品的地方）
 */
function drawStageFrame(ctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h } = STAGE;

  clayBlock(ctx, x, y, w, h, 34, CLAY.stage, 700, { depth: 15, hi: 0.055, jitter: 0.004 });

  // 内衬：压进台面的一层，四周留 14px 台沿
  const inX = x + 14;
  const inY = y + 14;
  const inW = w - 28;
  const inH = h - 28;
  // 内衬要比台子再深一档：同色会糊成一块，只剩轮廓线，读不出「凹」
  const DEEP: ClayColor = {
    base: CLAY.stage.dark,
    light: CLAY.stage.base,
    dark: CLAY.stage.shade,
    shade: '#1B120D',
  };
  clayInset(ctx, inX, inY, inW, inH, 24, DEEP, 701, { jitter: 0.003 });

  // 射灯：从内衬顶部正中往下打
  ctx.save();
  tracePts(ctx, rrectPts(inX, inY, inW, inH, 24, 701, 0.003));
  ctx.clip();
  const lamp = ctx.createRadialGradient(DESIGN_W / 2, inY + 10, 0, DESIGN_W / 2, inY + 10, w * 0.66);
  lamp.addColorStop(0, 'rgba(255,238,208,0.30)');
  lamp.addColorStop(0.55, 'rgba(255,238,208,0.08)');
  lamp.addColorStop(1, 'rgba(255,238,208,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(inX, inY, inW, inH);
  ctx.restore();

  return { x: inX, y: inY, w: inW, h: inH };
}

/**
 * 深陶陈列台 + 真棋盘预览。
 *
 * 三层：台子（凸）→ 内衬（凹）→ 射灯（径向柔光）→ 棋盘。
 * 射灯这层不能省：没有它，深色台面是一块死板；有了它，才有「被灯照着的展柜」。
 */
function drawStage(ctx: CanvasRenderingContext2D, skin: Skin, now: number, owned: boolean): void {
  const { y } = STAGE;
  drawStageFrame(ctx);

  // ── 样品板 ──
  // 一整块料 + 刻线，不是 36 块独立小砖。后者每块都有体积和各自的纹理，
  // 读起来是「一堆石头」；样品板才像「一料一证」的陈列。
  const sx = (DESIGN_W - SAMPLE) / 2;
  const sy = y + SAMPLE_TOP;
  const p = paletteOf(skin);
  const cc = skinClay(p);

  // 衬纸：贴在深陶台上的留白边，同时提供投影（样品板本身是平的）
  clayBlock(ctx, sx - 9, sy - 9, SAMPLE + 18, SAMPLE + 18, 27, CLAY.cream, 705, {
    depth: 11,
    hi: 0.05,
    jitter: 0.004,
  });

  // 样品板本身要是一块**有厚度的料**，不是一张平贴的图。
  // 纯色皮肤（薄荷 / 藕粉 / 琥珀）占了皮肤清单的一半，平贴时它们会空成一块色板；
  // 给它黏土的体积，纯色才读作「一块料」。
  // plate: 亮面几乎满幅。常规的「缩到 90%」在 396 上是一块中央亮斑，
  // 纯色皮肤（薄荷 / 藕粉 / 琥珀）会因此比旁边的陶片还平。
  clayBlock(ctx, sx, sy, SAMPLE, SAMPLE, 22, cc, 706, {
    depth: 5,
    hi: 0.016,
    plate: true,
    jitter: 0.003,
  });

  ctx.save();
  tracePts(ctx, rrectPts(sx, sy, SAMPLE, SAMPLE, 22, 706, 0.003));
  ctx.clip();

  // 纹理只画一次 → 木纹 / 石纹是连续的，才像同一块料。
  // 半透明叠在色阶上，全不透明会把黏土的体积抹平成油漆面
  ctx.globalAlpha = 0.52;
  paintSkin(ctx, skin, sx, sy, SAMPLE, SAMPLE, 7, now);
  ctx.globalAlpha = 1;

  // 射灯落在上沿：一条窄亮带
  const topLit = ctx.createLinearGradient(0, sy, 0, sy + 34);
  topLit.addColorStop(0, 'rgba(255,250,238,0.34)');
  topLit.addColorStop(0.5, 'rgba(255,250,238,0.10)');
  topLit.addColorStop(1, 'rgba(255,250,238,0)');
  ctx.fillStyle = topLit;
  ctx.fillRect(sx, sy, SAMPLE, 34);

  // 左上的大面积柔光：黏土不许有高光条，只能靠这种低 alpha 的径向提亮
  const gloss = ctx.createRadialGradient(
    sx + SAMPLE * 0.32, sy + SAMPLE * 0.22, 0,
    sx + SAMPLE * 0.32, sy + SAMPLE * 0.22, SAMPLE * 0.62,
  );
  gloss.addColorStop(0, 'rgba(255,251,240,0.20)');
  gloss.addColorStop(1, 'rgba(255,251,240,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(sx, sy, SAMPLE, SAMPLE);

  // 底部沉一档：料的下半截照不到灯
  const lg = ctx.createLinearGradient(0, sy + SAMPLE * 0.55, 0, sy + SAMPLE);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = lg;
  ctx.fillRect(sx, sy, SAMPLE, SAMPLE);

  // 刻线：暗线 + 下方 1px 亮线，才读作「刻进去」而不是「画上去」
  const step = SAMPLE / SAMPLE_N;
  for (let i = 1; i < SAMPLE_N; i++) {
    const off = i * step;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(sx + off - 1, sy, 2.4, SAMPLE);
    ctx.fillRect(sx, sy + off - 1, SAMPLE, 2.4);
    ctx.fillStyle = 'rgba(255,248,235,0.12)';
    ctx.fillRect(sx + off + 1.4, sy, 1.2, SAMPLE);
    ctx.fillRect(sx, sy + off + 1.4, SAMPLE, 1.2);
  }
  ctx.restore();

  // 未解锁：整块样品压暗，锁压在上面。
  // 不换成灰色 —— 灰样品等于「禁用」，而这里要的是「看得见、拿不到」。
  if (!owned) {
    ctx.fillStyle = 'rgba(20,13,9,0.48)';
    tracePts(ctx, rrectPts(sx, sy, SAMPLE, SAMPLE, 22, 706, 0.003));
    ctx.fill();
    clayLock(ctx, DESIGN_W / 2, sy + SAMPLE / 2, 2.0, CLAY.cream);
  }
}

/** 皮肤纹理铺一块（和棋盘里一致：42% 半透，全不透明会盖掉黏土色阶）。 */
function paintTiled(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  now: number,
): void {
  ctx.save();
  tracePts(ctx, rrectPts(x, y, w, h, 12, seed + 300, 0.005));
  ctx.clip();
  ctx.globalAlpha = 0.42;
  paintSkin(ctx, skin, x, y, w, h, seed, now);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 皮肤调色板 → 黏土四阶。与 `render/board.ts` 的映射保持一致。 */
function skinClay(p: SkinPalette): ClayColor {
  return { base: p.base, light: p.light, dark: p.dark, shade: p.border };
}

// ────────────────────────────── 铭牌 + 操作 ──────────────────────────────

/**
 * 展台下方的铭牌：左「稀有度 + 名字」，右「装备按钮 / 解锁条件」。
 *
 * 铭牌不放进展台，是因为浅底的展签更容易读，也不会把深色台面切成两截。
 */
function drawInfo(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  owned: boolean,
  equipped: boolean,
  theme: Theme,
): Button[] {
  const rar = RARITY_META[rarityOf(skin)];

  // 稀有度：一个菱形 + 两个字。菱形是「品级」的通用符号，比文字更省位
  drawDiamond(ctx, PAD + 7, INFO_Y, 7, rar.color);
  clayText(ctx, rar.label, PAD + 24, INFO_Y, 20, {
    align: 'left',
    weight: 700,
    fill: rar.color,
    outlineWidth: 0,
    emboss: false,
  });

  clayText(ctx, skin.name, PAD, INFO_Y + 44, 42, {
    align: 'left',
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.55)',
    outlineWidth: 5,
  });

  const btnW = 168;
  const btnH = 68;
  const btnX = DESIGN_W - PAD - btnW;
  const btnY = INFO_Y + 8;

  if (equipped) {
    // 使用中：不画按钮，画一块内凹的沙色铭牌。已装备是状态，不是可点的动作
    clayInset(ctx, btnX, btnY, btnW, btnH, 26, CLAY.sand, 910, { jitter: 0.003 });
    clayText(ctx, '使用中', btnX + btnW / 2, btnY + btnH / 2, 26, {
      weight: 700,
      fill: CLAY.mint.shade,
      outlineWidth: 0,
      emboss: false,
    });
    return [];
  }

  if (owned) {
    const b: Button = { x: btnX, y: btnY, w: btnW, h: btnH, label: '装备', kind: 'primary', id: 'equipSkin' };
    drawButton(ctx, b, false, theme);
    return [b];
  }

  if (skin.unlockType === 'ad') {
    const b: Button = { x: btnX, y: btnY, w: btnW, h: btnH, label: '看广告', kind: 'primary', id: 'unlockByAd' };
    drawButton(ctx, b, false, theme);
    return [b];
  }

  // 未解锁且不能立刻拿：只写条件，不给假按钮
  clayText(ctx, unlockLabel(skin), btnX + btnW, INFO_Y + 46, 24, {
    align: 'right',
    weight: 700,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  return [];
}

/** 小菱形（品级标记）。 */
function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.82, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.82, cy);
  ctx.closePath();
  ctx.fill();
}

// ────────────────────────────── 陶片索引 ──────────────────────────────

/**
 * 底部的陶片网格。
 *
 * 每块只承担三件事：露出皮肤、写名字、标出是否选中。
 * 旧版卡片还塞了预览框、状态行、锁、遮罩 —— 九个元素重复九遍，页面就变成表格了。
 */
function drawChips(ctx: CanvasRenderingContext2D, st: SkinsPageState, now: number): void {
  const visible = SKINS.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE);

  visible.forEach((skin, i) => {
    const col = i % CHIP_COLS;
    const row = Math.floor(i / CHIP_COLS);
    const x = GRID_X + col * (CHIP_W + CHIP_GAP);
    const y = CHIP_Y + row * (ROW_H + CHIP_GAP);
    const owned = st.unlocked.has(skin.id);
    const isSel = st.selected === skin.id;

    // 选中：底下垫一块陶土，四周露出 6px 当「托」
    if (isSel) {
      clayBlock(ctx, x - 6, y - 6, CHIP_W + 12, CHIP_H + 12, 28, CLAY.terracotta, 920 + i, {
        depth: 12,
        hi: 0.06,
        jitter: 0.004,
      });
    }

    // 陶片本体：直接铺皮肤色（不是白卡上放预览框 —— 那会变成两层容器）
    const p = paletteOf(skin);
    const cc = skinClay(p);
    clayBlock(ctx, x, y, CHIP_W, CHIP_H, 22, cc, 940 + i, {
      depth: isSel ? 3 : 6,
      hi: 0.10,
      jitter: 0.005,
    });
    paintTiled(ctx, skin, x, y, CHIP_W, CHIP_H, i + 41, now);

    // 未选中压一档：八块同样鲜艳的色片会互相抢，视线没有落点
    if (!isSel) {
      ctx.fillStyle = 'rgba(38,26,18,0.14)';
      tracePts(ctx, rrectPts(x, y, CHIP_W, CHIP_H, 22, 943 + i, 0.004));
      ctx.fill();
    }

    if (!owned) {
      ctx.fillStyle = 'rgba(24,16,12,0.5)';
      tracePts(ctx, rrectPts(x, y, CHIP_W, CHIP_H, 22, 941 + i, 0.004));
      ctx.fill();
      clayLock(ctx, x + CHIP_W / 2, y + CHIP_H / 2, 0.86, CLAY.cream);
    }

    // 名字：选中时用主墨色，未解锁用浅一档
    clayText(ctx, skin.name, x + CHIP_W / 2, y + CHIP_H + 22, 21, {
      weight: isSel ? 800 : 600,
      fill: isSel ? CLAY_UI.ink : owned ? CLAY_UI.inkSoft : 'rgba(120,96,76,0.82)',
      outlineWidth: 0,
      emboss: false,
    });
  });
}

// ────────────────────────────── 翻页 ──────────────────────────────

/**
 * 翻页：页码在左、两个方形箭钮在右。
 * 放在网格外侧而不是压在网格上 —— 压在网格上会遮住最后一块陶片。
 */
function drawPager(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  theme: Theme,
  buttons: Button[],
): void {
  const total = Math.ceil(SKINS.length / PER_PAGE);
  if (total <= 1) return;

  const size = 58;
  const y = CHIP_Y + (CHIP_ROWS - 1) * (ROW_H + CHIP_GAP) + ROW_H + 18;

  clayText(ctx, `${st.page + 1} / ${total}`, PAD, y + size / 2, 22, {
    align: 'left',
    weight: 700,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });

  const right = DESIGN_W - PAD;

  if (st.page > 0) {
    const b: Button = { x: right - size * 2 - 16, y, w: size, h: size, label: '‹', kind: 'ghost', id: 'prevPage' };
    drawButton(ctx, b, false, theme);
    buttons.push(b);
  }
  if (st.page < total - 1) {
    const b: Button = { x: right - size, y, w: size, h: size, label: '›', kind: 'ghost', id: 'nextPage' };
    drawButton(ctx, b, false, theme);
    buttons.push(b);
  }
}

// ────────────────────────────── 拾取 ──────────────────────────────

/** 未解锁皮肤的提示文案。 */
function unlockLabel(skin: Skin): string {
  switch (skin.unlockType) {
    // premium 是唯一还能靠关卡拿到的档位，条件必须写死关号 ——
    // 只写「通关解锁」等于没写，玩家不知道要打到哪儿
    case 'level': return `通关第 ${skin.unlockValue} 关解锁`;
    case 'milestone': return `通关第 ${skin.unlockValue} 关解锁`;
    case 'ad': return '看广告解锁';
    default: return '未开放';
  }
}

/**
 * 判断点击落在哪块陶片上。
 * 命中只产出「选中」，装备由展台上的按钮完成。
 */
export function pickSkinCard(x: number, y: number, st: SkinsPageState): Skin | null {
  const visible = SKINS.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE);

  for (let i = 0; i < visible.length; i++) {
    const col = i % CHIP_COLS;
    const row = Math.floor(i / CHIP_COLS);
    const cx = GRID_X + col * (CHIP_W + CHIP_GAP);
    const cy = CHIP_Y + row * (ROW_H + CHIP_GAP);
    // 名字一起算进热区：文字比色块小，点字也该选中
    if (x >= cx && x <= cx + CHIP_W && y >= cy && y <= cy + ROW_H + 8) {
      return visible[i];
    }
  }
  return null;
}


// ────────────────────────────── 棋盘主题页 ──────────────────────────────

/**
 * 陈列样品：一块 6×6 的假盘面。
 *
 * 为什么不用静态图：主题的价值全在「真实渲染」里 —— 背景、格线、图标族、路线画法
 * 都在渲染器里。截图会随主题改动过期，真渲染不会。
 */
const DEMO_N = 6;

/** 蛇形路线的前 18 格（3 行铺满，剩 3 行留白 —— 一眼看出「铺到一半」）。 */
const DEMO_PATH: number[] = (() => {
  const out: number[] = [];
  for (let y = 0; y < DEMO_N - 3; y++) {
    for (let k = 0; k < DEMO_N; k++) {
      const x = y % 2 === 0 ? k : DEMO_N - 1 - k;
      out.push(y * DEMO_N + x);
    }
  }
  return out;
})();

/** 六种机制各摆一个，缩略图里也能看出「这套主题的图标长什么样」。 */
function buildDemoGrid(): Uint8Array {
  const g = new Uint8Array(DEMO_N * DEMO_N);
  for (let i = 0; i < g.length; i++) g[i] = packCell(CoverCell.BRICK);
  const put = (idx: number, type: number, dir = 0, group = 0) => {
    g[idx] = packCell(type, dir, group);
  };
  put(0, CoverCell.START);
  put(17, CoverCell.END);
  put(4, CoverCell.ONEWAY, DIR.RIGHT);
  put(8, CoverCell.SHARD, 0, 0);
  put(11, CoverCell.ICE);
  put(14, CoverCell.KEY, 0, 0);
  put(16, CoverCell.GATE, 0, 0);
  put(21, CoverCell.BLOCK);
  put(26, CoverCell.PORTAL, 0, 0);
  put(33, CoverCell.PORTAL, 0, 0);
  return g;
}

const DEMO_BOARD = { w: DEMO_N, h: DEMO_N, grid: buildDemoGrid() };

/**
 * 陶片缩略图用的 4×4 小盘。
 *
 * 为什么不是把 6×6 缩小：116px 宽的陶片里塞 6 列，每格只剩 16px ——
 * 图标糊成噪点，格线黏成一片，五块陶片看起来一模一样。
 * 少放两列、把格放大到 25px，才读得出「这套的格子是什么形状」。
 */
const THUMB_N = 4;
const THUMB_BOARD = { w: THUMB_N, h: THUMB_N, grid: buildThumbGrid() };
const THUMB_PATH = [0, 1, 2, 3, 7, 11];

function buildThumbGrid(): Uint8Array {
  const g = new Uint8Array(THUMB_N * THUMB_N);
  for (let i = 0; i < g.length; i++) g[i] = packCell(CoverCell.BRICK);
  const put = (idx: number, type: number, dir = 0, group = 0) => {
    g[idx] = packCell(type, dir, group);
  };
  put(0, CoverCell.START);
  put(11, CoverCell.END);
  put(5, CoverCell.SHARD, 0, 0);
  put(10, CoverCell.ICE);
  put(15, CoverCell.BLOCK);
  return g;
}

const THUMB_STATE: ThemeState = {
  covered: new Set(THUMB_PATH),
  path: THUMB_PATH,
  keysHeld: new Set<number>(),
  shardsGot: new Set<number>(),
  shardNext: 0,
};

const DEMO_STATE: ThemeState = {
  covered: new Set(DEMO_PATH),
  path: DEMO_PATH,
  keysHeld: new Set<number>(),
  shardsGot: new Set<number>(),
  // 第一颗星还亮着：星空 / 冰雕那几套的星形最抓眼，样品要让玩家先看到它
  shardNext: 0,
};

/**
 * 主题页。
 *
 * 结构完全套用皮肤页（展台 → 铭牌 → 陶片），只换了台面上的东西：
 * 皮肤页摆的是「一块料」，主题页摆的是「一整块盘面」。
 * 同一条骨架是有意的 —— 玩家不该为了看外观学两套界面。
 */
function drawThemeTab(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme,
): Button[] {
  const selId = st.themeSelected ?? '';
  const sel = themeById(selId);

  // 「经典」= 不启用主题，摆的是当前黏土皮肤 —— 它就是玩家现在的盘面
  if (sel) drawThemeStage(ctx, sel, now, isThemeOwned(st, sel));
  else drawStage(ctx, skinById(st.equipped), now, true);

  const buttons = drawThemeInfo(ctx, st, sel, theme);
  drawThemeChips(ctx, st, now, selId);
  return buttons;
}

/** 展台里的主题样品：主题自己画底板与背景，这里只负责裁剪。 */
function drawThemeStage(
  ctx: CanvasRenderingContext2D,
  t: BoardTheme,
  now: number,
  owned: boolean,
): void {
  const inner = drawStageFrame(ctx);

  const pad = 12;
  // 缩略图要给「盘沿」留位置。
  //
  // 各主题的盘沿宽约 `cell*0.52`（金缮瓷盘的瓷边、金线的画框都是这个量级），
  // 按 `N*cell + 2*pad` 算出来的 cell 会让盘撑满窗口，四条边被裁掉 ——
  // 预览就变成「一张没有边框的格子图」，玩家看不到这套主题的「器」。
  // 解 `cell*(N + 1.04) = inner` 才是能装下整只盘的尺寸。
  const cell = Math.floor(
    Math.min(
      (inner.w - pad * 2) / (DEMO_N + 1.04),
      (inner.h - pad * 2) / (DEMO_N + 1.04),
    ),
  );
  const bw = cell * DEMO_N;
  const ox = Math.round(inner.x + (inner.w - bw) / 2);
  const oy = Math.round(inner.y + (inner.h - bw) / 2);
  const winX = inner.x + pad;
  const winY = inner.y + pad;
  const winW = inner.w - pad * 2;
  const winH = inner.h - pad * 2;

  ctx.save();
  tracePts(ctx, rrectPts(winX, winY, winW, winH, 16, 708, 0.003));
  ctx.clip();
  // 背景按整个窗口铺，不是按盘面铺 —— 光带 / 罗盘刻度 / 星点本来就是整屏量级的东西，
  // 只铺在盘面大小上会变成一坨局部的杂纹。
  t.backdrop(ctx, { x: inner.x, y: inner.y, w: inner.w, h: inner.h });
  const layout: BoardLayout = { cell, originX: ox, originY: oy, boardW: bw, boardH: bw };
  t.board({ ctx, board: DEMO_BOARD, layout, state: DEMO_STATE, now, dpr: 2 });
  ctx.restore();

  if (!owned) {
    // 不换灰色：灰样品读作「坏了」，这里要的是「看得见、拿不到」
    ctx.save();
    tracePts(ctx, rrectPts(winX, winY, winW, winH, 16, 708, 0.003));
    ctx.fillStyle = 'rgba(12,8,6,0.58)';
    ctx.fill();
    ctx.restore();
    clayLock(ctx, DESIGN_W / 2, inner.y + inner.h / 2, 1.9, CLAY.cream);
  }
}

/** 铭牌：一句话卖点 + 名字 + 右侧的装备 / 解锁条件。 */
function drawThemeInfo(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  sel: BoardTheme | undefined,
  theme: Theme,
): Button[] {
  const equippedId = st.themeEquipped ?? '';
  const isEquipped = sel ? equippedId === sel.id : equippedId === '';
  const owned = sel ? isThemeOwned(st, sel) : true;

  clayText(ctx, sel ? sel.tagline : `经典 · ${skinById(st.equipped).name}`, PAD, INFO_Y, 21, {
    align: 'left',
    weight: 600,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });

  clayText(ctx, sel ? sel.name : '经典棋盘', PAD, INFO_Y + 44, 42, {
    align: 'left',
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.55)',
    outlineWidth: 5,
  });

  // 专属音色的铭牌行。
  //
  // **必须写出来**：音效是这套主题的一半，但玩家在展台上没有任何别的途径知道 ——
  // 「玻璃穹顶的钟声」不点进去听是看不见的。这一行让「八套主题 = 八种声音」
  // 从隐藏卖点变成可见卖点。
  // 位置在名字下方、陶片上方（INFO_Y=686，陶片 900），中间这段本来是空的。
  if (sel && hasOwnVoice(sel.id)) {
    clayText(ctx, `♪ ${voiceFor(sel.id).desc}`, PAD, INFO_Y + 96, 21, {
      align: 'left',
      weight: 600,
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
  }

  const btnW = 168;
  const btnH = 68;
  const btnX = DESIGN_W - PAD - btnW;
  const btnY = INFO_Y + 8;

  if (isEquipped) {
    clayInset(ctx, btnX, btnY, btnW, btnH, 26, CLAY.sand, 930, { jitter: 0.003 });
    clayText(ctx, '使用中', btnX + btnW / 2, btnY + btnH / 2, 26, {
      weight: 700,
      fill: CLAY.mint.shade,
      outlineWidth: 0,
      emboss: false,
    });
    return [];
  }

  if (owned) {
    const b: Button = { x: btnX, y: btnY, w: btnW, h: btnH, label: '装备', kind: 'primary', id: 'equipTheme' };
    drawButton(ctx, b, false, theme);
    return [b];
  }

  // 解锁条件必须写死关号：只写「通关解锁」等于没写
  clayText(ctx, sel ? `通关第 ${sel.unlock.value} 关解锁` : '', btnX + btnW, INFO_Y + 46, 23, {
    align: 'right',
    weight: 700,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  return [];
}

// ── 陶片：九格（经典 + 八套主题），5 列 × 2 行 ──
//
// 单行放不下九块（9×121 + 8×10 = 1169 > 750），而缩小到 72px 之后
// 主题自己的底板、格子、线就全糊成一片色块 —— 陶片必须看得出「这是哪一套」。
// 所以改成两行：每块仍是 121×118（和展台上的样品同一个画法）。
//
// 第二行只有 4 块，**居中排**而不是左对齐：左对齐会在右下角留一个大洞，
// 读作「还差一块没加载」。

const TC_W = 121;
// 118 → 104：两行之后第二行的名字会压到导航条上（实测基线 1192，
// 导航 1214，字底 1202 —— 只差 12px，而导航条上沿还有一道阴影）。
// 高度收 14px 换来 40px 余量，样品仍然是 24px 一格，读得出是哪一套。
const TC_H = 104;
const TC_GAP = 10;
const TC_Y = 878;
const TC_COLS = 5;
/** 行距 = 陶片 + 名字 + 12px 呼吸。名字写不下就等于没有索引 */
const TC_ROW_H = TC_H + 40;
const TC_COUNT = THEMES.length + 1;

/** 第 i 块陶片的位置。 */
function themeChipRect(i: number): { x: number; y: number } {
  const row = Math.floor(i / TC_COLS);
  const col = i % TC_COLS;
  const inRow = Math.min(TC_COLS, TC_COUNT - row * TC_COLS);
  const total = inRow * TC_W + (inRow - 1) * TC_GAP;
  return { x: (DESIGN_W - total) / 2 + col * (TC_W + TC_GAP), y: TC_Y + row * TC_ROW_H };
}

function drawThemeChips(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  selId: string,
): void {
  const names = ['经典', ...THEMES.map((t) => t.name)];

  for (let i = 0; i < names.length; i++) {
    const { x, y } = themeChipRect(i);
    const id = i === 0 ? '' : THEMES[i - 1].id;
    const isSel = selId === id;

    if (isSel) {
      clayBlock(ctx, x - 5, y - 5, TC_W + 10, TC_H + 10, 24, CLAY.terracotta, 950 + i, {
        depth: 12,
        hi: 0.06,
        jitter: 0.004,
      });
    }

    if (i === 0) {
      // 经典：手画一块 4×4 黏土砖盘 + 一条陶土线。
      //
      // 不能只铺一块蓝色 `clayBlock` —— 那读作「一个空的色块」，而不是「一块棋盘」，
      // 和旁边四块一眼能认出是盘面的主题放在一起，它显得像没加载出来。
      clayBlock(ctx, x, y, TC_W, TC_H, 18, CLAY.board, 960, { depth: 6, hi: 0.09, jitter: 0.005 });
      ctx.save();
      tracePts(ctx, rrectPts(x, y, TC_W, TC_H, 18, 960, 0.004));
      ctx.clip();
      const cell = Math.floor(Math.min(TC_W - 10, TC_H - 10) / THUMB_N);
      const bw = cell * THUMB_N;
      const ox = x + Math.round((TC_W - bw) / 2);
      const oy = y + Math.round((TC_H - bw) / 2);
      const rr = cell * 0.18;
      for (let gy = 0; gy < THUMB_N; gy++) {
        for (let gx = 0; gx < THUMB_N; gx++) {
          const idx = gy * THUMB_N + gx;
          const walk = THUMB_PATH.includes(idx);
          const c = walk ? CLAY.terracotta : (gx + gy) % 2 === 0 ? CLAY.board.light : CLAY.board;
          ctx.fillStyle = (c as ClayColor).base;
          roundRectLocal(ctx, ox + gx * cell + 1.5, oy + gy * cell + 1.5, cell - 3, cell - 3, rr);
          ctx.fill();
        }
      }
      // 线：陶土色，沿 THUMB_PATH 的折线（和主题里那条线同一个意思）
      ctx.strokeStyle = '#FFF3E2';
      ctx.lineWidth = Math.max(2, cell * 0.13);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      THUMB_PATH.forEach((idx, k) => {
        const px2 = ox + (idx % THUMB_N) * cell + cell / 2;
        const py2 = oy + Math.floor(idx / THUMB_N) * cell + cell / 2;
        if (k === 0) ctx.moveTo(px2, py2);
        else ctx.lineTo(px2, py2);
      });
      ctx.stroke();
      ctx.restore();
    } else {
      // 其余四块直接渲染同一块样品盘面，只是更小 —— 陶片和展台说的是同一件事
      const t = THEMES[i - 1];
      const cell = Math.floor(Math.min(TC_W - 8, TC_H - 8) / THUMB_N);
      const bw = cell * THUMB_N;
      const ox = x + Math.round((TC_W - bw) / 2);
      const oy = y + Math.round((TC_H - bw) / 2);
      ctx.save();
      tracePts(ctx, rrectPts(x, y, TC_W, TC_H, 18, 962 + i, 0.004));
      ctx.clip();
      t.backdrop(ctx, { x, y, w: TC_W, h: TC_H });
      t.board({
        ctx,
        board: THUMB_BOARD,
        layout: { cell, originX: ox, originY: oy, boardW: bw, boardH: bw },
        state: THUMB_STATE,
        now,
        dpr: 2,
      });
      ctx.restore();
    }

    if (!isSel) {
      ctx.fillStyle = 'rgba(38,26,18,0.16)';
      tracePts(ctx, rrectPts(x, y, TC_W, TC_H, 18, 964 + i, 0.004));
      ctx.fill();
    }

    if (i > 0 && !isThemeOwned(st, THEMES[i - 1])) {
      ctx.fillStyle = 'rgba(14,10,8,0.5)';
      tracePts(ctx, rrectPts(x, y, TC_W, TC_H, 18, 966 + i, 0.004));
      ctx.fill();
      clayLock(ctx, x + TC_W / 2, y + TC_H / 2, 0.72, CLAY.cream);
    }

    clayText(ctx, names[i], x + TC_W / 2, y + TC_H + 22, 21, {
      weight: isSel ? 800 : 600,
      fill: isSel ? CLAY_UI.ink : CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
  }
}

/** 点到第几块陶片（0 = 经典）。没点到返回 -1。 */
export function pickThemeChip(x: number, y: number): number {
  for (let i = 0; i < TC_COUNT; i++) {
    const r = themeChipRect(i);
    if (x >= r.x && x <= r.x + TC_W && y >= r.y && y <= r.y + TC_H + 26) return i;
  }
  return -1;
}

/** 陶片序号 → 主题 id（0 = 经典 = 空串）。 */
export function themeIdAt(index: number): string {
  if (index <= 0) return '';
  return THEMES[index - 1]?.id ?? '';
}

/** 圆角矩形（缩略图专用，避免为一处圆角引入整个 board.ts）。 */
function roundRectLocal(
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

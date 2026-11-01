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
import { drawButton, type Button } from './hud';
import { SKINS, paletteOf, skinById, paintSkin, type Skin, type SkinPalette } from '../render/skins';
import { THEME, type Theme } from './theme';
import {
  CLAY, CLAY_UI, clayBlock, clayInset, clayLock, clayText,
  rrectPts, tracePts, type ClayColor,
} from './clay';

export interface SkinsPageState {
  /** 当前装备的皮肤 */
  equipped: string;
  /** 展台上展示的皮肤（点陶片切换，点按钮才真正装备） */
  selected: string;
  /** 已解锁的皮肤 id 集合 */
  unlocked: Set<string>;
  /** 当前页 */
  page: number;
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

  const sel = skinById(st.selected);
  const owned = st.unlocked.has(sel.id);
  const equipped = st.equipped === sel.id;

  drawHeader(ctx, st);
  drawStage(ctx, sel, now, owned);
  const buttons = drawInfo(ctx, sel, owned, equipped, theme);
  drawChips(ctx, st, now);
  drawPager(ctx, st, theme, buttons);

  return buttons;
}

// ────────────────────────────── 标题 ──────────────────────────────

/**
 * 标题区。
 *
 * 左对齐而不是居中：居中标题 + 居中计数会让顶部变成一条对称的匾额，
 * 左对齐才读作「这一页的页眉」，右端的计数胶囊也才有地方落。
 */
function drawHeader(ctx: CanvasRenderingContext2D, st: SkinsPageState): void {
  clayText(ctx, '皮肤', PAD, 96, 38, {
    align: 'left',
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.5)',
    outlineWidth: 5,
  });

  // 计数胶囊：沙色内凹，右上角
  const w = 132;
  const h = 48;
  const x = DESIGN_W - PAD - w;
  const y = 72;
  clayInset(ctx, x, y, w, h, h / 2, CLAY.sand, 902, { jitter: 0.003 });
  clayText(ctx, `${st.unlocked.size} / ${SKINS.length}`, x + w / 2, y + h / 2, 22, {
    weight: 700,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
}

// ────────────────────────────── 陈列台 ──────────────────────────────

/**
 * 深陶陈列台 + 真棋盘预览。
 *
 * 三层：台子（凸）→ 内衬（凹）→ 射灯（径向柔光）→ 棋盘。
 * 射灯这层不能省：没有它，深色台面是一块死板；有了它，才有「被灯照着的展柜」。
 */
function drawStage(ctx: CanvasRenderingContext2D, skin: Skin, now: number, owned: boolean): void {
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
    case 'level': return `通关第 ${skin.unlockValue} 关解锁`;
    case 'milestone': return `通关 ${skin.unlockValue} 关解锁`;
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


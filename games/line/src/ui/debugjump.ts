/**
 * 调试面板：关卡直达（**仅测试环境**）。
 *
 * ## 为什么需要它
 *
 * 地图页在开发构建下已经能点任意一关（`debugUnlockAll`），
 * 但地图是 1000 关的连续长卷，一屏 16 关 ——
 * 要测第 704 关得先滑过 40 多屏。想对比「第 1 关和第 1000 关的棋盘差多少」
 * 基本不可能，只能靠改代码重启。
 *
 * 这个面板把「抵达某关」压缩成两次点击：输关号 → 进入。
 *
 * ## 三种入口
 *
 * 1. 地图页右上角的「调试」牌子（`map:debugOpen`）；
 * 2. 键盘 `` ` `` 或 `F2` 随时随地呼出（浏览器端）；
 * 3. 面板内的世界胶囊 —— 七个世界边界写在代码里，没人记得住，点一下自动填号。
 *
 * ## 只在调试构建里存在
 *
 * 调用方全部包在 `DEBUG_ENABLED &&` 里，生产构建把整块连同本文件一起 tree-shake 掉。
 * 这不是「藏起来」，是**产出的包里根本没有这段代码**。
 */
import { DESIGN_H, DESIGN_W } from '../render/layout';
import { CLAY, CLAY_FONT, CLAY_UI, clayBlock, clayText, type BackdropBox } from './clay';
import { drawButton, type Button } from './hud';
import { WORLDS } from './mapview';

/** 面板状态（由 `main.ts` 持有）。 */
export interface DebugJumpState {
  /** 是否展开 */
  open: boolean;
  /** 已输入的关号文本（空串 = 没输入） */
  input: string;
  /**
   * `input` 还是「预填值」—— 用户还没动过。
   *
   * 展开时输入框预填当前关（大多数调试就是从这一关出发的），
   * 但**第一次敲数字必须整段替换**，否则想输 71 会得到 171。
   * 触摸端和键盘端共用这个标记，两边行为才一致。
   */
  fresh: boolean;
  /** 展开时间（用于入场动画） */
  openedAt: number;
  /** 底部一行反馈（如「已进入第 12 关」） */
  note: string;
  noteAt: number;
}

/** 建一个关闭状态的面板。 */
export function createDebugJumpState(): DebugJumpState {
  return { open: false, input: '', fresh: false, openedAt: 0, note: '', noteAt: 0 };
}

/**
 * 面板里「输入类」按键的**全部逻辑**（纯函数，直接改传入的 state）。
 *
 * 抽出来的理由：这段有四个边界（越界、空输入、预填替换、夹紧），
 * 埋在 `main.ts` 里就只能靠手点验证，而 `main.ts` 一 import 就顺带起画布和网络。
 * 放在这里可以用 vitest 把边界一次性钉死（见 `test/debugjump.test.ts`）。
 *
 * @param st 面板状态（原地修改）
 * @param id 按键 id（`dj:d:7` / `dj:back` / `dj:w:65` / `dj:enter` …）
 * @param total 总关数
 * @param currentLevel 当前可玩关（预填值与步进基准）
 * @returns 是否应当进入关卡
 */
export function applyDebugJumpInput(
  st: DebugJumpState,
  id: string,
  total: number,
  currentLevel: number,
): boolean {
  if (id === 'dj:clear') { st.input = ''; st.fresh = false; return false; }

  if (id === 'dj:back') {
    // 预填值上按退格 = 整段丢掉（「这一串根本不是我输的」，删一位没有意义）
    st.input = st.fresh ? '' : st.input.slice(0, -1);
    st.fresh = false;
    return false;
  }

  if (id === 'dj:minus' || id === 'dj:plus') {
    const base = Number(st.input) || currentLevel;
    const n = base + (id === 'dj:plus' ? 1 : -1);
    st.input = String(Math.max(1, Math.min(total, n)));
    st.fresh = false;
    return false;
  }

  if (id === 'dj:random') {
    st.input = String(1 + Math.floor(Math.random() * total));
    st.fresh = false;
    return false;
  }

  if (id.startsWith('dj:w:')) {
    st.input = id.slice(5);
    st.fresh = false;
    return false;
  }

  if (id.startsWith('dj:d:')) {
    const next = (st.fresh ? '' : st.input) + id.slice(5);
    st.fresh = false;
    const n = Number(next);
    // 越界就**不接收这一下**，而不是先填进去再报错 ——
    // 输入框里出现一个 9999，还得先删掉才能继续输。
    if (!(n >= 1 && n <= total)) {
      st.note = `只有 1 - ${total} 关`;
      st.noteAt = Date.now();
      return false;
    }
    st.input = next;
    return false;
  }

  return id === 'dj:enter';
}

// ── 布局（设计坐标系 750×1334）──
//
// 垂直排布的依据：面板要能在 375×667 上完整显示。
// 375 屏的缩放是 0.5，板高 996 设计 = 498 CSS，屏幕 667 放得下还有富余。

const PLATE = { x: 56, y: 126, w: 638, h: 996 };
const PAD = 28;
const IX = PLATE.x + PAD;              // 84
const IW = PLATE.w - PAD * 2;          // 582

const ROW_INPUT_Y = 226;               // 输入行
const INPUT_H = 104;

const ROW_WORLD1_Y = 382;
const ROW_WORLD2_Y = 446;
const WORLD_H = 52;
const WORLD_W = 136;
const WORLD_GAP = 12;

const ROW_KEY0_Y = 524;
const KEY_H = 96;
const KEY_W = 184;
const KEY_GAP = 15;
const KEY_ROW_GAP = 14;

const ROW_ENTER_Y = 966;
const ENTER_H = 100;

/**
 * 画面板。
 *
 * @param total 总关数（越界判定用）
 * @param box 实际可视范围（设计坐标）。等比缩放后上下会留几十像素的空白，
 *   那块区域不在 750×1334 里 —— 遮罩只铺设计区的话，上下会漏出两条亮边。
 * @returns 可点击按钮列表
 */
export function drawDebugJump(
  ctx: CanvasRenderingContext2D,
  st: DebugJumpState,
  now: number,
  total: number,
  box?: BackdropBox,
): Button[] {
  const buttons: Button[] = [];
  const num = Number(st.input);
  const valid = st.input.length > 0 && num >= 1 && num <= total;

  // ── 遮罩 ──
  //
  // 0.82 而不是全黑：面板是「盖在游戏上的一层工具」，
  // 底下留一点轮廓，测试才知道自己是从哪一页打开的。
  ctx.fillStyle = 'rgba(42,27,16,0.82)';
  ctx.fillRect(box?.x ?? 0, box?.y ?? 0, box?.w ?? DESIGN_W, box?.h ?? DESIGN_H);

  // ── 板 ──
  clayBlock(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, 40, CLAY.cream, 9410, { depth: 14, hi: 0.06 });

  // 标题
  clayText(ctx, '调试 · 关卡直达', DESIGN_W / 2, PLATE.y + 60, 32, {
    weight: 800,
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });

  // 关闭：右上角。用文字不用 '×' —— 触屏上 × 太薄，手指盖住就找不到了。
  const close: Button = { x: PLATE.x + PLATE.w - 138, y: PLATE.y + 26, w: 110, h: 62, label: '关闭', kind: 'ghost', id: 'dj:close' };
  drawButton(ctx, close, false);
  buttons.push(close);

  // ── 输入行：−  [ 关号 ]  + ──
  const minus: Button = { x: IX, y: ROW_INPUT_Y, w: 86, h: INPUT_H, label: '-', kind: 'secondary', id: 'dj:minus' };
  const plus: Button = { x: IX + IW - 86, y: ROW_INPUT_Y, w: 86, h: INPUT_H, label: '+', kind: 'secondary', id: 'dj:plus' };
  drawDebugKey(ctx, minus, 44, false);
  drawDebugKey(ctx, plus, 44, false);
  buttons.push(minus, plus);

  // 显示区：一道凹槽，读作「这里可以填字」
  const dispX = IX + 100;
  const dispW = IW - 200;
  clayBlock(ctx, dispX, ROW_INPUT_Y, dispW, INPUT_H, 24, CLAY.groove, 9411, { depth: 4, hi: 0 });

  // 光标：输入框有内容时在末尾闪一条竖线，暗示「还能继续按数字」
  const shown = st.input.length > 0 ? st.input : '输入关号';
  const dim = st.input.length === 0;
  clayText(ctx, shown, dispX + dispW / 2, ROW_INPUT_Y + INPUT_H / 2, dim ? 32 : 56, {
    weight: 800,
    fill: dim ? 'rgba(255,246,233,0.42)' : valid ? '#FFF6E9' : CLAY.mustard.light,
    outlineWidth: 0,
    emboss: false,
  });
  // 光标只在**用户真输过**之后才闪：
  // 预填当前关时整个数字是「待替换」的，末尾挂一根光标会让人以为可以往后接。
  if (!dim && !st.fresh && Math.floor(now / 500) % 2 === 0) {
    ctx.save();
    ctx.font = `800 56px ${CLAY_FONT}`;
    const tw = ctx.measureText(shown).width;
    ctx.fillStyle = 'rgba(255,246,233,0.75)';
    ctx.fillRect(dispX + dispW / 2 + tw / 2 + 8, ROW_INPUT_Y + 26, 4, INPUT_H - 52);
    ctx.restore();
  }

  // 副标题：这关在哪
  const sub = valid
    ? `${worldNameOf(num)} · ${worldOf(num).from}-${worldOf(num).to} 关`
    : `1 - ${total} 关之间任意一关`;
  clayText(ctx, sub, DESIGN_W / 2, 358, 22, {
    weight: 600,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });

  // ── 世界胶囊 ──
  //
  // 七个世界的边界（1/13/33/65/153/405/705）没人记得住，做成胶囊点一下就填号。
  // 第八格给「随机」—— 盲测时比翻世界有用。
  const quick: Array<{ label: string; id: string; from: number }> = WORLDS.map((w) => ({
    label: `${w.name} ${w.from}`,
    id: `dj:w:${w.from}`,
    from: w.from,
  }));
  quick.push({ label: '随机', id: 'dj:random', from: -1 });

  quick.forEach((q, i) => {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    const b: Button = {
      x: IX + col * (WORLD_W + WORLD_GAP),
      y: row === 0 ? ROW_WORLD1_Y : ROW_WORLD2_Y,
      w: WORLD_W,
      h: WORLD_H,
      label: q.label,
      kind: 'ghost',
      id: q.id,
    };
    // 已填的关号落在该世界内 → 高亮，让玩家知道自己现在选的是哪个世界
    const on = q.from > 0 && valid && num >= q.from && num <= worldOf(q.from).to;
    drawDebugKey(ctx, b, 24, on);
    buttons.push(b);
  });

  // ── 数字键盘 ──
  const keys: Array<{ label: string; id: string }> = [];
  for (let d = 1; d <= 9; d++) keys.push({ label: String(d), id: `dj:d:${d}` });
  keys.push({ label: '退格', id: 'dj:back' }, { label: '0', id: 'dj:d:0' }, { label: '清空', id: 'dj:clear' });

  keys.forEach((k, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const isFn = k.id === 'dj:back' || k.id === 'dj:clear';
    const b: Button = {
      x: IX + col * (KEY_W + KEY_GAP),
      y: ROW_KEY0_Y + row * (KEY_H + KEY_ROW_GAP),
      w: KEY_W,
      h: KEY_H,
      label: k.label,
      kind: isFn ? 'ghost' : 'secondary',
      id: k.id,
    };
    drawDebugKey(ctx, b, isFn ? 26 : 40, false);
    buttons.push(b);
  });

  // ── 进入 ──
  const enter: Button = {
    x: IX,
    y: ROW_ENTER_Y,
    w: IW,
    h: ENTER_H,
    label: valid ? `进入第 ${num} 关` : '进入',
    kind: 'primary',
    id: 'dj:enter',
  };
  if (valid) drawButton(ctx, enter, false);
  else drawDebugKey(ctx, enter, 32, false);
  buttons.push(enter);

  // ── 底部说明 / 反馈 ──
  const fresh = st.note && now - st.noteAt < 3200;
  clayText(
    ctx,
    fresh ? st.note : '点世界填起始关 · 回车直达 · Esc 关闭',
    DESIGN_W / 2,
    1094,
    18,
    {
      weight: 600,
      fill: fresh ? CLAY.terracotta.dark : CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    },
  );

  return buttons;
}

/** 画一块调试面板里的按键（比 `drawButton` 更朴素、字号可控）。 */
function drawDebugKey(
  ctx: CanvasRenderingContext2D,
  b: Button,
  fs: number,
  on: boolean,
): void {
  const color = on
    ? CLAY.terracotta
    : b.kind === 'primary'
      ? CLAY.terracotta
      : b.kind === 'secondary'
        ? CLAY.mustard
        : CLAY.sand;
  clayBlock(ctx, b.x, b.y, b.w, b.h, Math.min(b.h * 0.42, 26), color, seedOf(b.id), {
    depth: on ? 10 : 7,
    hi: 0.06,
  });
  clayText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, fs, {
    weight: 700,
    fill: b.kind === 'ghost' && !on ? CLAY_UI.ink : '#FFF6E9',
    outline: b.kind === 'ghost' && !on ? undefined : 'rgba(90,38,16,0.45)',
    outlineWidth: b.kind === 'ghost' && !on ? 0 : 3,
    emboss: false,
  });
}

/** 由 id 生成稳定的抖动种子（同一按键每帧长得一样）。 */
function seedOf(id: string): number {
  let s = 0;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 9973;
  return s;
}

/** 某关所属世界。 */
function worldOf(idx: number): { from: number; to: number; name: string } {
  for (const w of WORLDS) if (idx >= w.from && idx <= w.to) return w;
  return WORLDS[WORLDS.length - 1];
}

/** 世界名（不在任何区间时返回「未知」）。 */
function worldNameOf(idx: number): string {
  return worldOf(idx).name;
}

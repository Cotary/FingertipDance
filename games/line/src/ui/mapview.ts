/**
 * 关卡地图页。
 *
 * 蛇形路线 + 七个「世界」。
 *
 * 旧版是一条单列 S 形直线（`x = 中轴 + sin 摆动`），1000 个一模一样的圆点排到底，
 * 一屏只看得到 7 关，而且 `curve.ts` 里分好的 7 段（棋盘 6×6 → 11×11）在地图上
 * 完全没有体现 —— 打第 500 关和打第 50 关看起来是同一条路的第 N 个点。
 *
 * 新版：
 * - 蛇形排布：每行 4 关、左右往返，横向利用率翻倍 → 一屏 15~16 关
 * - 七个世界：边界**对齐到行首**（1/13/33/65/153/405/705，都是 4k+1），
 *   世界之间横插一道「世界门」，门独占一段高度，不和任何一行节点打架
 * - 世界末关插旗、皮肤奖励关（200/500/900）挂钻石，让长线有可数的锚点
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { SKINS } from '../render/skins';
import { drawButton, type Button } from './hud';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayStar, clayText } from './clay';

/** 每行关卡数。4 列 → 一屏能放下 15~16 关。 */
const PER_ROW = 4;

/** 行高（相邻两行节点的垂直间距）。 */
const ROW_H = 248;

/** 世界门独占的额外高度。门插在两行之间，不占任何一行的位置。 */
const GATE_H = 96;

/** 可视区顶部（顶部遮罩以下）。第一行节点中心 = 这个值 + ROW_H/2。 */
const ROUTE_TOP = 210;

/** 可视区底部。下方 76px 留给吸底的「继续」按钮和导航栏。 */
const VIEW_BOTTOM = DESIGN_H - 196;

/** 四列的 x 坐标。最右一列留够半径 40 的节点不出界。 */
const COL_X = [60, 270, 480, 690];

/** 世界：关号区间 + 名字。区间来自 `curve.ts` 的 SEGMENTS，但边界取整到 4k+1。 */
export interface World {
  from: number;
  to: number;
  name: string;
}

/**
 * 七个世界。
 *
 * 边界必须是 4k+1（即 (from-1) 能被 PER_ROW 整除），否则世界门会插在同一行的
 * 两个节点之间，把一行切成两半。原 SEGMENTS 边界是 11/31/61/151/401/701，
 * 这里就近取到 13/33/65/153/405/705，误差 ≤2 关。
 */
export const WORLDS: World[] = [
  { from: 1, to: 12, name: '苗圃' },
  { from: 13, to: 32, name: '石溪' },
  { from: 33, to: 64, name: '苔原' },
  { from: 65, to: 152, name: '熔炉' },
  { from: 153, to: 404, name: '深井' },
  { from: 405, to: 704, name: '云阶' },
  { from: 705, to: 1000, name: '星穹' },
];

/** 罗马数字（世界门序号）。 */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** 门所在的行号（第 2 个世界起，每个世界一道门）。导出供测试校验几何。 */
export const GATE_ROWS: number[] = WORLDS.slice(1).map((w) => (w.from - 1) / PER_ROW);

/** 世界末关（插旗的关号）。 */
const WORLD_ENDS: number[] = WORLDS.map((w) => w.to);

/**
 * 皮肤奖励关。只认 premium —— 普通皮肤已经整体改成广告解锁，
 * 标在地图上会误导成「打这关才有」。
 */
const SKIN_LEVELS: number[] = SKINS
  .filter((s) => s.unlockType === 'milestone' && s.unlockValue > 0)
  .map((s) => s.unlockValue);

/** 地图状态。 */
export interface MapViewState {
  /** 已通过的最高关号 */
  maxLevel: number;
  /** 关卡总数 */
  levelCount: number;
  /** 关号 → 星级（0 表示还没打过） */
  stars: Record<string, number>;
  /** 当前滚动偏移 */
  scrollY: number;
  /** 最大滚动偏移 */
  maxScrollY: number;
  /** 提示气泡文案（为空则不显示） */
  toast: string;
  /** 提示气泡显示起始时间 */
  toastAt: number;
}

/** 到指定行为止，前面插了几道门。 */
function gatesUpTo(row: number): number {
  let n = 0;
  for (const r of GATE_ROWS) if (r <= row) n++;
  return n;
}

/** 第 row 行节点的中心 y（世界坐标，未减 scrollY）。导出供测试校验几何。 */
export function rowCenterY(row: number): number {
  return ROUTE_TOP + ROW_H / 2 + row * ROW_H + gatesUpTo(row) * GATE_H;
}

/** 第 gateIdx 道门的中心 y。正好落在上一行与本行中间。导出供测试校验几何。 */
export function gateCenterY(gateIdx: number): number {
  const row = GATE_ROWS[gateIdx];
  return ROUTE_TOP + row * ROW_H + gateIdx * GATE_H + GATE_H / 2;
}

/** 内容总高度（最后一行底边）。 */
function contentBottom(levelCount: number): number {
  const rows = Math.ceil(levelCount / PER_ROW);
  if (rows <= 0) return ROUTE_TOP;
  return rowCenterY(rows - 1) + ROW_H / 2;
}

/** 创建初始状态。 */
export function createMapState(maxLevel: number, levelCount: number, stars: Record<string, number>): MapViewState {
  return {
    maxLevel,
    levelCount,
    stars,
    scrollY: 0,
    maxScrollY: Math.max(0, contentBottom(levelCount) - VIEW_BOTTOM),
    toast: '',
    toastAt: 0,
  };
}

/**
 * 节点坐标。关号 1-based。
 * 偶数行左→右，奇数行右→左 —— 蛇形折返处两个节点同列，路径是垂直的。
 */
export function mapNodePos(idx: number): { x: number; y: number } {
  const i = idx - 1;
  const row = Math.floor(i / PER_ROW);
  const c = i % PER_ROW;
  const col = row % 2 === 0 ? c : PER_ROW - 1 - c;
  return { x: COL_X[col], y: rowCenterY(row) };
}

/** 关号所属的世界下标。 */
export function worldOf(idx: number): number {
  for (let i = WORLDS.length - 1; i >= 0; i--) if (idx >= WORLDS[i].from) return i;
  return 0;
}

/**
 * 计算可视区内的节点区间。
 * 逐行扫（1000 关 = 250 行），比维护 y→row 反函数简单，开销可忽略。
 */
export function visibleRange(scrollY: number, levelCount: number): { first: number; last: number } {
  const rows = Math.ceil(levelCount / PER_ROW);
  const top = scrollY - ROW_H;
  const bot = scrollY + (VIEW_BOTTOM - ROUTE_TOP) + ROW_H;

  let r0 = -1;
  let r1 = -2;
  for (let r = 0; r < rows; r++) {
    const y = rowCenterY(r);
    if (y >= top && y <= bot) {
      if (r0 < 0) r0 = r;
      r1 = r;
    }
  }
  if (r0 < 0) return { first: 1, last: Math.min(levelCount, PER_ROW) };
  return { first: r0 * PER_ROW + 1, last: Math.min(levelCount, (r1 + 1) * PER_ROW) };
}

/**
 * 判断点击落在哪个关卡节点上。
 * @returns 关号，未命中返回 -1
 */
export function pickMapNode(x: number, y: number, st: MapViewState): number {
  const { first, last } = visibleRange(st.scrollY, st.levelCount);
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    const cy = p.y - st.scrollY;
    const dx = x - p.x;
    const dy = y - cy;
    if (dx * dx + dy * dy <= 40 * 40) return i;
  }
  return -1;
}

/**
 * 让指定关号滚动到可视区中部（进入地图时聚焦当前关用）。
 */
export function scrollToLevel(idx: number): number {
  const y = rowCenterY(Math.floor((idx - 1) / PER_ROW));
  return Math.max(0, y - (VIEW_BOTTOM - ROUTE_TOP) / 2);
}

/**
 * 绘制地图页。
 * @returns 可点击按钮列表
 */
export function drawMapView(ctx: CanvasRenderingContext2D, st: MapViewState, now: number): Button[] {
  const { first, last } = visibleRange(st.scrollY, st.levelCount);

  // ── 路线：嵌进桌面的一道凹槽 + 压上去的黏土条（已走 / 未走两种色） ──
  // 注意：路径点在 moveTo/lineTo 时就按当时的变换定死了，先建路径再 translate 是无效的。
  // 所有垂直偏移必须直接算进坐标（dy 参数）。
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const trace = (from: number, to: number, dy = 0): void => {
    let started = false;
    for (let i = from; i <= to; i++) {
      const p = mapNodePos(i);
      const cy = p.y - st.scrollY + dy;
      if (!started) {
        ctx.moveTo(p.x, cy);
        started = true;
      } else {
        ctx.lineTo(p.x, cy);
      }
    }
  };

  const lastSeg = last + 1;
  // 已走过的最后一段：关号 maxLevel 之后就是没走的路
  const doneSeg = Math.min(lastSeg, st.maxLevel);

  // 凹槽：比桌面深一档，路才像「被按进桌面」
  ctx.beginPath();
  trace(first, lastSeg);
  ctx.strokeStyle = CLAY.sand.shade;
  ctx.lineWidth = 24;
  ctx.stroke();

  // 未走的路：浅棕细线，像还没压实的土（和已走的粗管拉开两档粗细，一眼分得清）
  if (doneSeg < lastSeg) {
    ctx.beginPath();
    trace(Math.max(first, doneSeg), lastSeg);
    ctx.strokeStyle = CLAY.cream.dark;
    ctx.lineWidth = 11;
    ctx.stroke();
  }

  // 已走的路：一条陶土**管**（先画下移 5px 的暗面，再画主色 → 底边露暗）
  if (doneSeg > first) {
    ctx.beginPath();
    trace(first, doneSeg, 5);
    ctx.strokeStyle = CLAY.terracotta.dark;
    ctx.lineWidth = 20;
    ctx.stroke();

    ctx.beginPath();
    trace(first, doneSeg);
    ctx.strokeStyle = CLAY.terracotta.base;
    ctx.lineWidth = 20;
    ctx.stroke();

    // 大范围低 alpha 柔光（黏土不许有高光条，只能这样提亮上缘）
    ctx.beginPath();
    trace(first, doneSeg, -4);
    ctx.strokeStyle = 'rgba(255,246,233,0.24)';
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.restore();

  // ── 世界门（画在路径之上：路径是穿过门的） ──
  for (let gi = 0; gi < GATE_ROWS.length; gi++) {
    const gy = gateCenterY(gi) - st.scrollY;
    if (gy < -GATE_H || gy > VIEW_BOTTOM) continue;
    drawWorldGate(ctx, gi, gy, st);
  }

  // ── 节点 ──
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    drawMapNode(ctx, i, p.x, p.y - st.scrollY, st, now);
  }

  // ── 顶部标题栏：陶土色渐隐遮罩 + 关号胶囊 ──
  // 遮罩：0~150 完全实（盖住滚出去的节点和它下方的星星），150~204 淡出。
  // 星星画在节点下方 54px 处，遮罩只到 150 的话星星会从半透明段透出来，
  // 和「第 37 关」胶囊叠在一起，看起来像胶囊上沾了脏东西。
  const fade = ctx.createLinearGradient(0, 0, 0, 204);
  fade.addColorStop(0, CLAY_UI.bgTop);
  fade.addColorStop(0.82, CLAY_UI.bgTop);
  fade.addColorStop(1, 'rgba(236,217,196,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, DESIGN_W, 204);

  const pw = 240, ph = 64, px = (DESIGN_W - pw) / 2, py = 90;
  const wi = worldOf(st.maxLevel);
  clayBlock(ctx, px, py, pw, ph, ph * 0.5, CLAY.terracotta, 771, { depth: 9, hi: 0.07 });
  clayText(ctx, `第 ${st.maxLevel} 关`, DESIGN_W / 2, py + ph / 2, 32, {
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.5)',
    outlineWidth: 5,
  });

  // 世界名：当前关落在哪个世界，比关号更能定位「我在哪」
  clayText(ctx, `${WORLDS[wi].name} ${WORLDS[wi].from}-${WORLDS[wi].to}`, DESIGN_W / 2, py + ph + 22, 22, {
    weight: 600,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });

  const back: Button = { x: 30, y: 92, w: 96, h: 60, label: '返回', kind: 'ghost', id: 'navHome' };
  drawButton(ctx, back, false);

  // ── 吸底「继续」：地图上最该被点的地方，不该让玩家自己找当前关 ──
  const cbW = 320, cbH = 62;
  const cb: Button = {
    x: (DESIGN_W - cbW) / 2,
    y: VIEW_BOTTOM + 6,
    w: cbW,
    h: cbH,
    label: `继续第 ${st.maxLevel} 关`,
    kind: 'primary',
    id: 'playCurrent',
  };
  drawButton(ctx, cb, false);

  // ── 提示气泡 ──
  if (st.toast && now - st.toastAt < 1800) {
    const alpha = Math.min(1, (1800 - (now - st.toastAt)) / 400);
    ctx.globalAlpha = alpha;
    // 236 而不是 176：顶栏多了一行世界名，气泡压上去会糊成一团。
    // 这里已经在遮罩下方，浮在节点之上是气泡该有的样子
    clayBlock(ctx, DESIGN_W / 2 - 210, 236, 420, 80, 26, CLAY.rose, 772, { depth: 8, hi: 0.06 });
    clayText(ctx, st.toast, DESIGN_W / 2, 276, 26, {
      fill: '#FFF6E9',
      outline: 'rgba(88,24,24,0.45)',
      outlineWidth: 4,
    });
    ctx.globalAlpha = 1;
  }

  return [back, cb];
}

/** 画一道横贯的世界门。 */
function drawWorldGate(
  ctx: CanvasRenderingContext2D,
  gi: number,
  y: number,
  st: MapViewState,
): void {
  const w = WORLDS[gi + 1];
  const gx = 36;
  const gw = DESIGN_W - 72;
  const gh = 76;
  const gy = y - gh / 2;

  // 还没走到这个世界：整块压成深灰蓝，读作「关着」而不是「禁用」——
  // 玩家要能看见前面还有六个世界，只是暂时进不去
  const opened = st.maxLevel + 1 >= w.from;
  const cleared = st.maxLevel >= w.to;

  clayBlock(ctx, gx, gy, gw, gh, 26, opened ? CLAY.stage : CLAY.lockTile, 800 + gi, {
    depth: 10,
    hi: 0.04,
  });

  const ink = opened ? '#FFF6E9' : 'rgba(255,246,233,0.72)';
  const shade = opened ? 'rgba(40,26,16,0.55)' : 'rgba(16,26,36,0.6)';

  // 左：◆ + 罗马序号
  drawDiamond(ctx, gx + 30, y, 9, opened ? CLAY.mustard.base : CLAY.cream.dark);
  clayText(ctx, ROMAN[gi + 1], gx + 76, y, 26, {
    align: 'left',
    weight: 700,
    fill: ink,
    outline: shade,
    outlineWidth: 3,
  });

  // 中：世界名
  clayText(ctx, w.name, gx + 150, y, 34, {
    align: 'left',
    weight: 700,
    fill: ink,
    outline: shade,
    outlineWidth: 4,
  });

  // 右：关号区间 + 进度
  const done = Math.max(0, Math.min(w.to - w.from + 1, st.maxLevel - w.from + 1));
  const right = opened ? `${w.from}-${w.to}` : `${w.from}-${w.to}`;
  clayText(ctx, right, gx + gw - 30, y - 12, 22, {
    align: 'right',
    weight: 600,
    fill: opened ? 'rgba(255,246,233,0.86)' : 'rgba(255,246,233,0.55)',
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, cleared ? '已通关' : `${done} / ${w.to - w.from + 1}`, gx + gw - 30, y + 14, 20, {
    align: 'right',
    weight: 600,
    fill: cleared ? CLAY.mint.light : 'rgba(255,246,233,0.62)',
    outlineWidth: 0,
    emboss: false,
  });
}

/** 画单个地图节点。 */
function drawMapNode(
  ctx: CanvasRenderingContext2D,
  idx: number,
  x: number,
  y: number,
  st: MapViewState,
  now: number,
): void {
  const done = idx <= st.maxLevel && idx !== st.maxLevel;
  const current = idx === st.maxLevel;
  const locked = idx > st.maxLevel;
  const star = st.stars[String(idx)] ?? 0;

  const r = current ? 40 : 34;

  // 当前关：脉冲描边环（黏土不做发光，用「有人在敲这块土」的描边代替）
  if (current) {
    const pulse = (Math.sin(now / 400) + 1) / 2;
    ctx.strokeStyle = `rgba(255,246,233,${(0.30 + pulse * 0.45).toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r + 12 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (locked) {
    // 未解锁：一块深蓝黏土片。比球面/桌面都深，才能读作「压在上面但关着」
    clayDisc(ctx, x, y, r, CLAY.lockTile, 900 + idx, { depth: 3, hi: 0.08 });
    // 不放锁：34px 的圆装不下能读清的挂锁，会变成一个白点。
    // 未解锁的表达交给「更深的底 + 更沉（depth 小）+ 白字」。
    clayText(ctx, String(idx), x, y, 24, {
      weight: 600,
      fill: 'rgba(255,251,243,0.92)',
      outlineWidth: 0,
      emboss: false,
    });
  } else {
    clayDisc(ctx, x, y, r, current ? CLAY.mustard : CLAY.mint, 900 + idx, { depth: 7, hi: 0.16 });

    clayText(ctx, String(idx), x, y, current ? 34 : 28, {
      fill: '#FFF6E9',
      outline: current ? CLAY.mustard.shade : CLAY.mint.shade,
      outlineWidth: current ? 6 : 5,
    });
  }

  // 星级（已通关）
  if (!current && done && star > 0) {
    for (let i = 0; i < 3; i++) {
      const on = i < star;
      clayStar(
        ctx,
        x + (i - 1) * 25,
        y + r + 20,
        11,
        on ? CLAY.mustard : CLAY.sand,
        950 + i,
        { depth: 3, lit: on },
      );
    }
  }

  // 皮肤奖励关：右上角一颗小钻石（只标 premium，普通皮肤是广告解锁的）
  if (SKIN_LEVELS.includes(idx)) {
    drawDiamond(ctx, x + r * 0.78, y - r * 0.72, 10, CLAY.mustard.base);
  }

  // 世界末关：一面小旗（旧版每 10 关一面，1000 关要插 100 面，反而没有重点）
  if (WORLD_ENDS.includes(idx)) {
    drawFlag(ctx, x, y, r, st.maxLevel >= idx);
  }
}

/** 小菱形（品级 / 奖励标记）。 */
function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.78, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.78, cy);
  ctx.closePath();
  ctx.fill();
}

/** 世界末关的小旗。 */
function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, taken: boolean): void {
  const fx = x + (x > DESIGN_W / 2 ? -r - 26 : r + 26);
  ctx.strokeStyle = CLAY.cream.shade;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx, y - 26);
  ctx.lineTo(fx, y + 18);
  ctx.stroke();

  const c = taken ? CLAY.mint : CLAY.rose;
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.moveTo(fx, y - 26);
  ctx.lineTo(fx + 28, y - 16);
  ctx.lineTo(fx, y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.base;
  ctx.beginPath();
  ctx.moveTo(fx, y - 25);
  ctx.lineTo(fx + 26, y - 16);
  ctx.lineTo(fx, y - 8);
  ctx.closePath();
  ctx.fill();
}

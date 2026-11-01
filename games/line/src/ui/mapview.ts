/**
 * 关卡地图页。
 * 陶土桌面 + 一条嵌进桌面的黏土路 + 手捏关号圆片 + 星级 + 锁 + 章节里程碑。
 * 1000 关用虚拟滚动，只渲染可视区附近节点。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayStar, clayText } from './clay';

/** 相邻节点的垂直间距（设计坐标系）。 */
export const NODE_GAP = 132;

/** 路线起点 y。 */
const ROUTE_TOP = 210;

/** 地图可视区底部（导航栏之上）。 */
const VIEW_BOTTOM = DESIGN_H - 120;

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

/** 创建初始状态。 */
export function createMapState(maxLevel: number, levelCount: number, stars: Record<string, number>): MapViewState {
  return {
    maxLevel,
    levelCount,
    stars,
    scrollY: 0,
    maxScrollY: Math.max(0, levelCount * NODE_GAP - (VIEW_BOTTOM - ROUTE_TOP)),
    toast: '',
    toastAt: 0,
  };
}

/**
 * 节点坐标。关号 1-based。
 * x 用 sin 摆动形成 S 形，y 线性递增。
 */
export function mapNodePos(idx: number): { x: number; y: number } {
  const y = ROUTE_TOP + (idx - 1) * NODE_GAP;
  const x = DESIGN_W / 2 + Math.sin((idx - 1) * 0.55) * 200;
  return { x, y };
}

/**
 * 计算可视区内的节点区间（含 1 节点余量）。
 */
export function visibleRange(scrollY: number, levelCount: number): { first: number; last: number } {
  const first = Math.max(1, Math.floor(scrollY / NODE_GAP) - 1);
  const last = Math.min(levelCount, Math.ceil((scrollY + (VIEW_BOTTOM - ROUTE_TOP)) / NODE_GAP) + 1);
  return { first, last };
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
  const p = mapNodePos(idx);
  return Math.max(0, p.y - (VIEW_BOTTOM - ROUTE_TOP) / 2);
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
  ctx.lineWidth = 22;
  ctx.stroke();

  // 未走的路：浅棕，像还没压实的土
  if (doneSeg < lastSeg) {
    ctx.beginPath();
    trace(Math.max(first, doneSeg), lastSeg);
    ctx.strokeStyle = CLAY.cream.dark;
    ctx.lineWidth = 15;
    ctx.stroke();
  }

  // 已走的路：一条陶土条（先画下移 5px 的暗面，再画主色 → 底边露暗）
  if (doneSeg > first) {
    ctx.beginPath();
    trace(first, doneSeg, 5);
    ctx.strokeStyle = CLAY.terracotta.dark;
    ctx.lineWidth = 15;
    ctx.stroke();

    ctx.beginPath();
    trace(first, doneSeg);
    ctx.strokeStyle = CLAY.terracotta.base;
    ctx.lineWidth = 15;
    ctx.stroke();

    // 大范围低 alpha 柔光（黏土不许有高光条，只能这样提亮上缘）
    ctx.beginPath();
    trace(first, doneSeg, -3);
    ctx.strokeStyle = 'rgba(255,246,233,0.22)';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.restore();

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
  clayBlock(ctx, px, py, pw, ph, ph * 0.5, CLAY.terracotta, 771, { depth: 9, hi: 0.07 });
  clayText(ctx, `第 ${st.maxLevel} 关`, DESIGN_W / 2, py + ph / 2, 32, {
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.5)',
    outlineWidth: 5,
  });

  const back: Button = { x: 30, y: 92, w: 96, h: 60, label: '返回', kind: 'ghost', id: 'navHome' };
  drawButton(ctx, back, false);

  // ── 提示气泡 ──
  if (st.toast && now - st.toastAt < 1800) {
    const alpha = Math.min(1, (1800 - (now - st.toastAt)) / 400);
    ctx.globalAlpha = alpha;
    clayBlock(ctx, DESIGN_W / 2 - 210, 176, 420, 80, 26, CLAY.rose, 772, { depth: 8, hi: 0.06 });
    clayText(ctx, st.toast, DESIGN_W / 2, 216, 26, {
      fill: '#FFF6E9',
      outline: 'rgba(88,24,24,0.45)',
      outlineWidth: 4,
    });
    ctx.globalAlpha = 1;
  }

  return [back];
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
    // 未解锁的表达交给「更深 + 更沉（depth 小）+ 灰字」。
    clayText(ctx, String(idx), x, y, 24, {
      weight: 600,
      fill: 'rgba(255,246,233,0.66)',
      outlineWidth: 0,
      emboss: false,
    });
    return;
  }

  clayDisc(ctx, x, y, r, current ? CLAY.mustard : CLAY.mint, 900 + idx, { depth: 7, hi: 0.16 });

  clayText(ctx, String(idx), x, y, current ? 34 : 28, {
    fill: '#FFF6E9',
    outline: current ? CLAY.mustard.shade : CLAY.mint.shade,
    outlineWidth: current ? 6 : 5,
  });

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

  // 章节里程碑：每 10 关一面小旗
  if (idx % 10 === 0) {
    const fx = x + (x > DESIGN_W / 2 ? -r - 30 : r + 30);
    ctx.strokeStyle = CLAY.cream.shade;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx, y - 26);
    ctx.lineTo(fx, y + 18);
    ctx.stroke();
    ctx.fillStyle = CLAY.rose.dark;
    ctx.beginPath();
    ctx.moveTo(fx, y - 26);
    ctx.lineTo(fx + 28, y - 16);
    ctx.lineTo(fx, y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = CLAY.rose.base;
    ctx.beginPath();
    ctx.moveTo(fx, y - 25);
    ctx.lineTo(fx + 26, y - 16);
    ctx.lineTo(fx, y - 8);
    ctx.closePath();
    ctx.fill();
  }
}

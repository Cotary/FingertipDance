/**
 * 关卡地图页。对应参考图 52_2.jpg。
 * 竖向 S 形曲线路径 + 编号节点 + 星级 + 锁 + 章节里程碑。
 * 1000 关用虚拟滚动，只渲染可视区附近节点。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { drawButton, type Button } from './hud';
import { LOBBY_THEME } from './theme';

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
  const t = LOBBY_THEME;

  // 背景
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  // 顶部渐变遮罩（暗示可滚动）
  const fade = ctx.createLinearGradient(0, 0, 0, 160);
  fade.addColorStop(0, t.bg);
  fade.addColorStop(1, 'rgba(238,243,255,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, DESIGN_W, 160);

  const { first, last } = visibleRange(st.scrollY, st.levelCount);

  // ── 路线 ──
  ctx.strokeStyle = 'rgba(61,123,255,0.35)';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let started = false;
  for (let i = first; i <= last + 1; i++) {
    const p = mapNodePos(i);
    const cy = p.y - st.scrollY;
    if (!started) {
      ctx.moveTo(p.x, cy);
      started = true;
    } else {
      ctx.lineTo(p.x, cy);
    }
  }
  ctx.stroke();

  // ── 节点 ──
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    drawMapNode(ctx, i, p.x, p.y - st.scrollY, st, now);
  }

  // ── 顶部标题栏 ──
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, DESIGN_W, 88);
  ctx.fillStyle = t.text;
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`第 ${st.maxLevel} 关`, DESIGN_W / 2, 46);

  const back: Button = { x: 30, y: 22, w: 90, h: 60, label: '返回', kind: 'secondary', id: 'navHome' };
  drawButton(ctx, back, false, t);

  // ── 提示气泡 ──
  if (st.toast && now - st.toastAt < 1800) {
    const alpha = Math.min(1, (1800 - (now - st.toastAt)) / 400);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(34,48,77,0.88)';
    roundRect(ctx, DESIGN_W / 2 - 200, 120, 400, 76, 24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.toast, DESIGN_W / 2, 158);
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
  const t = LOBBY_THEME;
  const done = idx <= st.maxLevel;
  const current = idx === st.maxLevel;
  const locked = !done && !current;
  const star = st.stars[String(idx)] ?? 0;

  const r = current ? 40 : 34;

  // 当前关呼吸光圈
  if (current) {
    const pulse = (Math.sin(now / 400) + 1) / 2;
    ctx.strokeStyle = `rgba(61,123,255,${(0.2 + pulse * 0.4).toFixed(3)})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, y, r + 10 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 底
  ctx.fillStyle = locked ? '#CBD6E8' : done ? t.yellow : '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 描边
  ctx.strokeStyle = current ? t.blue : done ? '#E0A93B' : '#FFFFFF';
  ctx.lineWidth = current ? 5 : 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 关号
  ctx.fillStyle = locked ? '#8494AE' : current ? t.blue : '#7A5A12';
  ctx.font = `600 ${current ? 30 : 26}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(idx), x, y + 1);

  // 未解锁：锁
  if (locked) {
    ctx.fillStyle = '#8494AE';
    roundRect(ctx, x - 7, y - 2, 14, 12, 3);
    ctx.fill();
    ctx.strokeStyle = '#8494AE';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 3, 5, Math.PI, 0);
    ctx.stroke();
  }

  // 星级（已通关）
  if (done && star > 0) {
    drawStars(ctx, x, y + r + 14, star);
  }

  // 章节里程碑：每 10 关一个旗帜
  if (idx % 10 === 0) {
    const fx = x + (x > DESIGN_W / 2 ? -r - 26 : r + 26);
    ctx.strokeStyle = '#8494AE';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, y - 22);
    ctx.lineTo(fx, y + 14);
    ctx.stroke();
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.moveTo(fx, y - 22);
    ctx.lineTo(fx + 22, y - 14);
    ctx.lineTo(fx, y - 6);
    ctx.closePath();
    ctx.fill();
  }
}

/** 画 n 颗星（黄色实心 + 灰色空心）。 */
function drawStars(ctx: CanvasRenderingContext2D, cx: number, cy: number, n: number): void {
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * 22;
    ctx.fillStyle = i < n ? '#FFC93C' : 'rgba(34,48,77,0.18)';
    drawStar(ctx, x, cy, 9);
  }
}

/** 画五角星。 */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

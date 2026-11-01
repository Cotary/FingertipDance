/**
 * 关卡地图页。对应参考图 52_2.jpg。
 * 夜空背景 + 发光糖果路径 + 编号糖果节点 + 星级 + 锁 + 章节里程碑。
 * 1000 关用虚拟滚动，只渲染可视区附近节点。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { drawButton, type Button } from './hud';
import { CANDY } from './theme';
import { candyStar, glass, halo, strokeText } from './draw';

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

  // ── 路线：深色底槽 + 糖果渐变芯 ──
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const trace = (): void => {
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
  };

  ctx.beginPath();
  trace();
  ctx.strokeStyle = 'rgba(8,4,30,0.55)';
  ctx.lineWidth = 18;
  ctx.stroke();

  ctx.beginPath();
  trace();
  const rg = ctx.createLinearGradient(0, 0, 0, VIEW_BOTTOM);
  rg.addColorStop(0, CANDY.green.base);
  rg.addColorStop(0.5, CANDY.blue.base);
  rg.addColorStop(1, CANDY.purple.base);
  ctx.strokeStyle = rg;
  ctx.lineWidth = 13;
  ctx.stroke();

  // 线上的一道细高光（不做白色覆盖，避免把糖果色冲淡）
  ctx.beginPath();
  trace();
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // ── 节点 ──
  for (let i = first; i <= last; i++) {
    const p = mapNodePos(i);
    drawMapNode(ctx, i, p.x, p.y - st.scrollY, st, now);
  }

  // ── 顶部标题栏（渐变遮罩 + 玻璃胶囊） ──
  const fade = ctx.createLinearGradient(0, 0, 0, 132);
  fade.addColorStop(0, 'rgba(10,6,32,0.95)');
  fade.addColorStop(0.55, 'rgba(10,6,32,0.40)');
  fade.addColorStop(1, 'rgba(10,6,32,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, DESIGN_W, 132);

  const pw = 240, ph = 64, px = (DESIGN_W - pw) / 2, py = 90;
  glass(ctx, px, py, pw, ph, ph / 2, { fill: 'rgba(255,255,255,0.14)' });
  strokeText(ctx, `第 ${st.maxLevel} 关`, DESIGN_W / 2, py + ph / 2 + 1, 32, {
    stroke: 'rgba(8,4,30,0.55)',
    strokeWidth: 5,
  });

  const back: Button = { x: 30, y: 92, w: 96, h: 60, label: '返回', kind: 'ghost', id: 'navHome' };
  drawButton(ctx, back, false);

  // ── 提示气泡 ──
  if (st.toast && now - st.toastAt < 1800) {
    const alpha = Math.min(1, (1800 - (now - st.toastAt)) / 400);
    ctx.globalAlpha = alpha;
    glass(ctx, DESIGN_W / 2 - 210, 176, 420, 80, 26, { fill: 'rgba(255,107,107,0.92)', edge: 'rgba(255,255,255,0.6)' });
    strokeText(ctx, st.toast, DESIGN_W / 2, 216, 26, {
      stroke: CANDY.coral.dark,
      strokeWidth: 4,
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

  // 当前关：双层呼吸光环
  if (current) {
    const pulse = (Math.sin(now / 400) + 1) / 2;
    ctx.strokeStyle = `rgba(255,255,255,${(0.25 + pulse * 0.45).toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r + 10 + pulse * 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(126,217,87,${(0.18 + pulse * 0.32).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 22 + pulse * 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (locked) {
    // 未解锁：深紫实心片 + 关号 + 小锁（比纯玻璃片更容易识别为「关卡」）
    ctx.fillStyle = 'rgba(40,30,92,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    strokeText(ctx, String(idx), x, y - 4, 24, {
      weight: 600,
      fill: 'rgba(255,255,255,0.66)',
    });
    const lx = x, ly = y + r * 0.56;
    ctx.fillStyle = 'rgba(255,255,255,0.66)';
    roundRect(ctx, lx - 8, ly - 2, 16, 12, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.66)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(lx, ly - 3, 5.5, Math.PI, 0);
    ctx.stroke();
    return;
  }

  const c = current ? CANDY.green : CANDY.gold;
  halo(ctx, x, y, r * 2.1, current ? 'rgba(126,217,87,0.35)' : 'rgba(255,213,79,0.20)');

  // 厚底边
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.arc(x, y + 6, r, 0, Math.PI * 2);
  ctx.fill();

  // 顶面
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  g.addColorStop(0, c.light);
  g.addColorStop(0.48, c.base);
  g.addColorStop(1, c.base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.22, y - r * 0.48, r * 0.46, r * 0.24, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // 白描边
  ctx.strokeStyle = 'rgba(255,255,255,0.90)';
  ctx.lineWidth = current ? 4 : 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 关号
  strokeText(ctx, String(idx), x, y + 1, current ? 34 : 28, {
    stroke: c.dark,
    strokeWidth: current ? 6 : 5,
  });

  // 星级（已通关）
  if (!current && done && star > 0) {
    for (let i = 0; i < 3; i++) {
      candyStar(ctx, x + (i - 1) * 24, y + r + 18, 10, i < star);
    }
  }

  // 章节里程碑：每 10 关一个糖果旗帜
  if (idx % 10 === 0) {
    const fx = x + (x > DESIGN_W / 2 ? -r - 30 : r + 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx, y - 24);
    ctx.lineTo(fx, y + 16);
    ctx.stroke();
    ctx.fillStyle = CANDY.pink.base;
    ctx.beginPath();
    ctx.moveTo(fx, y - 24);
    ctx.lineTo(fx + 26, y - 15);
    ctx.lineTo(fx, y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * 主页大厅。对应参考图 48_2.jpg。
 * 夜空背景（frame 统一绘制）+ 玩家条 + 糖果星球轨道 + 卫星关卡节点 + 吉祥物 + 大按钮。
 * 全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W } from '../render/layout';
import { roundRect } from '../render/board';
import type { Button } from './hud';
import { CANDY, THEME, type CandyColor } from './theme';
import { glass, halo, jelly, pill, strokeText, font } from './draw';

export { drawAvatar } from './hud';

/** 主页状态。 */
export interface HomePageState {
  /** 已通过的最高关号 */
  maxLevel: number;
  /** 关卡总数 */
  levelCount: number;
  /** 昵称 */
  nickname: string;
  /** 头像 URL（空则程序化生成） */
  avatar: string;
  /** 已解锁皮肤数 */
  skinCount: number;
  /** 皮肤总数 */
  totalSkins: number;
}

/** 星球中心坐标与半径。 */
const PLANET = { x: DESIGN_W / 2, y: 540, r: 170 };

/** 轨道定义（半径比、倾角、起始相位、配色）。 */
// k 必须 > 1：k=1.0 时最内圈轨道半径正好等于球半径，节点会半嵌进球面，
// 看起来像球体的一部分而不是卫星。整体外推到 1.14 起，最外圈仍留在 750 宽度内。
const ORBITS = [
  { k: 1.14, tilt: -0.22, phase: 0.0, color: CANDY.green },
  { k: 1.44, tilt: 0.18, phase: 1.1, color: CANDY.orange },
  { k: 1.72, tilt: -0.1, phase: 2.3, color: CANDY.blue },
];

/**
 * 绘制主页大厅。
 * @returns 可点击按钮列表
 */
export function drawHomePage(ctx: CanvasRenderingContext2D, st: HomePageState, now: number): Button[] {
  // ── 顶部玩家条 ──
  drawPlayerBar(ctx, st);

  // ── 星球 + 轨道 + 卫星节点 ──
  drawPlanet(ctx, now);
  drawOrbits(ctx);
  const nodes = satelliteLevels(st);
  for (const n of nodes) drawSatellite(ctx, n, now);

  // ── 吉祥物 + 气泡 ──
  drawMascot(ctx, now, st.maxLevel);

  // ── 进度条 ──
  const ratio = st.levelCount > 0 ? Math.min(1, st.maxLevel / st.levelCount) : 0;
  const barX = 60, barY = 994, barW = DESIGN_W - 120, barH = 14;
  // 轨道要比底色亮：深色轨道在夜空上等于隐形
  glass(ctx, barX, barY, barW, barH, barH / 2, {
    fill: 'rgba(255,255,255,0.13)',
    shadow: false,
    inner: false,
  });
  // 1/1000 = 0.1%，阈值不能再卡 0.5%，否则第 1 关的条是空的
  if (ratio > 0) {
    const fillW = Math.max(barH, barW * ratio);
    const g = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    g.addColorStop(0, CANDY.green.base);
    g.addColorStop(0.5, CANDY.blue.base);
    g.addColorStop(1, CANDY.purple.base);
    ctx.fillStyle = g;
    roundRect(ctx, barX, barY, fillW, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    roundRect(ctx, barX + 4, barY + 4, Math.max(0, fillW - 8), barH * 0.30, barH * 0.15);
    ctx.fill();
    // 进度头：早期关卡填充只有十几像素，加一颗白珠才读得出「有进度」
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(barX + fillW - barH / 2, barY + barH / 2, barH * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  strokeText(ctx, `第 ${st.maxLevel} 关`, barX, barY + 44, 22, {
    weight: 600,
    fill: THEME.subText,
    align: 'left',
    baseline: 'top',
  });
  strokeText(ctx, `共 ${st.levelCount} 关`, barX + barW, barY + 44, 22, {
    weight: 600,
    fill: THEME.subText,
    align: 'right',
    baseline: 'top',
  });
  // 百分比贴在进度条上，避免玩家觉得「只有一个小点」
  strokeText(ctx, `${(ratio * 100).toFixed(1)}%`, barX + barW, barY - 16, 20, {
    weight: 600,
    fill: CANDY.green.light,
    align: 'right',
  });

  // ── 大按钮 ──
  const label = st.maxLevel > 1 ? `继续 第 ${st.maxLevel} 关` : '开始游戏';
  const btn: Button = { x: 115, y: 1064, w: DESIGN_W - 230, h: 108, label, kind: 'primary', id: 'homeStart', tone: 'blue' };

  // 按钮背后的暖光，把主行动从夜空里「托」起来
  halo(ctx, btn.x + btn.w / 2, btn.y + btn.h / 2, btn.w * 0.58, 'rgba(79,195,247,0.16)');
  jelly(ctx, btn.x, btn.y, btn.w, btn.h, CANDY.blue, {
    radius: btn.h / 2,
    depth: 10,
    label: btn.label,
    fontSize: 40,
  });

  return [btn];
}

/** 画顶部玩家条。 */
function drawPlayerBar(ctx: CanvasRenderingContext2D, st: HomePageState): void {
  glass(ctx, 28, 40, DESIGN_W - 56, 104, 32, { fill: 'rgba(255,255,255,0.12)' });

  // 头像（内部自己画光晕与描边）
  drawHomeAvatar(ctx, 84, 92, 38, st.nickname);

  // 昵称
  strokeText(ctx, st.nickname || '玩家', 140, 76, 30, {
    align: 'left',
    stroke: 'rgba(8,4,30,0.55)',
    strokeWidth: 5,
  });

  // Lv 徽章
  pill(ctx, 140, 96, 100, 34, CANDY.gold, `Lv.${st.maxLevel}`, 20);

  // 右侧皮肤收集
  const label = `皮肤 ${st.skinCount}/${st.totalSkins}`;
  strokeText(ctx, label, DESIGN_W - 56, 92, 24, {
    weight: 600,
    fill: THEME.subText,
    align: 'right',
  });
}

/** 主页用的头像（带糖果光晕）。 */
function drawHomeAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, name: string): void {
  halo(ctx, cx, cy, r * 1.6, 'rgba(179,136,255,0.40)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, CANDY.blue.base);
  g.addColorStop(1, CANDY.purple.base);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.5, r * 0.55, r * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = font(r * 0.95, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText((name || '玩').slice(0, 1), cx, cy + 1);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** 画糖果星球本体。 */
function drawPlanet(ctx: CanvasRenderingContext2D, now: number): void {
  const { x, y, r } = PLANET;

  // 背光
  halo(ctx, x, y, r * 1.75, 'rgba(79,195,247,0.20)');
  halo(ctx, x, y, r * 1.15, 'rgba(179,136,255,0.18)');

  // 星球底：径向渐变（左上受光，右下入紫）
  // 亮部必须收窄：原来 stop 0 的 #C8F2FF 一路铺到 0.34，整半个球都是雾白，
  // 叠上云带后中心糊成一团。改成亮部只占左上约 1/5，其余走饱和的糖果蓝。
  const g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.44, r * 0.04, x, y, r * 1.02);
  g.addColorStop(0, '#E8FAFF');
  g.addColorStop(0.20, '#8FDBF7');
  g.addColorStop(0.52, '#4FA6EC');
  g.addColorStop(0.80, '#4A63D8');
  g.addColorStop(1, '#3B2C9C');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // 糖果云带（3 条，倾斜，双层）
  // alpha 收薄：0.26/0.15 叠三条会在球心堆出白雾，0.16/0.09 才有「球面上的带」的层次
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.ellipse(x, y + i * r * 0.44, r * 1.02, r * 0.15, -0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // 底部暗面
  const sh = ctx.createLinearGradient(0, y + r * 0.1, 0, y + r);
  sh.addColorStop(0, 'rgba(20,12,70,0)');
  sh.addColorStop(1, 'rgba(20,12,70,0.52)');
  ctx.fillStyle = sh;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  // 高光（会呼吸的柔光斑）——压在左上，不侵入球心
  const pulse = 0.26 + 0.08 * Math.sin(now / 1300);
  ctx.fillStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.42, y - r * 0.46, r * 0.26, r * 0.15, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 贴纸描边 + 内侧细环
  ctx.strokeStyle = 'rgba(255,255,255,0.80)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r - 12, 0, Math.PI * 2);
  ctx.stroke();
}

/** 画三条椭圆轨道。 */
function drawOrbits(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(PLANET.x, PLANET.y);
  for (const o of ORBITS) {
    ctx.save();
    ctx.rotate(o.tilt);
    // 轨道底线
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, PLANET.r * o.k, PLANET.r * o.k * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    // 彩色芯线
    ctx.strokeStyle = o.color.base;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, PLANET.r * o.k, PLANET.r * o.k * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** 一个卫星关卡节点。 */
export interface Satellite {
  level: number;
  x: number;
  y: number;
  state: 'done' | 'current' | 'locked';
}

/**
 * 计算大厅上要显示的卫星关卡节点。
 * 以当前关为中心，向前 3 关 + 向后 2 关，共 6 个。
 */
export function satelliteLevels(st: HomePageState): Satellite[] {
  const out: Satellite[] = [];
  const offsets = [-3, -2, -1, 0, 1, 2];
  for (const off of offsets) {
    const lv = st.maxLevel + off;
    if (lv < 1 || lv > st.levelCount) continue;
    // 均匀分布在 3 条轨道上：每条轨道放 2 个节点，相隔半圈
    const slot = out.length;
    const o = ORBITS[slot % ORBITS.length];
    const lap = Math.floor(slot / ORBITS.length);
    const ang = o.phase + lap * Math.PI;
    const rx = PLANET.r * o.k;
    const ry = PLANET.r * o.k * 0.34;
    const x = PLANET.x + Math.cos(ang) * rx;
    const y = PLANET.y + Math.sin(ang) * ry;
    out.push({
      level: lv,
      x,
      y,
      state: off < 0 ? 'done' : off === 0 ? 'current' : 'locked',
    });
  }
  return out;
}

/** 糖果圆片：厚底边 + 径向渐变 + 顶部高光。 */
function candyDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  c: CandyColor,
  depth: number,
): void {
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.arc(cx, cy + depth, r, 0, Math.PI * 2);
  ctx.fill();

  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, c.light);
  g.addColorStop(0.48, c.base);
  g.addColorStop(1, c.base);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.24, cy - r * 0.46, r * 0.46, r * 0.24, -0.35, 0, Math.PI * 2);
  ctx.fill();
}

/** 画一个卫星关卡节点。 */
function drawSatellite(ctx: CanvasRenderingContext2D, s: Satellite, now: number): void {
  const r = s.state === 'current' ? 36 : 28;

  if (s.state === 'current') {
    // 呼吸光环（两圈）
    const pulse = (Math.sin(now / 380) + 1) / 2;
    ctx.strokeStyle = `rgba(255,255,255,${(0.30 + pulse * 0.45).toFixed(3)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 9 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(126,217,87,${(0.20 + pulse * 0.35).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 20 + pulse * 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (s.state === 'locked') {
    // 未解锁：深紫实心片（在星球上也读得清）+ 关号 + 右下角小锁
    ctx.fillStyle = 'rgba(42,32,96,0.92)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    strokeText(ctx, String(s.level), s.x, s.y - 2, 22, {
      weight: 600,
      fill: 'rgba(255,255,255,0.72)',
    });
    // 小锁
    const lx = s.x, ly = s.y + r * 0.52;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    roundRect(ctx, lx - 7, ly - 2, 14, 11, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(lx, ly - 3, 5, Math.PI, 0);
    ctx.stroke();
    return;
  }

  // 当前关用绿色（呼应主按钮），已通关用金色
  const c = s.state === 'current' ? CANDY.green : CANDY.gold;
  halo(ctx, s.x, s.y, r * 2.0, s.state === 'current' ? 'rgba(126,217,87,0.35)' : 'rgba(255,213,79,0.22)');
  candyDisc(ctx, s.x, s.y, r, c, 5);

  // 白描边
  ctx.strokeStyle = 'rgba(255,255,255,0.90)';
  ctx.lineWidth = s.state === 'current' ? 4 : 3;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 关号
  strokeText(ctx, String(s.level), s.x, s.y + 1, s.state === 'current' ? 30 : 22, {
    stroke: c.dark,
    strokeWidth: s.state === 'current' ? 5 : 4,
  });

  // 已通关：右下角小对勾徽章
  if (s.state === 'done') {
    const bx = s.x + r * 0.72;
    const by = s.y + r * 0.68;
    ctx.fillStyle = CANDY.green.base;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 5, by);
    ctx.lineTo(bx - 1.5, by + 3.5);
    ctx.lineTo(bx + 5, by - 4);
    ctx.stroke();
  }
}

/** 画吉祥物（圆滚滚小角色 + 玻璃气泡）。 */
function drawMascot(ctx: CanvasRenderingContext2D, now: number, maxLevel: number): void {
  const x = 108;
  const baseY = 896;
  const breathe = Math.sin(now / 520) * 6;
  const y = baseY + breathe;
  const r = 48;

  halo(ctx, x, y, r * 2.0, 'rgba(79,195,247,0.28)');

  // 身体：蓝→紫渐变
  const bg = ctx.createLinearGradient(x, y - r, x, y + r);
  bg.addColorStop(0, '#8FD8FF');
  bg.addColorStop(0.55, '#4FA8F0');
  bg.addColorStop(1, '#5A5AD6');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.beginPath();
  ctx.ellipse(x - 15, y - 20, 15, 10, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛：白眼球 + 深瞳 + 小高光（比纯黑点更卡通）
  for (const dx of [-14, 14]) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(x + dx, y - 4, 9, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241A5E';
    ctx.beginPath();
    ctx.ellipse(x + dx + 1, y - 3, 5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x + dx + 3, y - 6, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // 腮红
  ctx.fillStyle = 'rgba(255,107,157,0.55)';
  for (const dx of [-27, 27]) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + 11, 7.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 嘴
  ctx.strokeStyle = '#241A5E';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 9, 10, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();

  // 贴纸描边
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 气泡（宽度按文案长度自适应，避免文字顶出圆角）
  const msg = `加油！第 ${maxLevel} 关`;
  const bh = 78;
  const bw = Math.max(190, msg.length * 25 + 56);
  const bx = 196, by = 800;
  glass(ctx, bx, by, bw, bh, 26, { fill: 'rgba(255,255,255,0.94)', edge: 'rgba(255,255,255,0.9)', inner: false });
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.moveTo(bx + 12, by + bh - 4);
  ctx.lineTo(bx - 10, by + bh + 22);
  ctx.lineTo(bx + 42, by + bh - 4);
  ctx.closePath();
  ctx.fill();
  strokeText(ctx, msg, bx + bw / 2, by + bh / 2, 23, {
    fill: '#2A2270',
  });
}

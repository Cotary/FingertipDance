/**
 * 主页大厅。对应参考图 48_2.jpg。
 * 顶部玩家条 + 星球轨道 + 卫星关卡节点 + 吉祥物 + 大「开始游戏」按钮。
 * 全部 Canvas 绘制，零 DOM。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { drawButton, type Button } from './hud';
import { LOBBY_THEME } from './theme';

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

/** 轨道定义（半径比、倾角、起始相位）。 */
const ORBITS = [
  { k: 1.0, tilt: -0.22, phase: 0.0 },
  { k: 1.34, tilt: 0.18, phase: 1.1 },
  { k: 1.66, tilt: -0.1, phase: 2.3 },
];

/**
 * 绘制主页大厅。
 * @returns 可点击按钮列表
 */
export function drawHomePage(ctx: CanvasRenderingContext2D, st: HomePageState, now: number): Button[] {
  const t = LOBBY_THEME;

  // 背景：上浅下深的竖向渐变 + 装饰星点
  const bg = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
  bg.addColorStop(0, '#DCE8FF');
  bg.addColorStop(0.45, t.bg);
  bg.addColorStop(1, '#E6ECFA');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  drawStars(ctx, now);

  // ── 顶部玩家条 ──
  drawPlayerBar(ctx, st);

  // ── 星球 + 轨道 + 卫星节点 ──
  drawPlanet(ctx, now);
  drawOrbits(ctx, now);
  const nodes = satelliteLevels(st);
  for (const n of nodes) drawSatellite(ctx, n, now);

  // ── 吉祥物 + 气泡 ──
  drawMascot(ctx, now, st.maxLevel);

  // ── 进度条 ──
  const ratio = st.levelCount > 0 ? Math.min(1, st.maxLevel / st.levelCount) : 0;
  const barX = 60, barY = 992, barW = DESIGN_W - 120, barH = 14;
  ctx.fillStyle = 'rgba(34,48,77,0.10)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = t.blue;
    roundRect(ctx, barX, barY, barW * ratio, barH, barH / 2);
    ctx.fill();
  }
  ctx.fillStyle = t.subText;
  ctx.font = '22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`第 ${st.maxLevel} 关`, barX, barY + 26);
  ctx.textAlign = 'right';
  ctx.fillText(`共 ${st.levelCount} 关`, barX + barW, barY + 26);

  // ── 大按钮 ──
  const label = st.maxLevel > 1 ? `继续 第 ${st.maxLevel} 关` : '开始游戏';
  const btn: Button = { x: 115, y: 1064, w: DESIGN_W - 230, h: 108, label, kind: 'primary', id: 'homeStart' };

  // 投影
  ctx.fillStyle = 'rgba(61,123,255,0.28)';
  roundRect(ctx, btn.x, btn.y + 6, btn.w, btn.h, btn.h / 2);
  ctx.fill();
  drawButton(ctx, btn, false, t);

  return [btn];
}

/** 画背景装饰星点（确定性伪随机，位置固定）。 */
function drawStars(ctx: CanvasRenderingContext2D, now: number): void {
  let s = 20261101;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * DESIGN_W;
    const y = 140 + rnd() * 800;
    const r = 1 + rnd() * 2;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(now / 900 + i));
    ctx.fillStyle = `rgba(255,255,255,${(0.25 + tw * 0.45).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 画顶部玩家条。 */
function drawPlayerBar(ctx: CanvasRenderingContext2D, st: HomePageState): void {
  const t = LOBBY_THEME;

  // 白色圆角背板
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  roundRect(ctx, 28, 40, DESIGN_W - 56, 104, 28);
  ctx.fill();

  // 头像
  drawAvatar(ctx, 84, 92, 38, st.avatar, st.nickname);

  // 昵称
  ctx.fillStyle = t.text;
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.nickname || '玩家', 140, 82);

  // Lv 徽章
  ctx.fillStyle = t.yellow;
  roundRect(ctx, 140, 100, 96, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#7A5A12';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Lv.${st.maxLevel}`, 188, 117);

  // 右侧皮肤收集
  ctx.fillStyle = t.subText;
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`皮肤 ${st.skinCount}/${st.totalSkins}`, DESIGN_W - 56, 92);
}

/**
 * 画头像。有 URL 就画图（失败回退），没有就画程序化渐变 + 首字。
 * 本版本不加载网络图片（零资源约束），始终走程序化分支。
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  _url: string,
  name: string,
): void {
  const t = LOBBY_THEME;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, t.blue);
  g.addColorStop(1, t.purple);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name || '玩').slice(0, 1), cx, cy + 1);
  ctx.restore();

  // 白色描边
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** 画星球本体。 */
function drawPlanet(ctx: CanvasRenderingContext2D, _now: number): void {
  const { x, y, r } = PLANET;

  // 星球底：径向渐变
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, '#8FD6FF');
  g.addColorStop(0.55, '#4FA8F0');
  g.addColorStop(1, '#2E6FD0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 云带（3 条椭圆，水平微倾）
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.ellipse(x, y + i * r * 0.42, r * 0.95, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.33, y - r * 0.42, r * 0.26, r * 0.17, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 外描边
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** 画三条椭圆轨道。 */
function drawOrbits(ctx: CanvasRenderingContext2D, _now: number): void {
  ctx.save();
  ctx.translate(PLANET.x, PLANET.y);
  ctx.strokeStyle = 'rgba(61,123,255,0.22)';
  ctx.lineWidth = 3;
  for (const o of ORBITS) {
    ctx.save();
    ctx.rotate(o.tilt);
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
    // 均匀分布在 3 条轨道上
    const slot = out.length;
    const o = ORBITS[slot % ORBITS.length];
    const ang = o.phase + (slot / ORBITS.length) * Math.PI * 2;
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

/** 画一个卫星关卡节点。 */
function drawSatellite(ctx: CanvasRenderingContext2D, s: Satellite, now: number): void {
  const t = LOBBY_THEME;
  const r = s.state === 'current' ? 34 : 28;

  // 当前关：呼吸光圈
  if (s.state === 'current') {
    const pulse = (Math.sin(now / 380) + 1) / 2;
    ctx.strokeStyle = `rgba(61,123,255,${(0.25 + pulse * 0.45).toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 8 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 底色
  ctx.fillStyle = s.state === 'locked' ? '#C7D2E6' : s.state === 'current' ? '#FFFFFF' : t.yellow;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();

  // 描边
  ctx.strokeStyle = s.state === 'current' ? t.blue : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s.state === 'current' ? 4 : 3;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // 关号
  ctx.fillStyle = s.state === 'locked' ? '#8494AE' : s.state === 'current' ? t.blue : '#7A5A12';
  ctx.font = `600 ${s.state === 'current' ? 26 : 22}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(s.level), s.x, s.y + 1);

  // 已通关打勾
  if (s.state === 'done') {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - 9, s.y + 0);
    ctx.lineTo(s.x - 2, s.y + 7);
    ctx.lineTo(s.x + 10, s.y - 8);
    ctx.stroke();
  }
}

/** 画吉祥物（蓝色圆滚滚小角色 + 气泡）。 */
function drawMascot(ctx: CanvasRenderingContext2D, now: number, maxLevel: number): void {
  const t = LOBBY_THEME;
  const x = 108;
  const baseY = 900;
  const breathe = Math.sin(now / 520) * 6;
  const y = baseY + breathe;

  // 身体
  ctx.fillStyle = '#4FA8F0';
  ctx.beginPath();
  ctx.ellipse(x, y, 46, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  // 头顶高光
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - 14, y - 18, 14, 9, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = '#22304D';
  for (const dx of [-13, 13]) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y - 4, 6.5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 眼睛高光
  ctx.fillStyle = '#FFFFFF';
  for (const dx of [-13, 13]) {
    ctx.beginPath();
    ctx.arc(x + dx - 2, y - 7, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 腮红
  ctx.fillStyle = 'rgba(255,122,107,0.55)';
  for (const dx of [-24, 24]) {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + 10, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 嘴
  ctx.strokeStyle = '#22304D';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 10, 9, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();

  // 气泡
  const bx = 196, by = 806, bw = 190, bh = 74;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, bx, by, bw, bh, 22);
  ctx.fill();
  // 小尾巴
  ctx.beginPath();
  ctx.moveTo(bx + 14, by + bh - 6);
  ctx.lineTo(bx - 4, by + bh + 18);
  ctx.lineTo(bx + 38, by + bh - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = t.text;
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`加油！第 ${maxLevel} 关`, bx + bw / 2, by + bh / 2);
}

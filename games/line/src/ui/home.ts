/**
 * 主页大厅 —— 「黏土工坊 / Clay Studio」版本。
 *
 * 与旧「糖果夜空」版的结构一致（坐标可复用），**材质语言全部换掉**：
 * - 夜空玻璃卡 → 奶油黏土板（软投影 + 硬边色阶）
 * - 发光星球 → 手捏黏土球（大陆是贴在球面的黏土斑块）
 * - 果冻按钮 → 黏土块（体积靠色阶，不靠渐变）
 * - 所有发光（halo）删除 —— 黏土是哑光材质，不发光
 *
 * 全部 Canvas 绘制，零 DOM、零贴图。
 */
import { DESIGN_W } from '../render/layout';
import { roundRect } from '../render/board';
import { drawAvatar, type Button } from './hud';
import {
  CLAY,
  CLAY_UI,
  clayBlock,
  clayDisc,
  clayText,
  rrectPts,
  tracePts,
  type ClayColor,
} from './clay';

export { drawAvatar };

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
// 球要足够大才撑得住页面；上移到 486 是为了压掉玩家条到球之间那段 226px 的空
const PLANET = { x: DESIGN_W / 2, y: 486, r: 178 };

/**
 * 轨道定义（半径比、倾角、起始相位）。
 *
 * 两条硬约束，改这里之前先看：
 * 1. **短轴必须 > 球半径 + 节点半径**。旧版 `ry = rx * 0.34` 太扁，6 个节点里有 3 个
 *    落在球面内，和球糊成一片。这里把扁度提到 0.86，短轴才能托住节点。
 * 2. **长轴不能出屏**：`k` 上限约 1.85，否则最外圈节点会切到 750 宽之外。
 */
// phase 取 120° 均分（0 / 2π/3 / 4π/3）：这样只有 3 个节点时是正三角，
// 6 个节点时（第二圈 +π）正好补成 60° 均分。旧值 0/1.1/2.3 会让 3 个节点全挤在下半圈。
const TAU = Math.PI * 2;
const ORBITS = [
  { k: 1.42, tilt: -0.22, phase: 0 },
  { k: 1.62, tilt: 0.18, phase: TAU / 3 },
  { k: 1.82, tilt: -0.1, phase: (TAU * 2) / 3 },
];

/** 轨道的短轴比例。低于 0.8 就会有节点落进球面。 */
const ORBIT_FLAT = 0.86;

/** 星球表面的黏土大陆（相对球心的偏移与半径）。 */
const CONTINENTS = [
  { dx: -58, dy: -60, r: 78, seed: 21 },
  { dx: 62, dy: -14, r: 58, seed: 34 },
  { dx: -20, dy: 74, r: 66, seed: 47 },
];

/**
 * 绘制主页大厅。
 * @returns 可点击按钮列表
 */
export function drawHomePage(ctx: CanvasRenderingContext2D, st: HomePageState, now: number): Button[] {
  drawPlayerBar(ctx, st);

  drawPlanet(ctx);
  drawOrbits(ctx);
  for (const n of satelliteLevels(st)) drawSatellite(ctx, n, now);

  drawMascot(ctx, now, st.maxLevel);
  drawProgress(ctx, st);

  // ── 主按钮 ──
  const label = st.maxLevel > 1 ? `继续 第 ${st.maxLevel} 关` : '开始游戏';
  const btn: Button = { x: 115, y: 1064, w: DESIGN_W - 230, h: 108, label, kind: 'primary', id: 'homeStart' };
  clayBlock(ctx, btn.x, btn.y, btn.w, btn.h, 46, CLAY.terracotta, 911, { depth: 14, hi: 0.07 });
  clayText(ctx, label, btn.x + btn.w / 2, btn.y + btn.h / 2, 42, {
    fill: '#FFF6E9',
    outline: 'rgba(90,38,16,0.55)',
    outlineWidth: 6,
  });

  return [btn];
}

// ────────────────────────────── 玩家条 ──────────────────────────────

function drawPlayerBar(ctx: CanvasRenderingContext2D, st: HomePageState): void {
  clayBlock(ctx, 28, 40, DESIGN_W - 56, 104, 36, CLAY.cream, 3, { depth: 10 });

  // 头像：与「我的」页同一套（蓝黏土圆片 + 压印首字）
  drawAvatar(ctx, 84, 92, 38, st.avatar, st.nickname);

  clayText(ctx, st.nickname || '玩家', 140, 74, 32, {
    align: 'left',
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });

  // Lv 徽章：芥末黏土小块
  clayBlock(ctx, 140, 96, 104, 34, 17, CLAY.mustard, 7, { depth: 4 });
  clayText(ctx, `Lv.${st.maxLevel}`, 192, 113, 21, {
    fill: '#5C4208',
    outlineWidth: 0,
  });

  clayText(ctx, `皮肤 ${st.skinCount}/${st.totalSkins}`, DESIGN_W - 56, 92, 24, {
    align: 'right',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
}

// ────────────────────────────── 星球 ──────────────────────────────

function drawPlanet(ctx: CanvasRenderingContext2D): void {
  const { x, y, r } = PLANET;

  // 桌面上球体的接触阴影（比软投影更深更椭圆）
  ctx.fillStyle = 'rgba(74,51,39,0.13)';
  ctx.beginPath();
  ctx.ellipse(x + 10, y + r * 0.96, r * 0.86, r * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // 球体本身（软投影 + 硬边色阶）
  clayDisc(ctx, x, y, r, CLAY.blue, 61, { depth: 18, hi: 0.20, jitter: 0.009 });

  // 球面上的黏土大陆：贴在球面上，所以有轻微投影
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.985, 0, Math.PI * 2);
  ctx.clip();
  for (const c of CONTINENTS) {
    // 大陆要读成「手撕的纸片」：顶点少（8）+ 半径抖动大 + 角度也抖。
    // 只抖半径会得到规则多边形；真正的手撕形状边长和角都不均。
    clayDisc(ctx, x + c.dx, y + c.dy, c.r, CLAY.land, c.seed, {
      depth: 6,
      jitter: 0.20,
      hi: 0.13,
      segs: 8,
      angleJitter: 0.75,
      // 角要圆钝：捏过的黏土没有尖角，一圈同色圆头描边就是手抹过去的痕迹
      round: c.r * 0.13,
    });
  }

  // 整体光照：压在球体左上，让大陆和海洋吃到同一个方向的光
  ctx.fillStyle = 'rgba(255,251,243,0.26)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.44, r * 0.46, r * 0.32, -0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,251,243,0.13)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.30, y - r * 0.40, r * 0.66, r * 0.46, -0.42, 0, Math.PI * 2);
  ctx.fill();
  // 右下加深，脱开背景
  const sg = ctx.createLinearGradient(0, y + r * 0.15, 0, y + r);
  sg.addColorStop(0, 'rgba(40,58,74,0)');
  sg.addColorStop(1, 'rgba(40,58,74,0.50)');
  ctx.fillStyle = sg;
  ctx.fillRect(x - r, y + r * 0.15, r * 2, r * 0.85);
  ctx.restore();
}

/** 轨道：一根哑光细管（深色底 + 上缘亮线），不是发光线。 */
function drawOrbits(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(PLANET.x, PLANET.y);
  for (const o of ORBITS) {
    ctx.save();
    ctx.rotate(o.tilt);
    const rx = PLANET.r * o.k;
    const ry = PLANET.r * o.k * ORBIT_FLAT;

    // 轨道是布景，不是主角：0.26 会和三圈叠成一只靶子，压到 0.15 让它退到背景去
    ctx.strokeStyle = 'rgba(74,51,39,0.15)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,246,233,0.36)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -1.6, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ────────────────────────────── 卫星节点 ──────────────────────────────

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
    const slot = out.length;
    const o = ORBITS[slot % ORBITS.length];
    const lap = Math.floor(slot / ORBITS.length);
    const ang = o.phase + lap * Math.PI;
    const rx = PLANET.r * o.k;
    const ry = PLANET.r * o.k * ORBIT_FLAT;
    out.push({
      level: lv,
      x: PLANET.x + Math.cos(ang) * rx,
      y: PLANET.y + Math.sin(ang) * ry,
      state: off < 0 ? 'done' : off === 0 ? 'current' : 'locked',
    });
  }
  return out;
}

function drawSatellite(ctx: CanvasRenderingContext2D, s: Satellite, now: number): void {
  const r = s.state === 'current' ? 38 : 28;
  const c: ClayColor = s.state === 'current' ? CLAY.mustard : s.state === 'done' ? CLAY.mint : CLAY.lockTile;

  // 当前关：一圈"黏土环"呼吸（黏土不发光，所以是环不是光晕）
  if (s.state === 'current') {
    const pulse = (Math.sin(now / 420) + 1) / 2;
    ctx.strokeStyle = `rgba(255,246,233,${(0.42 + pulse * 0.34).toFixed(3)})`;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 8 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // depth 必须够重：节点会压在球面上，投影是它「浮在球前面」的唯一证据
  clayDisc(ctx, s.x, s.y, r, c, 100 + s.level, { depth: 15, lit: s.state !== 'locked' });

  // 关号：压印
  clayText(ctx, String(s.level), s.x, s.y - 1, s.state === 'current' ? 30 : 22, {
    fill: s.state === 'locked' ? 'rgba(255,246,233,0.86)' : '#FFFBF3',
    outline: s.state === 'current' ? 'rgba(120,84,14,0.55)' : 'rgba(56,107,87,0.5)',
    outlineWidth: s.state === 'current' ? 5 : 4,
  });

  if (s.state === 'done') {
    // 已通关：右下角一颗小黏土球 + 白勾
    const bx = s.x + r * 0.74;
    const by = s.y + r * 0.70;
    clayDisc(ctx, bx, by, 12, CLAY.terracotta, 200 + s.level, { depth: 4 });
    ctx.strokeStyle = '#FFFBF3';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 5, by);
    ctx.lineTo(bx - 1.5, by + 3.5);
    ctx.lineTo(bx + 5, by - 4);
    ctx.stroke();
  }

  // 未解锁**不放锁**：28px 的圆上，挂锁和关号必然叠成一团糊（上一版就是这样，
  // 数字被锁体压掉了下半截）。未解锁的表达交给「更深的底 + 白字」，与关卡地图一致。
}

// ────────────────────────────── 吉祥物 ──────────────────────────────

function drawMascot(ctx: CanvasRenderingContext2D, now: number, maxLevel: number): void {
  const x = 108;
  const bob = Math.sin(now / 900) * 3;
  const y = 896 + bob;
  const r = 46;

  // 身体：绿色黏土球
  clayDisc(ctx, x, y, r, CLAY.mint, 301, { depth: 10, hi: 0.17 });

  // 两只小触角
  for (const dx of [-16, 16]) {
    ctx.strokeStyle = CLAY.mint.shade;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + dx * 0.7, y - r * 0.86);
    ctx.quadraticCurveTo(x + dx, y - r * 1.18, x + dx * 1.25, y - r * 1.24);
    ctx.stroke();
    clayDisc(ctx, x + dx * 1.25, y - r * 1.26, 6, CLAY.mustard, 310 + dx, { depth: 2 });
  }

  // 眼睛：白眼球 + 深瞳 + 小高光
  for (const dx of [-15, 15]) {
    ctx.fillStyle = '#FFFBF3';
    ctx.beginPath();
    ctx.ellipse(x + dx, y - 8, 12.5, 14.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CLAY_UI.ink;
    ctx.beginPath();
    ctx.ellipse(x + dx + Math.sin(now / 1400) * 1.6, y - 7, 6.4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x + dx + 2.4, y - 11, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 腮红
  for (const dx of [-30, 30]) {
    ctx.fillStyle = 'rgba(224,122,79,0.42)';
    ctx.beginPath();
    ctx.ellipse(x + dx, y + 10, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 微笑
  ctx.strokeStyle = CLAY_UI.ink;
  ctx.lineWidth = 3.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 6, 13, 0.28 * Math.PI, 0.72 * Math.PI);
  ctx.stroke();

  // ── 气泡 ──
  const msg = maxLevel > 1 ? `加油！第 ${maxLevel} 关` : '点开始，画一笔通关';
  const bw = Math.max(250, msg.length * 26 + 64);
  const bh = 66;
  const bx = x + r + 18;
  const by = y - 46;

  clayBlock(ctx, bx, by, bw, bh, 26, CLAY.cream, 401, { depth: 9 });

  // 气泡小尾巴（三角形，同色 + 描边感）
  ctx.fillStyle = CLAY.cream.base;
  ctx.beginPath();
  ctx.moveTo(bx + 6, by + bh * 0.46);
  ctx.lineTo(bx - 12, by + bh * 0.60);
  ctx.lineTo(bx + 6, by + bh * 0.70);
  ctx.closePath();
  ctx.fill();

  clayText(ctx, msg, bx + bw / 2, by + bh / 2, 24, {
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });
}

// ────────────────────────────── 进度条 ──────────────────────────────

function drawProgress(ctx: CanvasRenderingContext2D, st: HomePageState): void {
  const ratio = st.levelCount > 0 ? Math.min(1, st.maxLevel / st.levelCount) : 0;
  const bx = 60;
  const by = 992;
  const bw = DESIGN_W - 120;
  const bh = 22;

  // 凹槽：比底色深一档的"压进桌面的槽"。
  // #C2A284 在 #E3C9AE 的桌面上只差一点点，37/1000 时整条槽会读成「没有」
  const groove = rrectPts(bx, by, bw, bh, bh / 2, 501, 0.004);
  ctx.fillStyle = CLAY.sand.shade;
  tracePts(ctx, groove);
  ctx.fill();
  // 槽内上缘暗线（凹进去的签名）
  ctx.strokeStyle = 'rgba(74,51,39,0.20)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(bx + bw / 2, by + 3, bw / 2 - 4, bh / 2 - 3, 0, Math.PI, 0);
  ctx.stroke();

  if (ratio > 0) {
    const fillW = Math.max(bh, bw * ratio);
    // 填充：陶土黏土条
    const f = rrectPts(bx, by, fillW, bh, bh / 2, 502, 0.004);
    ctx.fillStyle = CLAY.terracotta.dark;
    tracePts(ctx, f);
    ctx.fill();
    ctx.fillStyle = CLAY.terracotta.base;
    ctx.save();
    tracePts(ctx, f);
    ctx.clip();
    tracePts(ctx, f, 0, -3, 0.995, bx + fillW / 2, by + bh / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    roundRect(ctx, bx + 5, by + 4, Math.max(0, fillW - 10), bh * 0.28, bh * 0.14);
    ctx.fill();
    ctx.restore();
    // 进度头
    clayDisc(ctx, bx + fillW - bh / 2, by + bh / 2, bh * 0.44, CLAY.mustard, 503, { depth: 3 });
  }

  clayText(ctx, `第 ${st.maxLevel} 关`, bx, by + 34, 23, {
    align: 'left',
    baseline: 'top',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, `共 ${st.levelCount} 关`, bx + bw, by + 34, 23, {
    align: 'right',
    baseline: 'top',
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, `${(ratio * 100).toFixed(1)}%`, bx + bw, by - 10, 21, {
    align: 'right',
    fill: CLAY.terracotta.dark,
    outlineWidth: 0,
    emboss: false,
  });
}

/** 供外部（预览工具）复用的星球绘制。 */
export function drawHomePlanet(ctx: CanvasRenderingContext2D): void {
  drawPlanet(ctx);
  drawOrbits(ctx);
}

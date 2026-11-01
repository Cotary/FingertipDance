/**
 * 程序化纹理函数库。美术资产量为零，全部用 Canvas 确定性绘制。
 * 确定性随机源由调用方通过 `t.rand` 传入（同一格每次渲染一致）。
 */

/** 纹理绘制上下文。 */
export interface TextureCtx {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 确定性随机源（0..1） */
  rand: () => number;
}

/**
 * 2D value noise + fbm。用于大理石与星尘纹理。确定性（LCG 洗牌 perm 表）。
 */
export class ValueNoise {
  private perm: Uint8Array;

  constructor(seed: number) {
    const p = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    this.perm = p;
  }

  /** 2D 值噪声，返回 0..1。 */
  noise2(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const hash = (a: number, b: number): number => this.perm[(this.perm[a] + b) & 511] / 255;
    const n00 = hash(xi, yi);
    const n10 = hash(xi + 1, yi);
    const n01 = hash(xi, yi + 1);
    const n11 = hash(xi + 1, yi + 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return nx0 + (nx1 - nx0) * v;
  }

  /** 分形叠加噪声。 */
  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      freq *= 2;
      amp *= 0.5;
    }
    return sum;
  }
}

/** 纯色 + 顶部高光。 */
export function texNone(t: TextureCtx, base: string, light: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, light);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** 木纹：正弦扰动的深色横纹。 */
export function texWood(t: TextureCtx, base: string, dark: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const lines = 4;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, h * 0.06);
  for (let i = 0; i < lines; i++) {
    const phase = t.rand() * Math.PI * 2;
    const yy = y + h * ((i + 0.5) / lines);
    ctx.beginPath();
    for (let px = 0; px <= w; px += 4) {
      const py = yy + Math.sin(px * 0.12 + phase) * h * 0.07;
      if (px === 0) ctx.moveTo(x + px, py);
      else ctx.lineTo(x + px, py);
    }
    ctx.stroke();
  }
}

/** 大理石：噪声脉络。 */
export function texMarble(t: TextureCtx, base: string, vein: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const noise = new ValueNoise(Math.floor(t.rand() * 100000));
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(1, h * 0.05);
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.35 + t.rand() * 0.3;
    ctx.beginPath();
    const phase = t.rand() * 100;
    for (let px = 0; px <= w; px += 3) {
      const n = noise.fbm(px * 0.02 + phase, i * 3.7, 3);
      const py = y + h * (0.25 + i * 0.25) + (n - 0.5) * h * 0.5;
      if (px === 0) ctx.moveTo(x + px, py);
      else ctx.lineTo(x + px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** 金属拉丝：密集水平细线。 */
export function texBrushed(t: TextureCtx, base: string, dark: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  for (let py = 0; py < h; py += 2) {
    ctx.globalAlpha = 0.1 + t.rand() * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y + py);
    ctx.lineTo(x + w, y + py);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** 冰晶：斜向亮线 + 中心菱形。 */
export function texIce(t: TextureCtx, base: string, light: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = light;
  ctx.lineWidth = Math.max(1, h * 0.07);
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 3; i++) {
    const off = t.rand();
    ctx.beginPath();
    ctx.moveTo(x - h * 0.2 + off * w, y + h);
    ctx.lineTo(x + w * (0.4 + off * 0.6), y - h * 0.2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + h * 0.22);
  ctx.lineTo(x + w * 0.72, y + h / 2);
  ctx.lineTo(x + w / 2, y + h * 0.78);
  ctx.lineTo(x + w * 0.28, y + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** 霓虹：深底 + 发光边框 + 中心亮线。 */
export function texNeon(t: TextureCtx, base: string, glow: string): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = Math.max(6, h * 0.35);
  ctx.strokeStyle = glow;
  ctx.lineWidth = Math.max(2, h * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.18, y + h / 2);
  ctx.lineTo(x + w * 0.82, y + h / 2);
  ctx.stroke();
  ctx.restore();
}

/** 黄金：斜向渐变 + 高光带。 */
export function texGold(t: TextureCtx, base: string, light: string, dark: string): void {
  const { ctx, x, y, w, h } = t;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, dark);
  g.addColorStop(0.4, light);
  g.addColorStop(0.55, base);
  g.addColorStop(0.75, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** 星尘：深底 + 星点（带闪烁时间）。 */
export function texStardust(t: TextureCtx, base: string, star: string, timeMs: number): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const count = 18;
  for (let i = 0; i < count; i++) {
    const px = x + t.rand() * w;
    const py = y + t.rand() * h;
    const twinkle = 0.5 + 0.5 * Math.sin(timeMs / 400 + i * 1.7);
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = star;
    const s = 1 + t.rand() * 1.6;
    ctx.fillRect(px, py, s, s);
  }
  ctx.globalAlpha = 1;
}

/** 星河：多层径向渐变 + 星点。 */
export function texGalaxy(t: TextureCtx, base: string, c1: string, c2: string, timeMs: number): void {
  const { ctx, x, y, w, h } = t;
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  g.addColorStop(0, c1);
  g.addColorStop(0.5, c2);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const count = 22;
  for (let i = 0; i < count; i++) {
    const px = x + t.rand() * w;
    const py = y + t.rand() * h;
    const twinkle = 0.4 + 0.6 * Math.sin(timeMs / 500 + i * 2.3);
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(px, py, 1.2, 1.2);
  }
  ctx.globalAlpha = 1;
}

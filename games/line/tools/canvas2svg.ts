/**
 * Canvas2D → SVG 录制器（仅用于离线视觉验证，不进构建产物）。
 *
 * 目的：本机没有浏览器 / playwright，无法截图。这个录制器实现了游戏用到的
 * Canvas2D 子集，把**真实绘制代码**转录成 SVG，从而在预览面板里直接看到成品。
 *
 * 设计取舍：
 * - 变换直接烘焙进几何坐标（不发 transform 属性），避免 gradient 用户坐标系歧义
 * - 弧 / 椭圆采样成折线，48 段足够平滑
 * - 不支持 drawImage / shadowBlur（游戏代码未依赖）
 */

type Mat = [number, number, number, number, number, number];

const ID: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class Grad {
  readonly id: number;
  readonly kind: 'linear' | 'radial';
  readonly coords: number[];
  readonly stops: Array<{ offset: number; color: string }> = [];
  constructor(id: number, kind: 'linear' | 'radial', coords: number[]) {
    this.id = id;
    this.kind = kind;
    this.coords = coords;
  }
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
  def(): string {
    const stops = this.stops
      .map((s) => `<stop offset="${s.offset}" stop-color="${esc(s.color)}"/>`)
      .join('');
    if (this.kind === 'linear') {
      const [x0, y0, x1, y1] = this.coords;
      return `<linearGradient id="g${this.id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}">${stops}</linearGradient>`;
    }
    const [, , x1, y1, r1] = this.coords;
    return `<radialGradient id="g${this.id}" gradientUnits="userSpaceOnUse" cx="${x1}" cy="${y1}" r="${r1 || 1}">${stops}</radialGradient>`;
  }
}

/** 记录型绘图上下文。 */
export class RecordingCtx {
  private mat: Mat = ID;
  private stack: Array<{ mat: Mat; clipId: string | null; st: RecState }> = [];
  private clipId: string | null = null;
  private d: string[] = [];
  private out: string[] = [];
  private defs: string[] = [];
  private gid = 0;
  private cid = 0;
  private grads: Grad[] = [];

  fillStyle: string | Grad = '#000';
  strokeStyle: string | Grad = '#000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  miterLimit = 10;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  shadowColor = 'rgba(0,0,0,0)';
  shadowBlur = 0;
  lineDash: number[] = [];

  get canvas(): { width: number; height: number } {
    return { width: 750, height: 1334 };
  }

  // ── 状态 ──
  save(): void {
    this.stack.push({ mat: this.mat, clipId: this.clipId, st: this.snapshot() });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.mat = s.mat;
    this.clipId = s.clipId;
    this.apply0(s.st);
  }
  private snapshot(): RecState {
    return {
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      lineDash: this.lineDash.slice(),
    };
  }
  private apply0(s: RecState): void {
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.lineCap = s.lineCap;
    this.lineJoin = s.lineJoin;
    this.globalAlpha = s.globalAlpha;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.lineDash = s.lineDash;
  }

  // ── 变换 ──
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.mat = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.mat = mul(this.mat, [1, 0, 0, 1, x, y]);
  }
  scale(x: number, y: number): void {
    this.mat = mul(this.mat, [x, 0, 0, y, 0, 0]);
  }
  rotate(a: number): void {
    this.mat = mul(this.mat, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
  }

  // ── 路径 ──
  private pt(x: number, y: number): string {
    const [px, py] = apply(this.mat, x, y);
    return `${px.toFixed(2)} ${py.toFixed(2)}`;
  }
  private cur: [number, number] | null = null;
  beginPath(): void {
    this.d = [];
    this.cur = null;
  }
  closePath(): void {
    this.d.push('Z');
  }
  moveTo(x: number, y: number): void {
    this.d.push(`M${this.pt(x, y)}`);
    this.cur = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.d.push(`L${this.pt(x, y)}`);
    this.cur = [x, y];
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.d.push(`Q${this.pt(cx, cy)} ${this.pt(x, y)}`);
    this.cur = [x, y];
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.d.push(`C${this.pt(c1x, c1y)} ${this.pt(c2x, c2y)} ${this.pt(x, y)}`);
    this.cur = [x, y];
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipse(cx, cy, r, r, 0, a0, a1, ccw);
  }
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rot: number,
    a0: number,
    a1: number,
    ccw = false,
  ): void {
    let start = a0;
    let end = a1;
    if (ccw) {
      while (end > start) end -= Math.PI * 2;
    } else {
      while (end < start) end += Math.PI * 2;
    }
    const span = end - start;
    const steps = Math.max(8, Math.min(64, Math.ceil(Math.abs(span) / (Math.PI / 24))));
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    for (let i = 0; i <= steps; i++) {
      const t = start + (span * i) / steps;
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      const x = cx + ex * cosR - ey * sinR;
      const y = cy + ex * sinR + ey * cosR;
      if (i === 0) this.d.push(`${this.d.length === 0 ? 'M' : 'L'}${this.pt(x, y)}`);
      else this.d.push(`L${this.pt(x, y)}`);
      if (i === steps) this.cur = [x, y];
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const cur = this.cur;
    if (!cur || r <= 0) {
      this.lineTo(x1, y1);
      return;
    }
    const v1x = cur[0] - x1;
    const v1y = cur[1] - y1;
    const v2x = x2 - x1;
    const v2y = y2 - y1;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) {
      this.lineTo(x1, y1);
      return;
    }
    const u1x = v1x / l1;
    const u1y = v1y / l1;
    const u2x = v2x / l2;
    const u2y = v2y / l2;
    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const ang = Math.acos(dot);
    if (ang < 1e-3) {
      this.lineTo(x1, y1);
      return;
    }
    const t = r / Math.tan(ang / 2);
    const t1x = x1 + u1x * t;
    const t1y = y1 + u1y * t;
    const t2x = x1 + u2x * t;
    const t2y = y1 + u2y * t;
    const bx = u1x + u2x;
    const by = u1y + u2y;
    const bl = Math.hypot(bx, by) || 1;
    const dist = r / Math.sin(ang / 2);
    const ccx = x1 + (bx / bl) * dist;
    const ccy = y1 + (by / bl) * dist;
    this.lineTo(t1x, t1y);
    const a0 = Math.atan2(t1y - ccy, t1x - ccx);
    const a1 = Math.atan2(t2y - ccy, t2x - ccx);
    const cross = u1x * u2y - u1y * u2x;
    // canvas 屏幕坐标 y 向下，顺时针路径在拐角处的扫掠方向为「逆角增方向」
    this.ellipse(ccx, ccy, r, r, 0, a0, a1, cross > 0);
  }
  setLineDash(dash: number[]): void {
    this.lineDash = dash.slice();
  }

  private pathAttr(): string {
    const d = this.d.join(' ');
    return d ? `d="${d}"` : '';
  }
  private common(): string {
    const parts: string[] = [];
    if (this.clipId) parts.push(`clip-path="url(#${this.clipId})"`);
    if (this.globalAlpha < 1) parts.push(`opacity="${this.globalAlpha.toFixed(3)}"`);
    return parts.join(' ');
  }
  private paint(style: string | Grad): string {
    if (style instanceof Grad) return `url(#g${style.id})`;
    return esc(style);
  }

  fill(): void {
    if (this.d.length === 0) return;
    this.out.push(`<path ${this.pathAttr()} fill="${this.paint(this.fillStyle)}" ${this.common()}/>`);
  }
  stroke(): void {
    if (this.d.length === 0) return;
    const dash = this.lineDash.length ? ` stroke-dasharray="${this.lineDash.join(' ')}"` : '';
    this.out.push(
      `<path ${this.pathAttr()} fill="none" stroke="${this.paint(this.strokeStyle)}" stroke-width="${this.lineWidth}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"${dash} ${this.common()}/>`,
    );
  }
  clip(): void {
    const id = `c${this.cid++}`;
    this.defs.push(`<clipPath id="${id}"><path ${this.pathAttr()}/></clipPath>`);
    this.clipId = id;
  }

  // ── 快捷矩形 ──
  fillRect(x: number, y: number, w: number, h: number): void {
    const [x0, y0] = apply(this.mat, x, y);
    const [x1, y1] = apply(this.mat, x + w, y);
    const [x2, y2] = apply(this.mat, x + w, y + h);
    const [x3, y3] = apply(this.mat, x, y + h);
    const d = `M${x0} ${y0} L${x1} ${y1} L${x2} ${y2} L${x3} ${y3} Z`;
    this.out.push(`<path d="${d}" fill="${this.paint(this.fillStyle)}" ${this.common()}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const saved = this.d;
    this.d = [];
    this.rect(x, y, w, h);
    this.stroke();
    this.d = saved;
  }
  clearRect(): void {
    /* noop */
  }

  // ── 文本 ──
  private fontParts(): { size: number; weight: number; family: string } {
    const m = /^(?:(normal|bold|[1-9]00)\s+)?([\d.]+)px\s+(.+)$/.exec(this.font.trim());
    if (!m) return { size: 16, weight: 400, family: 'sans-serif' };
    const w = m[1] === 'bold' ? 700 : m[1] ? Number(m[1]) : 400;
    return { size: Number(m[2]), weight: w, family: m[3] };
  }
  private textEl(text: string, x: number, y: number, mode: 'fill' | 'stroke'): string {
    const { size, weight, family } = this.fontParts();
    const scale = Math.hypot(this.mat[0], this.mat[1]) || 1;
    const [px, py] = apply(this.mat, x, y);
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start';
    const baseline =
      this.textBaseline === 'middle'
        ? 'central'
        : this.textBaseline === 'top'
          ? 'text-before-edge'
          : this.textBaseline === 'bottom'
            ? 'text-after-edge'
            : 'alphabetic';
    const dash = this.lineDash.length ? ` stroke-dasharray="${this.lineDash.join(' ')}"` : '';
    const paint =
      mode === 'fill'
        ? `fill="${this.paint(this.fillStyle)}"`
        : `fill="none" stroke="${this.paint(this.strokeStyle)}" stroke-width="${this.lineWidth}" stroke-linejoin="${this.lineJoin}"${dash}`;
    return `<text x="${px.toFixed(2)}" y="${py.toFixed(2)}" font-family="${esc(family)}" font-size="${(size * scale).toFixed(2)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="${baseline}" ${paint} ${this.common()}>${esc(text)}</text>`;
  }
  fillText(text: string, x: number, y: number): void {
    this.out.push(this.textEl(text, x, y, 'fill'));
  }
  strokeText(text: string, x: number, y: number): void {
    this.out.push(this.textEl(text, x, y, 'stroke'));
  }
  measureText(text: string): { width: number } {
    const { size } = this.fontParts();
    return { width: text.length * size * 0.6 };
  }

  // ── 渐变 ──
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Grad {
    const [ax, ay] = apply(this.mat, x0, y0);
    const [bx, by] = apply(this.mat, x1, y1);
    const g = new Grad(this.gid++, 'linear', [ax, ay, bx, by]);
    this.grads.push(g);
    return g;
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Grad {
    const [ax, ay] = apply(this.mat, x1, y1);
    const scale = Math.hypot(this.mat[0], this.mat[1]) || 1;
    void x0;
    void y0;
    void r0;
    const g = new Grad(this.gid++, 'radial', [ax, ay, ax, ay, r1 * scale]);
    this.grads.push(g);
    return g;
  }

  /** 输出 SVG。渐变 stop 是创建后才加入的，所以在此统一生成 defs。 */
  toSvg(w = 750, h = 1334): string {
    const defs = this.grads.map((g) => g.def()).join('') + this.defs.join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${this.out.join('')}</svg>`;
  }
}

interface RecState {
  fillStyle: string | Grad;
  strokeStyle: string | Grad;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineDash: number[];
}

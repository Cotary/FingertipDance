/**
 * 水墨山河 · 媒介轴（第二批典藏）。
 *
 * ## 它换掉了什么
 *
 * 前四套换的是材质 / 几何 / 光源 / 秩序，全都是**深色**。
 * 水墨换的是**媒介**：画在宣纸上、用墨画，不是「在暗处发光的东西」。
 *
 * 抽掉颜色只看灰度，它是唯一一张**亮底暗块**的棋盘 ——
 * 这一条就足够把它和其余七套分开，不需要任何特效。
 *
 * ## 三条不能破的规则
 *
 * 1. **不许发光**。墨没有光源，任何辉光都会立刻变成「霓虹水墨」，两头不靠。
 * 2. **不许有格面**。未走的格只是一圈极淡的墨线（纸还是纸），
 *    已走的格才是墨块 —— 「留白」是水墨的一半，填满就没有留白了。
 * 3. **线比块重**。墨块 55% 浓度、线是接近纯黑的浓墨：
 *    这样走在墨块上仍然看得见线，而不是「线消失在块里」。
 *
 * ## 为什么浅色主题能做
 *
 * HUD 的配色是主题给的（`chrome`），深色主题那套「深底浅字」在这里反过来：
 * 米纸底 + 墨字。黏土的四阶由 `clayFrom()` 从基色派生，浅色基色走的是
 * 「往白推 26%」那一档，所以按钮仍有体积，不会变成一片白。
 */
import { roundRect } from '../board';
import type { BoardLayout } from '../layout';
import { CoverCell } from '../../core/cover/v3/types';
import type { DesignBox, ThemeChrome } from './types';
import { composeTheme, type CellGeom, type Pt } from './kit';

/** 纸色。整张画都从这个颜色里「长」出来。 */
const PAPER = '#F3EEE4';
const INK = '#2E2A26';
const INK_SOFT = 'rgba(46,42,38,0.55)';

const CHROME: ThemeChrome = {
  pill: '#E7DDCA', pillInk: '#3A342C',
  primary: '#3E3830', primaryInk: '#F8F3E8',
  ghost: '#DCD1BC', ghostInk: '#3A342C',
  ink: INK, inkSoft: 'rgba(58,51,43,0.68)',
  groove: 'rgba(58,51,43,0.16)', fill: '#5C5448',
};

/** 稳定伪随机：同一个格子每帧拿到同一个偏移，画面不会「沸腾」。 */
function jit(i: number, k: number): number {
  const n = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, box: DesignBox): void {
  const { x, y, w, h } = box;

  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // 纸纤维：120 个 1px 灰点。少了像塑料，多了像噪点（也会拖慢皮肤页 ——
  // 那里一帧要画九个陶片，每个陶片的背景都是这一整套）
  for (let i = 0; i < 120; i++) {
    const px = x + jit(i, 1) * w;
    const py = y + jit(i, 2) * h;
    ctx.fillStyle = `rgba(96,88,76,${0.03 + jit(i, 3) * 0.07})`;
    ctx.fillRect(px, py, 1.4, 1.4);
  }

  // 远山：三层横向起伏，越往下越浓。
  // 用二次贝塞尔的波形而不是正弦折线 —— 折线会读出「锯齿」，
  // 而水墨里的山棱是软的。
  const ridge = (baseY: number, amp: number, alpha: number, phase: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + baseY);
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const x0 = x + (w / steps) * i;
      const x1 = x + (w / steps) * (i + 1);
      const mid = (x0 + x1) / 2;
      const peak = y + baseY - amp * (0.55 + 0.45 * Math.sin(i * 1.7 + phase));
      ctx.quadraticCurveTo(mid, peak, x1, y + baseY + amp * 0.10 * Math.sin(i * 2.3 + phase));
    }
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = `rgba(78,72,62,${alpha})`;
    ctx.fill();
  };
  ridge(h * 0.80, 92, 0.055, 0.4);
  ridge(h * 0.88, 64, 0.075, 2.1);
  ridge(h * 0.95, 40, 0.095, 4.2);

  // 顶部淡墨：画面要「压住」，否则一整张米白会显得没画完
  const top = ctx.createLinearGradient(0, y, 0, y + h * 0.30);
  top.addColorStop(0, 'rgba(70,64,56,0.10)');
  top.addColorStop(1, 'rgba(70,64,56,0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, h * 0.30);

  // 旧纸的暗角。半径给到 0.95w：暗角只在四边，不能压到盘面
  const v = ctx.createRadialGradient(x + w / 2, y + h * 0.48, w * 0.30, x + w / 2, y + h * 0.48, w * 0.95);
  v.addColorStop(0, 'rgba(120,108,92,0)');
  v.addColorStop(1, 'rgba(120,108,92,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

/**
 * 底板：不画「板」，画「裱」。
 *
 * 一块深色底板会立刻把这个主题变成「深色主题上刷白」，所以这里只有
 * 一圈双线框（画心的界线）+ 一层几乎看不见的纸面提亮。
 */
function drawPlate(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const pad = Math.max(8, layout.cell * 0.30);
  const x = layout.originX - pad;
  const y = layout.originY - pad;
  const w = layout.boardW + pad * 2;
  const h = layout.boardH + pad * 2;

  ctx.fillStyle = 'rgba(255,253,247,0.30)';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();

  // 画心的界线要**看得出来**。第一版是 0.28，实拍整屏米白，
  // 盘面完全没有边界 —— 玩家找不到「棋盘在哪」。
  ctx.strokeStyle = 'rgba(70,64,56,0.40)';
  ctx.lineWidth = 1.8;
  roundRect(ctx, x, y, w, h, 6);
  ctx.stroke();

  // 外框（装裱的绫边）：比画心淡一档，间距 10px
  ctx.strokeStyle = 'rgba(70,64,56,0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 4);
  ctx.stroke();
}

function drawCell(g: CellGeom): void {
  const { ctx, cell, cx, cy, walk, type } = g;
  // 0.03 而不是 0.06：0.06 在 64px 格上留出 7.7px 白缝，
  // 21 格连起来读作「贴了一排瓷片」；0.03 只剩 4px，读作「染成一片」
  const inset = cell * 0.03;
  const box = cell - inset * 2;
  const bx = cx - box / 2;
  const by = cy - box / 2;

  if (walk) {
    // 墨块：淡墨（34%）铺地 + 偏移的第二层淡墨做「洇」。
    //
    // 这条参数试过三档，值得记下来：
    //   55% → 读作「灰色塑料块」（中灰不暖不冷，最廉价的那一档）
    //   72% → 21 格连成一片黑，**路线完全消失在墨块里**（真机尺寸实拍）
    //   34% → 淡墨染过一遍，浓墨的线压在上面才看得见
    // 水墨画的地是「染」的、路是「写」的：两者必须差一个数量级的浓度。
    //
    // 毛边**不用圆点**：第一版沿四条边撒六个小圆，实拍是「方块钉了一圈铆钉」。
    // 改用「偏移 2px 的第二层淡墨」——边界自然不齐，而且不会出现孤立形状。
    ctx.fillStyle = 'rgba(46,40,33,0.14)';
    roundRect(ctx, bx - cell * 0.03, by - cell * 0.02, box + cell * 0.04, box + cell * 0.03, cell * 0.13);
    ctx.fill();
    ctx.fillStyle = 'rgba(42,36,30,0.34)';
    roundRect(ctx, bx, by, box, box, cell * 0.10);
    ctx.fill();
  } else {
    // 未走 = 留白。只有一圈极淡的墨线，标出「这里有一格」
    ctx.strokeStyle = 'rgba(62,56,48,0.16)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    roundRect(ctx, bx, by, box, box, cell * 0.10);
    ctx.stroke();
  }

  // 石头：一整块淡墨 + 两道皴。冰：留白 + 一道折线（水墨画冰就是留白）
  if (type === CoverCell.BLOCK) {
    // 石头是「地形」，已走是「痕迹」—— 两者都是灰的，必须靠浓度和纹理分开：
    // 石头更淡（0.20）且带两道皴，已走更实（0.34）且边缘洇开
    ctx.fillStyle = 'rgba(56,50,43,0.20)';
    roundRect(ctx, bx, by, box, box, cell * 0.10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(46,40,33,0.22)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    for (let k = 1; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(bx + cell * 0.14, by + box * (0.28 + k * 0.22));
      ctx.lineTo(bx + box - cell * 0.12, by + box * (0.24 + k * 0.22));
      ctx.stroke();
    }
  }
  if (type === CoverCell.ICE) {
    ctx.strokeStyle = 'rgba(70,110,130,0.45)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    ctx.beginPath();
    ctx.moveTo(cx - cell * 0.22, cy + cell * 0.18);
    ctx.lineTo(cx - cell * 0.02, cy - cell * 0.04);
    ctx.lineTo(cx + cell * 0.20, cy + cell * 0.10);
    ctx.stroke();
  }
}

/** 墨线：宽的一层是「洇」，窄的一层是「笔」。 */
function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cell: number, now: number): void {
  void now;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const stroke = (w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  };
  // 洇：墨在纸上的扩散，宽而淡
  stroke(Math.max(8, cell * 0.24), 'rgba(40,34,28,0.10)');
  // 笔：浓墨。0.11 而不是 0.15 —— 0.15 在 66px 的展台格上是 10px，
  // 实拍是一根黑色胶管压在格子上，把「墨块」全遮住了
  stroke(Math.max(3, cell * 0.13), INK);
}

export const INK_THEME = composeTheme({
  id: 'ink',
  name: '水墨山河',
  tagline: '一张宣纸，墨块是走过的路',
  unlock: { type: 'milestone', value: 100 },
  chrome: CHROME,
  kit: {
    backdrop: drawBackdrop,
    plate: drawPlate,
    cell: drawCell,
    trail: drawTrail,
    trailColors: { halo: 'rgba(46,42,38,0.12)', core: INK, hot: INK_SOFT },
    hintColor: '#B4472B',
    hintWidth: 0.85,
    glyph: {
      style: 'ink',
      // 水墨图标：墨线 + 淡墨面。底盘必须为空 —— 一个圆底会让「留白」消失
      pal: { ink: INK, accent: 'rgba(46,42,38,0.42)', chip: PAPER, deep: INK },
      back: '',
      backEdge: 'transparent',
    },
    head(ctx, p, cell, now) {
      // 笔尖：一个实心墨点 + 一圈未干的水痕
      const r = cell * 0.15;
      ctx.fillStyle = 'rgba(46,42,38,0.16)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (2.2 + 0.3 * Math.sin(now / 420)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    },
    endpoint(ctx, kind, p, cell) {
      ctx.strokeStyle = 'rgba(46,42,38,0.72)';
      ctx.lineWidth = Math.max(2, cell * 0.045);
      const r = cell * 0.30;
      if (kind === 'start') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = r * 0.94;
        ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
      }
    },
  },
});

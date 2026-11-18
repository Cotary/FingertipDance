/**
 * 转场 · 剥壁揭示。
 *
 * ## 为什么不是淡入淡出
 *
 * 设计稿的原话：**「永远不用纯 opacity 渐变 —— 那是玻璃的语言，不是壁的语言。」**
 * 一套以土、砂、矿物立身的主题，页面切换如果靠透明度过渡，整套材质就塌了：
 * 淡入是"两片玻璃叠在一起"，而这个世界的墙是**被抹开**的。
 *
 * 所以这里做的是一张**土墙幕**：切页那一瞬间整屏被墙盖住，然后墙带着撕边
 * 往一侧退开，新页面从左往右被"露"出来。盖住 → 抹开，是同一块墙的两个状态，
 * 不是两张图叠化。
 *
 * ## 三个必须守住的形式
 *
 * 1. **撕边要有噪声**：直线推移读作"一张纸在滑"，不是墙皮被铲开。
 *    撕边用两频抖动（粗 + 细）叠出来 —— 只有高频是锯齿，只有低频是波浪。
 * 2. **边上有受光**：墙断开的那一道断面会反光（2px 亮的斜口 + 一道暗影）。
 *    少了这道光，撕边看起来是"抠掉的"，不是"剥开的"。
 * 3. **不移交透明度**：幕从头到尾 opacity 都是 1，退场只靠位移。
 *
 * ## 时长
 *
 * 480ms，缓动 `cubic-bezier(.4,0,.2,1)`（设计稿的**沥线**族）：
 * 起步慢、中段快、收尾慢。用真解而不是 `1-(1-t)³` —— 那是沙落族，
 * 前三分之一就走完大半，会让这面墙像"被抽走"，而不是"被抹开"。
 */
import { fillGrain } from '../render/grain';

/** 揭示时长（ms）。鸣沙 `trans 480ms`、天青 `trans 520ms`。 */
export const WIPE_MS = 480;

/** 幕的配色。只有**愿意用这套语言**的主题才提供（其余主题不转场）。 */
export interface WipeSkin {
  /** 墙的受光面 */
  from: string;
  /** 墙的收暗面 */
  to: string;
  /** 撕边断面上的暗影；省略用默认的土褐 */
  edge?: string;
  /**
   * 边缘的形态。
   *
   * - `wall`（默认）—— **撕边**：两频噪声叠出来的崩口，退出只靠位移。
   *   鸣沙的墙被铲开，边是断的。
   * - `glaze` —— **釉光边**：一条笔直而柔和的竖直高光带，领先幕身 60ms。
   *   天青的页面不是"墙被抹开"，是"一层釉被刮过"：边必须直，光必须亮。
   *   照设计稿 `.sweep-veil .edge`（42px 白渐变 + blur 2px）。
   */
  kind?: 'wall' | 'glaze';
  /** 幕布时长（ms）；省略 480。天青是 520。 */
  ms?: number;
}

/** 撕边采样的段长（设计像素）。14 大约是三粒砂的宽度，再细就成锯齿滤镜。 */
const SEG = 14;

/** 撕边振幅（设计像素）。两频叠加后实际峰谷差约 ±9。 */
const AMP = 9;

/** 断面暗影的厚度（设计像素）。 */
const SHADOW = 34;

/** 釉光边的宽度（设计像素）。设计稿 `.edge` 是 42px。 */
const GLOW = 42;

/** 釉光边领先幕身多少（设计稿「光边先于内容 60ms」）。 */
const LEAD_MS = 60;

/** 稳定伪随机：同一条边每帧必须是同一个形状，否则撕边会"沸腾"。 */
function h(n: number): number {
  const s = Math.sin(n * 91.7 + 13.3) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 撕边上某一点的 x。
 *
 * 粗频决定"大块墙皮"的轮廓（每 48px 一个起伏），细频是崩口的碎边（每 14px）。
 * 粗频占 0.62、细频占 0.86：细的更碎，但不能盖过粗的走向，
 * 否则整条边会在原地抖，看不出往哪边退。
 */
function edgeX(x0: number, y: number): number {
  const fine = h(Math.floor(y / SEG)) - 0.5;
  const coarse = h(Math.floor(y / (SEG * 3.4)) + 77) - 0.5;
  return x0 + (coarse * 0.62 + fine * 0.86) * AMP;
}

/** `cubic-bezier(.4,0,.2,1)` 的 y(x)。牛顿迭代 5 步足够（误差 < 0.1%）。 */
function easeSweep(x: number): number {
  const x1 = 0.4;
  const y1 = 0;
  const x2 = 0.2;
  const y2 = 1;
  const bez = (a: number, b: number, s: number) => {
    const u = 1 - s;
    return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
  };
  let s = x;
  for (let i = 0; i < 5; i++) {
    const e = bez(x1, x2, s) - x;
    const d = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
    if (Math.abs(d) < 1e-4) break;
    s -= e / d;
    s = Math.max(0, Math.min(1, s));
  }
  return bez(y1, y2, s);
}

/**
 * 画一层正在退开的墙幕。
 *
 * `elapsed` 从切页那一帧算起（ms）；`box` 是**实际可视范围**（等比缩放后
 * 上下会超出 750×1334，幕必须铺满它，否则边缘会露一条缝）。
 */
export function drawWallWipe(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  elapsed: number,
  skin: WipeSkin,
): void {
  const ms = skin.ms ?? WIPE_MS;
  const glaze = skin.kind === 'glaze';
  // 釉光边的位移比幕身**早 60ms**（设计稿「光边先于内容 60ms」）——
  // 光先到，面后到，读起来是"光扫过去、露出下面的东西"，
  // 而不是"一块幕布带着亮边一起移"
  const t = glaze ? (elapsed + LEAD_MS) / ms : elapsed / ms;
  if (t < 0 || t >= 1) return;
  const e = easeSweep(t);
  // 102%：退到屏外要多走 2%，否则右边会留下一条 1px 的残边
  const x0 = box.x + e * box.w * 1.02;
  if (x0 >= box.x + box.w) return;

  const yTop = box.y - SEG;
  const yBot = box.y + box.h + SEG;
  const xRight = x0 + box.w + SEG;

  // 幕的形状：左边是撕边（glaze 形态下是直边），右边一定在屏外。
  //
  // 不用 `Path2D`：微信小游戏的 2d 上下文中它要看基础库版本，
  // 而这条路每次切页都要走 —— 拿 `beginPath/lineTo` 画两遍是最稳的。
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(glaze ? x0 : edgeX(x0, yTop), yTop);
    if (glaze) {
      ctx.lineTo(x0, yBot);
    } else {
      for (let y = yTop + SEG; y <= yBot; y += SEG) ctx.lineTo(edgeX(x0, y), y);
    }
    ctx.lineTo(xRight, yBot);
    ctx.lineTo(xRight, yTop);
    ctx.closePath();
  };

  ctx.save();
  trace();
  ctx.clip();

  // 幕身：148° 的受光面 → 收暗面（和设计稿的 `linear-gradient(148deg,…)` 同向）
  const g = ctx.createLinearGradient(x0, box.y, x0 + box.w, box.y + box.h);
  g.addColorStop(0, skin.from);
  g.addColorStop(1, skin.to);
  ctx.fillStyle = g;
  ctx.fillRect(x0 - AMP, yTop, box.w + AMP * 2 + SEG, yBot - yTop);

  if (glaze) {
    // 釉面本身的反光：设计稿 `radial-gradient(118% 118% at 27% 19%, #fff .4, transparent 48%)`
    // —— 幕是一整块**釉**，它自己就有一片左上高光，不是一块平色布
    const sx = x0 + box.w * 0.27;
    const sy = box.y + box.h * 0.19;
    const reach = Math.hypot(box.w, box.h) * 0.55;
    const sheen = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach);
    sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0 - AMP, yTop, box.w + AMP * 2 + SEG, yBot - yTop);
  } else {
    // 矿物颗粒：墙不是一块色板。贴图里已经烘了疏密，这里只给强度
    fillGrain(ctx, x0 - AMP, yTop, box.w + AMP * 2 + SEG, yBot - yTop, 0.85);

    // 断面暗影：墙皮撕开之后，退开的那一面在背后压出一道暗
    const sh = ctx.createLinearGradient(x0, 0, x0 + SHADOW, 0);
    sh.addColorStop(0, skin.edge ?? 'rgba(72,42,18,0.34)');
    sh.addColorStop(1, 'rgba(72,42,18,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x0 - AMP, box.y, SHADOW + AMP * 2, box.h);
  }

  ctx.restore();

  if (glaze) {
    // 釉光边：一条 42px 的竖直白光带，贴在撕口上。
    //
    // 设计稿 `filter: blur(2px)` —— 这里用三层同心渐变逼近（真 blur 会让
    // 每帧多一次离屏合成，切页那一刻正是最吃帧的时候）：
    // 中间一格最亮，两侧 21px 内退干净。
    const eg = ctx.createLinearGradient(x0 - GLOW, 0, x0 + GLOW, 0);
    eg.addColorStop(0, 'rgba(255,255,255,0)');
    eg.addColorStop(0.34, 'rgba(255,255,255,0.30)');
    eg.addColorStop(0.5, 'rgba(255,255,255,0.66)');
    eg.addColorStop(0.66, 'rgba(255,255,255,0.30)');
    eg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.fillStyle = eg;
    ctx.fillRect(x0 - GLOW, box.y, GLOW * 2, box.h);
    ctx.restore();
    return;
  }

  // 断面受光：亮的一线在撕口上，断面才有厚度。
  // （设计稿的撕边是"剥开"的，不是"抠掉"的 —— 就差这一线光）
  ctx.save();
  ctx.lineJoin = 'round';
  trace();
  ctx.strokeStyle = 'rgba(255,247,228,0.50)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

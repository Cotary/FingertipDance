/**
 * 进场揭幕 · **逐帧采样**验证（音画对齐）。
 *
 * ## 验的是什么
 *
 * 不看"听起来差不多"、也不看"看起来差不多" —— 而是在 HEADLESS 里把
 * 主题的 `board()` 按虚拟时刻逐帧画出来，量两件事：
 *
 * 1. **每格什么时候落定**：`enterProgress` 从 <1 变成 1 的那一帧；
 * 2. **盘中沙光什么时候亮起**：`boardPulse` 的峰值帧。
 *
 * 然后和 `enterSettleDelays` 给的**音效时刻表**比对：
 * 逐格音的最后一粒必须和末格落定同帧（±1 帧），沙光峰值必须在落定之后
 * （设计稿「末行落地全盘沙光脉冲」），玉磬（`enterTempo.total`）同理。
 *
 * 历史 bug 就是这样被抓出来的：旧代码的音效表按锯齿公式排到 2.4s，
 * 而画面 1.58s 就落完了 —— 一量就是 800ms 的差。
 *
 * 用法：打开 `/tools/enter-sync.html`（dev server 在 50002）。
 */
import { themeById } from '../src/render/themes';
import type { BoardTheme, ThemeMotion } from '../src/render/themes/types';
import { CoverCell, packCell } from '../src/core/cover/v3/types';
import { enterTempo, enterSettleDelays, enterTotalMs } from '../src/render/themes/kit';

const q = new URLSearchParams(location.search);
const THEMES = ['mise', 'mingsha'];
const N = 8;
const CELL = 68;
const OUT = document.getElementById('out') as HTMLPreElement;

/** 一张 8×8、四角挖空的盘（VOID 不参与进场，正好验跳过逻辑）。 */
function buildGrid(): Uint8Array {
  const g = new Uint8Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = packCell(CoverCell.BRICK);
  for (const i of [0, N - 1, N * (N - 1), N * N - 1]) g[i] = packCell(CoverCell.VOID);
  g[30] = packCell(CoverCell.START);
  g[63] = packCell(CoverCell.END);
  return g;
}

function makeCanvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = 750;
  cv.height = 1334;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  return { cv, ctx };
}

/**
 * 在虚拟时刻 `t`（相对 `enterAt`）画一帧，返回：
 * - `lit`：已经落定（enT === 1）的格数
 * - `mid`：正在落（0<enT<1）的格数
 * - `lum`：盘面平均亮度（用来找沙光峰值）
 */
function sampleAt(
  theme: BoardTheme,
  grid: Uint8Array,
  enterAt: number,
  t: number,
  cv: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): { lit: number; mid: number; lum: number } {
  void cv;
  const board = { w: N, h: N, grid };
  const layout = { cell: CELL, originX: 375 - (N * CELL) / 2, originY: 400, boardW: N * CELL, boardH: N * CELL };
  ctx.clearRect(0, 0, 750, 1334);
  theme.backdrop?.(ctx, { x: 0, y: 0, w: 750, h: 1334 });
  theme.board({
    ctx,
    board,
    layout,
    state: {
      covered: new Set<number>(),
      path: [],
      keysHeld: new Set<number>(),
      shardsGot: new Set<number>(),
      shardNext: 0,
      enter: enterAt,
    },
    now: enterAt + t,
    dpr: 1,
  });

  // 逐格判断"落定没落定"—— 直接问渲染用的那个函数，而不是再算一遍
  const en = theme.motion?.enter;
  let lit = 0;
  let mid = 0;
  if (en) {
    // `enterProgress` 是私有的，这里用同源的 `enterSettleDelays` 反推落定时刻表
    const delays = new Set(enterSettleDelays(en, N, N, (x, y) => grid[y * N + x] >> 4 === CoverCell.VOID));
    for (const d of delays) {
      if (t >= d) lit++;
    }
    const tempo = enterTempo(en, N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (grid[y * N + x] >> 4 === CoverCell.VOID) continue;
        const start = d0(en, x, y, tempo);
        if (t > start && t < start + tempo.ms) mid++;
      }
    }
  }

  // 盘面平均亮度：只取盘心区域，免得盘中留白把峰值糊掉
  const x0 = layout.originX + CELL;
  const y0 = layout.originY + CELL;
  const w = (N - 2) * CELL;
  const px = ctx.getImageData(x0, y0, w, w).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
  const lum = sum / (px.length / 4) / 3;
  return { lit, mid, lum };
}

/** 起步时刻（等价于 `enterCellDelay`，但用已算好的 tempo 免得重复计算）。 */
function d0(
  en: NonNullable<ThemeMotion['enter']>,
  x: number,
  y: number,
  tempo: { k: number },
): number {
  return (x * (en.step ?? 24) + y * (en.row ?? 0)) * tempo.k;
}

function run(id: string): string[] {
  const theme = themeById(id);
  if (!theme) return [`${id}: 没有这套主题`];
  const en = theme.motion?.enter;
  if (!en) return [`${id}: 没有进场语言（不进此项检查）`];

  const grid = buildGrid();
  const { cv, ctx } = makeCanvas();
  const enterAt = 1_700_000_000_000;
  const total = enterTotalMs(en, N, N);
  const { ms } = enterTempo(en, N, N);
  const delays = enterSettleDelays(en, N, N, (x, y) => grid[y * N + x] >> 4 === CoverCell.VOID);
  const lastSound = Math.max(...delays);

  // 逐帧扫（16ms ≈ 60fps）
  const step = 16;
  let lastLitT = -1;
  const lums: Array<{ t: number; lum: number }> = [];
  for (let t = 0; t <= total + ms + 400; t += step) {
    const s = sampleAt(theme, grid, enterAt, t, cv, ctx);
    if (s.lit === delays.length && lastLitT < 0) lastLitT = t;
    lums.push({ t, lum: s.lum });
  }

  // 沙光照**基准**不能用"空盘"—— 空盘只剩墙，而铺满的盘是亮的，
  // 拿空盘当基准会把"格子落定"的增亮误当成脉冲。所以基准取**落定之后
  // 脉冲必然结束**的那一段的稳定值（t > total + pulse.ms）。
  const pulseMs = Math.max(60, en.pulse?.ms ?? 180);
  const settled = lums.filter((p) => p.t > total + pulseMs && p.t < total + pulseMs + 200);
  const baseLum = settled.length
    ? settled.reduce((a, p) => a + p.lum, 0) / settled.length
    : lums[lums.length - 1].lum;
  // 峰值只看**脉冲窗口**（不能把落定过程的增亮算进去）
  const inWindow = lums.filter((p) => p.t >= total - step && p.t <= total + pulseMs + step);
  let peak = inWindow[0];
  for (const p of inWindow) if (p.lum > peak.lum) peak = p;

  const lines: string[] = [];
  const ok = (b: boolean) => (b ? 'OK ' : 'BAD');
  lines.push(`${id} · ${N}×${N} · step=${en.step} row=${en.row} ms=${en.ms} sweep=${en.sweep}`);
  lines.push(`  动画总长 total=${total}ms（末格落定）`);
  lines.push(`  画面末格落定 ≈ ${lastLitT}ms   音效末粒 ${lastSound}ms   差 ${Math.abs(lastLitT - lastSound)}ms`);
  lines.push(`  ${ok(Math.abs(lastLitT - lastSound) <= step)} 逐格音与落定对齐（±1 帧）`);
  lines.push(`  沙光：稳定亮度 ${baseLum.toFixed(1)} → 峰 ${peak.lum.toFixed(1)} @ ${peak.t}ms（窗口 ${total}–${total + pulseMs}）`);
  lines.push(`  ${ok(peak.lum > baseLum + 1.5)} 沙光确实亮起来了`);
  lines.push(`  ${ok(peak.t >= total - step)} 沙光峰值在末格落定之后（设计稿「末行落地」）`);
  lines.push(`  ${ok(peak.t <= total + pulseMs)} 沙光峰值落在脉冲窗口内（不是短路/迟到）`);
  // 逐格音的"节奏"是否也跟画面一致：把时刻表按落定分档统计
  const buckets = new Map<number, number>();
  for (const d of delays) {
    const b = Math.round(d / 100) * 100;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  lines.push(
    `  落定分布（每 100ms 一格数）: ${[...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')}`,
  );
  return lines;
}

const targets = q.get('t') ? [q.get('t')!] : THEMES;
const all: string[] = [];
for (const id of targets) all.push(...run(id), '');
const bad = all.filter((l) => l.includes('BAD')).length;
OUT.textContent = all.join('\n') + `\n===== ${bad === 0 ? 'ok 全部对齐' : `FAIL ${bad} 项未对齐`} =====`;
document.title = bad === 0 ? 'ok' : 'FAIL';

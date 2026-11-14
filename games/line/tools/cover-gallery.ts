/**
 * Cover 模式棋盘画廊（真 canvas）。
 *
 * ## 为什么需要它
 *
 * `live-gallery.ts` 里的「游戏内 / 结算」两屏画的是**经典模式**的 7×7 棋盘。
 * cover 模式的棋盘（不规则轮廓 + 11 种格子 + 机制标记）从来没进过画廊，
 * 也就是说它**一次都没被眼睛审过** —— 这是它悄悄变丑的根因。
 *
 * 用法：
 *   /tools/cover-gallery.html?idx=200&fill=0.65
 *   chrome --headless=new --screenshot=out.png --window-size=750,1334 <url>
 */
import { DESIGN_W, DESIGN_H, computeLayout } from '../src/render/layout';
import { clayBackdrop } from '../src/ui/clay';
import { drawCoverCells, drawCoverEndpoints, drawCoverFreeStartHint, drawCoverHead, drawCoverMarks, drawCoverPlate, type CoverRenderState } from '../src/render/coverBoard';
import { drawCoverTrail } from '../src/render/coverTrail';
import { drawHud, drawProgressBar, drawButton, type Button } from '../src/ui/hud';
import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import { findCoverHint } from '../src/game/coverHint';
import { beginCoverDrag, createCoverState, setHintPlan, tryCoverMove } from '../src/game/coverState';

import type { LevelEntry } from '../src/core/cover/v3/codec';
import { CLAY } from '../src/ui/clay';
import { skinById } from '../src/render/skins';
import { drawGildedChrome } from '../src/render/themes/gilded';
import { themeById } from '../src/render/themes';
import { decodeSolution } from '../src/core/cover/v3/codec';
import clientTable from '../data/levels-v3-client.json';
import serverTable from '../data/levels-v3.json';

const TABLE = clientTable as unknown as { levels: LevelEntry[] };
/** 服务端表含参考解；画廊用它造「走到一半」的画面，避免浏览器里跑求解器。 */
const SOLUTIONS = serverTable as unknown as { levels: Array<{ idx: number; solution?: string }> };

const params = new URLSearchParams(location.search);
const idx = Math.max(1, Math.min(TABLE.levels.length, Number(params.get('idx') ?? 1)));
const fill = Math.max(0, Math.min(1, Number(params.get('fill') ?? 0.65)));
const skinId = params.get('skin') ?? 'mint';
/**
 * 主题：`clay`（默认，现有黏土管线）或 `gilded`（金线装饰 · 验证渲染）。
 *
 * 走 gilded 时**完全不调用** coverBoard / coverTrail，
 * 由 `src/render/themes/gilded.ts` 独立画整张盘面 —— 主管线一行没改。
 */
/** 传任意主题 id（`bamboo` / `frost` / `glass` / `gilded` …）即走主题管线。 */
const themeName = params.get('theme') ?? 'clay';
const theme = themeById(themeName);

const entry = TABLE.levels[idx - 1];
const level = decodeCoverLevel(entry);
const rt = buildCoverRuntime(level);
const layout = computeLayout(level.w, level.h);

/**
 * 取参考解（服务端表里有），转成局部编号序列。
 *
 * 不用浏览器里跑求解器：10×10 上 Warnsdorff + `visited.slice()` 太慢，
 * 截图会超时；而且参考解才是「真实玩家按最优解走」的画面，更有代表性。
 */
function referencePath(): number[] {
  const sol = SOLUTIONS.levels.find((l) => l.idx === idx)?.solution;
  if (!sol) return [];
  const flat = decodeSolution(sol, level.w);
  const local: number[] = [];
  for (const f of flat) {
    const l = rt.rs.localOf[f];
    if (l >= 0) local.push(l);
  }
  return local;
}

const full = referencePath();
const keep = Math.round(full.length * fill);
const pathLocal = full.slice(0, keep);
const flatPath = pathLocal.map((l) => rt.rs.flatOf[l]);

const covered = new Set<number>(flatPath);
const keysHeld = new Set<number>();
const shardsGot = new Set<number>();
let shardTotal = 0;
for (let i = 0; i < rt.rs.typeOf.length; i++) if (rt.rs.typeOf[i] === 4) shardTotal++;
for (const l of pathLocal) {
  if (rt.rs.typeOf[l] === 5) keysHeld.add(rt.rs.groupOf[l]);
  if (rt.rs.typeOf[l] === 4) shardsGot.add(rt.rs.groupOf[l]);
}
// 与游戏内一致：星屑顺序必经，下一个 = 已收集数量
const shardNext = shardsGot.size < shardTotal ? shardsGot.size : -1;

const canvas = document.createElement('canvas');
canvas.width = DESIGN_W;
canvas.height = DESIGN_H;
canvas.style.width = `${DESIGN_W}px`;
canvas.style.height = `${DESIGN_H}px`;
document.body.appendChild(canvas);

// 放大审图：`?zoom=3&fx=375&fy=700` 把设计坐标 (fx, fy) 那一点放大后居中。
// 小尺寸筹码（13px 的星、7px 的编号徽章）只有在放大后才知道能不能读。
const zoom = Number(params.get('zoom') ?? 1);
if (zoom !== 1) {
  const fx = Number(params.get('fx') ?? 375);
  const fy = Number(params.get('fy') ?? 700);
  document.body.style.overflow = 'hidden';
  canvas.style.position = 'absolute';
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `translate(${375 - fx * zoom}px, ${375 - fy * zoom}px) scale(${zoom})`;
}

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('no 2d context');

const NOW = 1_700_000_000_000;
const boardArg = { w: level.w, h: level.h, grid: level.grid };

/**
 * `?hint=1` 叠一条真实求解出来的提示路线。
 *
 * 提示是**动画**（错峰点亮 + 呼吸），静态截图只能看到某一瞬间，
 * 所以用 `?t=900` 指定「点亮后多久」再拍 —— 默认 900ms，
 * 五格全亮且呼吸处在中间相位，最接近玩家实际看到的画面。
 */
const hintT = Number(params.get('t') ?? 900);
let hintPlan = null;
if (params.get('hint') === '1' && pathLocal.length > 0) {
  const st = createCoverState(rt);
  if (beginCoverDrag(st, pathLocal[0])) {
    for (let i = 1; i < pathLocal.length; i++) tryCoverMove(st, pathLocal[i]);
    console.log(`重放 ${st.path.length}/${pathLocal.length}`);
    const h = findCoverHint(st);
    if (h.found && h.cells.length > 0) {
      setHintPlan(st, h.cells, NOW);
      hintPlan = st.hint;
      console.log(`提示路线 ${h.cells.length} 格 / 窗口 ${hintPlan?.litAt.filter((t) => t > 0).length ?? 0} 格亮 / 求解 ${h.ms}ms`);
    }
  }
}

// 提示只画窗口内的 5 格（与游戏内规则一致）
const hintCells =
  hintPlan && hintPlan.cells.length > 0
    ? hintPlan.cells.slice(hintPlan.at, hintPlan.at + 5)
    : undefined;

if (theme) {
  const box = { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H };
  theme.backdrop(ctx, box);
  theme.board({
    ctx,
    board: boardArg,
    layout,
    state: { covered, path: flatPath, keysHeld, shardsGot, shardNext, hint: hintCells },
    now: NOW + hintT,
    dpr: 1,
  });
  // 金线那套有自己的 chrome；其余主题用一条极简信息带，避免深底上深墨看不见
  if (theme.id === 'gilded') {
    drawGildedChrome(ctx, {
      idx: level.idx,
      name: 'GILDED DECO',
      done: flatPath.length,
      total: level.required,
      w: DESIGN_W,
      h: DESIGN_H,
    });
  } else {
    drawThemeChrome(ctx, theme.name, level.idx, flatPath.length, level.required);
  }
} else {
  clayBackdrop(ctx);
  const state: CoverRenderState = {
    covered,
    path: flatPath,
    hint: hintPlan,
    keysHeld,
    shardsGot,
    shardNext,
    shakeCell: -1,
    shakeAt: 0,
  };
  drawCoverPlate(ctx, boardArg, layout, level.idx, 1);
  drawCoverCells(ctx, boardArg, layout, state, skinById(skinId), NOW);
  drawCoverTrail(ctx, flatPath, level.w, level.grid, layout, CLAY.terracotta);
  drawCoverMarks(ctx, boardArg, layout, state);
  drawCoverHead(ctx, boardArg, layout, state, NOW + hintT);
  drawCoverEndpoints(ctx, boardArg, layout);
  // D=0 的开局提示（与游戏内一致）
  if (level.deadEnds === 0 && flatPath.length === 0) drawCoverFreeStartHint(ctx, layout);

  drawHud(ctx, level.idx, skinById(skinId).name, 6, 16, {
    done: flatPath.length,
    total: level.required,
    shardNext,
  });
  drawProgressBar(ctx, Math.min(1000, idx), 1000);

  const btns: Button[] = [
    { x: 40, y: 100, w: 90, h: 60, label: '返回', kind: 'ghost', id: 'backHome' },
    { x: DESIGN_W - 210, y: 100, w: 90, h: 60, label: '提示', kind: 'ghost', id: 'hint' },
    { x: DESIGN_W - 110, y: 100, w: 90, h: 60, label: '跳过', kind: 'ghost', id: 'skip' },
  ];
  for (const b of btns) drawButton(ctx, b, false);
}

// 调试信息：截图时能看出这盘是什么类型
console.log(
  `L${idx} ${level.w}x${level.h} required=${level.required} mech=${level.mechKinds} ` +
    `D=${level.deadEnds} 解长=${full.length} 已铺=${flatPath.length}`,
);
document.title = `ready:${idx}`;


/** 主题页的极简信息带（画廊专用）。深色主题下不能用黏土墨色。 */
function drawThemeChrome(
  ctx: CanvasRenderingContext2D,
  name: string,
  levelIdx: number,
  done: number,
  total: number,
): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${levelIdx}`, 56, 118);
  ctx.font = '400 20px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.46)';
  ctx.fillText(name, 56, 152);
  ctx.textAlign = 'right';
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.66)';
  ctx.fillText(`${done} / ${total}`, DESIGN_W - 56, 130);
  ctx.restore();
}

import { platform } from './platform';
import { login, fetchConfig, fetchLevels } from './net/api';
import { createState, findStart, tryMove, release, type GameState } from './game/state';
import { computeLayout, DESIGN_W, DESIGN_H, type BoardLayout } from './render/layout';
import { drawBoard, type Palette } from './render/board';
import { drawTrail } from './render/trail';

const PALETTE: Palette = {
  block: '#39415C',
  brick: '#5A6480',
  brickLit: '#6692F5',
  oneway: '#9B7BE8',
  start: '#5EA94C',
  end: '#E97E6A',
};

const { canvas, width, height, dpr } = platform.getCanvas();
const ctx = canvas.getContext('2d')!;

/** 缩放与偏移。 */
const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
const offsetX = (width - DESIGN_W * scale) / 2;
const offsetY = (height - DESIGN_H * scale) / 2;

let state: GameState | null = null;
let layout: BoardLayout | null = null;
let pointerDown = false;

/** 画布坐标 → 设计坐标系坐标。 */
function toDesign(clientX: number, clientY: number): { x: number; y: number } {
  if (platform.name === 'wechat') {
    // 微信触摸事件给的是逻辑像素，直接用
    return { x: (clientX - offsetX) / scale, y: (clientY - offsetY) / scale };
  }
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvas.width / rect.width);
  const py = (clientY - rect.top) * (canvas.height / rect.height);
  return { x: (px / dpr - offsetX) / scale, y: (py / dpr - offsetY) / scale };
}

/** 设计坐标 → 最近的格子索引。 */
function pickCell(dx: number, dy: number): number {
  if (!state || !layout) return -1;
  const { cell, originX, originY } = layout;
  const x = Math.floor((dx - originX) / cell);
  const y = Math.floor((dy - originY) / cell);
  if (x < 0 || y < 0 || x >= state.level.w || y >= state.level.h) return -1;
  return y * state.level.w + x;
}

/** 触摸事件处理。 */
function onDown(clientX: number, clientY: number) {
  if (!state || state.phase !== 'idle') return;
  const d = toDesign(clientX, clientY);
  const idx = pickCell(d.x, d.y);
  if (idx !== findStart(state.level)) return;
  state.phase = 'dragging';
  state.path = [idx];
  state.lit.add(idx);
  pointerDown = true;
}

function onMove(clientX: number, clientY: number) {
  if (!state || !pointerDown) return;
  const d = toDesign(clientX, clientY);
  const idx = pickCell(d.x, d.y);
  if (idx < 0) return;
  const result = tryMove(state, idx);
  if (result === 'break') {
    platform.vibrate();
  }
}

function onUp() {
  if (!state || !pointerDown) return;
  pointerDown = false;
  const won = release(state);
  if (won) console.log('通关！步数', state.path.length - 1);
}

// Web 端事件绑定
if (platform.name === 'web') {
  canvas.addEventListener('pointerdown', (e) => onDown(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}

/** 渲染循环。 */
function frame() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr * scale, dpr * scale);
  ctx.translate(offsetX / dpr, offsetY / dpr);

  // 背景
  ctx.fillStyle = '#141824';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  if (state && layout) {
    drawBoard(ctx, state.level, layout, {
      lit: state.lit,
      path: state.path,
      hint: state.hint,
      shakeCell: state.shakeCell,
      shakeAt: state.shakeAt,
    }, PALETTE, Date.now());

    drawTrail(ctx, state.path, state.level.w, layout, '#6692F5', 'rgba(102,146,245,0.35)');
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** 启动流程。 */
async function boot() {
  try {
    await login();
    const cfg = await fetchConfig();
    const levels = await fetchLevels(1, 20);
    if (levels.length === 0) throw new Error('关卡表为空');
    state = createState(levels[0]);
    layout = computeLayout(levels[0].w, levels[0].h);
    console.log('启动成功，关卡版本', cfg.levelVersion);
  } catch (e) {
    console.error('启动失败', e);
  }
}
boot();

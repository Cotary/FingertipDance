import { platform } from './platform';
import { login, fetchConfig, reportProgress, reportSkip, reportEvent } from './net/api';
import { Session } from './game/session';
import { LevelStore, ProgressStore } from './game/progressStore';
import { DESIGN_W, DESIGN_H } from './render/layout';
import { drawBoard, type Palette } from './render/board';
import { drawTrail } from './render/trail';
import { Fx } from './render/fx';
import { audio } from './render/audio';
import { drawHud, drawProgressBar, drawResult, drawButton, hitButton, type Button } from './ui/hud';
import { findHint } from './core/solver';
import { CellType } from './core/types';
import type { GameState } from './game/state';

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

const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
const offsetX = (width - DESIGN_W * scale) / 2;
const offsetY = (height - DESIGN_H * scale) / 2;

const session = new Session();
const levels = new LevelStore();
const progress = new ProgressStore();
const fx = new Fx();

let lastFrameAt = Date.now();
let winAnimStart = 0;
let waveLit = new Set<number>();

let config: any = null;
let phase: 'loading' | 'playing' | 'result' = 'loading';
let resultButtons: Button[] = [];
let resultData: { levelIdx: number; steps: number; shortest: number; timeMs: number; unlockedSkin: any } | null = null;
let pressedBtn: string | null = null;
let pendingLevel = 1;

/** 画布坐标 → 设计坐标。 */
function toDesign(clientX: number, clientY: number): { x: number; y: number } {
  if (platform.name === 'wechat') {
    return { x: (clientX - offsetX) / scale, y: (clientY - offsetY) / scale };
  }
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvas.width / rect.width);
  const py = (clientY - rect.top) * (canvas.height / rect.height);
  return { x: (px / dpr - offsetX) / scale, y: (py / dpr - offsetY) / scale };
}

/** 顶部操作按钮。 */
const hintBtn: Button = { x: DESIGN_W - 210, y: 100, w: 90, h: 60, label: '提示', kind: 'ghost', id: 'hint' };
const skipBtn: Button = { x: DESIGN_W - 110, y: 100, w: 90, h: 60, label: '跳过', kind: 'ghost', id: 'skip' };

session.on((e) => {
  if (e.type === 'won') { audio.win(); void onWin(e.steps, e.timeMs, e.path); }
  if (e.type === 'break') { audio.break(); platform.vibrate(); }
  if (e.type === 'moved') {
    audio.light();
    const st = session.state;
    if (st && session.layout) {
      fx.burstAt(e.idx, st.level.w, session.layout.cell, session.layout.originX, session.layout.originY, '#F2C14E');
    }
    reportEvent('tile_light', { level_idx: session.state?.level.idx });
  }
  if (e.type === 'abandoned') reportEvent('level_abandon', { level_idx: session.state?.level.idx });
});

/** 通关处理：上报成绩。 */
async function onWin(steps: number, timeMs: number, path: number[]) {
  const level = session.state!.level;
  // 通关波次动画（约 1.2 秒），结算页延后出现
  winAnimStart = Date.now();
  fx.clear();
  reportEvent('level_pass', { level_idx: level.idx, steps, time_ms: timeMs, skipped: false });

  let unlockedSkin: any = null;
  try {
    const res = await reportProgress(level.idx, steps, timeMs, path);
    unlockedSkin = res.unlockedSkin;
    if (res.unlockedSkin) {
      progress.unlockSkin(res.unlockedSkin.id);
      audio.unlock();
      platform.vibrate();
    }
    progress.sync({ maxLevel: res.maxLevel, unlockedSkins: res.unlockedSkins });
  } catch (e) {
    console.error('上报成绩失败', e);
  }

  resultData = {
    levelIdx: level.idx,
    steps,
    shortest: level.shortest,
    timeMs,
    unlockedSkin,
  };
  pendingLevel = level.idx + 1;

  // 结算页延后出现，让通关波次动画播完
  setTimeout(() => { phase = 'result'; }, 1200);
}

/** 进入关卡。 */
async function enterLevel(idx: number) {
  const lv = await levels.ensure(idx, config.levelVersion);
  if (!lv) {
    console.error('关卡加载失败', idx);
    return;
  }
  session.load(lv);
  phase = 'playing';
  winAnimStart = 0;
  waveLit = new Set();
  fx.clear();
  reportEvent('level_start', { level_idx: idx, diff: lv.diff, w: lv.w, h: lv.h });
}

/** 使用提示。 */
async function useHint() {
  const st = session.state;
  if (!st || (st.phase !== 'idle' && st.phase !== 'dragging')) return;
  const head = st.path.length ? st.path[st.path.length - 1] : findStartIdx(st);
  const hint = findHint(st.level.grid, { x: head % st.level.w, y: Math.floor(head / st.level.w) }, 2);
  if (hint.length === 0) {
    console.log('当前无法给出提示');
    return;
  }
  // 广告逻辑在 T17 接入；当前直接给提示
  session.setHint(hint);
  reportEvent('hint_use', { level_idx: st.level.idx, via_ad: false });
}

/** 跳过关卡。 */
async function useSkip() {
  const st = session.state;
  if (!st) return;
  // 广告逻辑在 T17 接入
  await reportSkip(st.level.idx);
  session.markSkipped();
  await onWin(st.level.shortest, 0, []);
  reportEvent('skip_use', { level_idx: st.level.idx, via_ad: true });
}

/** 找起点索引。 */
function findStartIdx(st: GameState): number {
  for (let y = 0; y < st.level.h; y++) {
    for (let x = 0; x < st.level.w; x++) {
      if (st.level.grid[y][x].type === CellType.START) return y * st.level.w + x;
    }
  }
  return 0;
}

/** 指针按下。 */
function onDown(clientX: number, clientY: number) {
  const d = toDesign(clientX, clientY);
  if (phase === 'result') {
    for (const b of resultButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }
  if (phase !== 'playing') return;
  if (hitButton(hintBtn, d.x, d.y)) { pressedBtn = 'hint'; return; }
  if (hitButton(skipBtn, d.x, d.y)) { pressedBtn = 'skip'; return; }
  session.pointerDown(d.x, d.y);
}

/** 指针移动。 */
function onMove(clientX: number, clientY: number) {
  if (phase !== 'playing') return;
  const d = toDesign(clientX, clientY);
  session.pointerMove(d.x, d.y);
}

/** 指针抬起。 */
function onUp() {
  if (pressedBtn) {
    const id = pressedBtn;
    pressedBtn = null;
    if (id === 'hint') void useHint();
    else if (id === 'skip') void useSkip();
    else if (id === 'next') void enterLevel(pendingLevel);
    else if (id === 'share') { void platform.share({ title: `我卡在第 ${session.state?.level.idx ?? 1} 关` }); reportEvent('share_click', {}); }
    else if (id === 'skins') { /* T16 实现皮肤页 */ }
    return;
  }
  if (phase === 'playing') session.pointerUp();
}

// Web 事件绑定
if (platform.name === 'web') {
  canvas.addEventListener('pointerdown', (e) => onDown(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
}

/** 记录帧时间。 */
function tick() {
  const now = Date.now();
  const dt = Math.min(50, now - lastFrameAt);
  lastFrameAt = now;
  return { now, dt };
}

/** 更新通关波次点亮状态（从终点反向扩散）。 */
function updateWave(now: number) {
  waveLit = new Set();
  const st = session.state;
  if (!st || !winAnimStart) return;
  const elapsed = now - winAnimStart;
  const total = st.path.length;
  for (let i = 0; i < total; i++) {
    const delay = (total - 1 - i) * 60;
    if (elapsed >= delay) waveLit.add(st.path[i]);
  }
}

/** 渲染循环。 */
function frame() {
  const { now, dt } = tick();
  updateWave(now);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr * scale, dpr * scale);
  ctx.translate(offsetX / dpr, offsetY / dpr);

  ctx.fillStyle = '#141824';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  const st = session.state;
  if (st && session.layout) {
    const lit = new Set(st.lit);
    for (const idx of waveLit) lit.add(idx);

    drawBoard(ctx, st.level, session.layout, {
      lit,
      path: st.path,
      hint: st.hint,
      shakeCell: st.shakeCell,
      shakeAt: st.shakeAt,
    }, PALETTE, now);

    drawTrail(ctx, st.path, st.level.w, session.layout, '#6692F5', 'rgba(102,146,245,0.35)');

    drawHud(ctx, st.level.idx, progress.current.currentSkin, progress.current.unlockedSkins.length, config?.skins?.length ?? 13);
    drawProgressBar(ctx, progress.current.maxLevel, config?.levelCount ?? 1000);

    // 顶部按钮
    drawButton(ctx, hintBtn, pressedBtn === 'hint');
    drawButton(ctx, skipBtn, pressedBtn === 'skip');
  }

  // 特效（粒子 + 扩散环）
  fx.update(ctx, dt);

  if (phase === 'result' && resultData) {
    resultButtons = drawResult(
      ctx, resultData.levelIdx, resultData.steps, resultData.shortest,
      resultData.timeMs, resultData.unlockedSkin,
      progress.current.maxLevel / (config?.levelCount ?? 1000),
    );
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** 启动。 */
async function boot() {
  progress.restore();
  try {
    const loginRes = await login();
    progress.sync({
      maxLevel: loginRes.maxLevel || 1,
      unlockedSkins: loginRes.unlockedSkins,
    });
    config = await fetchConfig();
    await levels.init(config.levelVersion);
    const startIdx = Math.min(progress.current.maxLevel || 1, levels.loadedMax || 1);
    await enterLevel(startIdx);
    reportEvent('app_start', {});
  } catch (e) {
    console.error('启动失败', e);
    phase = 'loading';
  }
}
boot();

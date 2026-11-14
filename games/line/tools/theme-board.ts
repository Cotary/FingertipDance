/**
 * 单套主题的「真机尺寸」预览。
 *
 * ## 为什么需要它
 *
 * 皮肤页的展台格是 66px，而真实关卡是 28~40px —— 线宽、图标、提示环在
 * 缩到一半之后都可能糊掉（第一批就踩过：星座图标 0.09 线宽在 28px 格上只剩 1px）。
 * 展台好看不等于真机好看。
 *
 * 用法：
 *   /tools/theme-board.html?t=ink        → 水墨，7×7 真机盘
 *   /tools/theme-board.html?t=pixel&c=36 → 指定格宽
 *
 * 盘面里刻意摆齐九类机制（起点、终点、单向、星、冰、钥匙、门、石头、传送门），
 * 一套主题的图标族有没有崩，一张图就能看出来。
 */
import { THEMES, themeById } from '../src/render/themes';
import { CoverCell, DIR, packCell } from '../src/core/cover/v3/types';
import { drawHud, drawProgressBar, drawButton, type Button } from '../src/ui/hud';

const q = new URLSearchParams(location.search);
const id = q.get('t') ?? 'ink';
const theme = themeById(id) ?? THEMES[0];

const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;

const N = 7;
const cell = Number(q.get('c') ?? 64);
const bw = cell * N;
const ox = Math.round((750 - bw) / 2);
const oy = 262;

function buildGrid(): Uint8Array {
  const g = new Uint8Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = packCell(CoverCell.BRICK);
  const put = (idx: number, type: number, dir = 0, group = 0) => {
    g[idx] = packCell(type, dir, group);
  };
  put(0, CoverCell.START);
  put(20, CoverCell.END);
  put(6, CoverCell.ONEWAY, DIR.RIGHT);
  put(10, CoverCell.SHARD, 0, 0);
  put(13, CoverCell.ICE);
  put(17, CoverCell.KEY, 0, 0);
  put(19, CoverCell.GATE, 0, 0);
  put(24, CoverCell.BLOCK);
  put(30, CoverCell.PORTAL, 0, 0);
  put(38, CoverCell.PORTAL, 0, 0);
  put(44, CoverCell.SHARD, 0, 1);
  return g;
}

const board = { w: N, h: N, grid: buildGrid() };

// 蛇形走 21 格：够长，能看出「走过 / 没走」的分界和提示环
const path: number[] = [];
for (let y = 0; y < 3; y++) {
  for (let k = 0; k < N; k++) path.push(y * N + (y % 2 === 0 ? k : N - 1 - k));
}

const now = 1_700_000_000_000;

theme.backdrop(ctx, { x: 0, y: 0, w: 750, h: 1334 });
theme.board({
  ctx,
  board,
  layout: { cell, originX: ox, originY: oy, boardW: bw, boardH: bw },
  state: {
    covered: new Set(path),
    path,
    keysHeld: new Set<number>(),
    shardsGot: new Set<number>(),
    shardNext: 0,
    hint: [21, 22, 23, 24, 25],
  },
  now,
  dpr: 2,
});

const chrome = theme.chrome;
drawHud(ctx, 38, '', 0, 0, { done: 21, total: 40, shardNext: 0 }, chrome);
drawProgressBar(ctx, 21, 40, '', chrome);

const btn: Button = { x: 40, y: 1074, w: 300, h: 84, label: '提示', kind: 'primary', id: 'hint' };
drawButton(ctx, btn, false, undefined, chrome);
const back: Button = { x: 400, y: 1074, w: 300, h: 84, label: '返回', kind: 'ghost', id: 'back' };
drawButton(ctx, back, false, undefined, chrome);

// 说明条：截图归档时靠它认出这是哪一套
ctx.fillStyle = 'rgba(0,0,0,0.45)';
ctx.fillRect(0, 1250, 750, 84);
ctx.fillStyle = '#FFFFFF';
ctx.font = '600 26px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(`${theme.id} · ${theme.name} · cell ${cell}`, 375, 1292);

document.title = `${theme.id}-${cell}`;

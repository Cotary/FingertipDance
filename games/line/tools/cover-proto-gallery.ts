/**
 * Cover 模式 v2 视觉原型画廊。
 *
 * 与 `cover-gallery.ts` 用**同一关、同一进度**渲染，只换绘制实现，
 * 这样「改前 / 改后」是可比的。
 *
 * 用法：/tools/cover-proto-gallery.html?idx=705&fill=0.6
 */
import { DESIGN_W, DESIGN_H, computeLayout } from '../src/render/layout';
import { clayBackdrop } from '../src/ui/clay';
import { drawCoverV2 } from './cover-proto';
import { drawHud, drawProgressBar, drawButton, type Button } from '../src/ui/hud';
import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import { decodeSolution, type LevelEntry } from '../src/core/cover/v3/codec';
import { skinById } from '../src/render/skins';
import { CoverCell, cellGroup, cellType } from '../src/core/cover/v3/types';
import clientTable from '../data/levels-v3-client.json';
import serverTable from '../data/levels-v3.json';

const TABLE = clientTable as unknown as { levels: LevelEntry[] };
const SOLUTIONS = serverTable as unknown as { levels: Array<{ idx: number; solution?: string }> };

const params = new URLSearchParams(location.search);
const idx = Math.max(1, Math.min(TABLE.levels.length, Number(params.get('idx') ?? 1)));
const fill = Math.max(0, Math.min(1, Number(params.get('fill') ?? 0.65)));
const skinId = params.get('skin') ?? 'mint';

const entry = TABLE.levels[idx - 1];
const level = decodeCoverLevel(entry);
buildCoverRuntime(level);
const layout = computeLayout(level.w, level.h);
const skin = skinById(skinId);

const sol = SOLUTIONS.levels.find((l) => l.idx === idx)?.solution;
const fullFlat = sol ? decodeSolution(sol, level.w) : [];
const keep = Math.round(fullFlat.length * fill);

const coveredSet = new Set<number>();
const path: number[] = [];
const keysHeld = new Set<number>();
const shardsGot = new Set<number>();
let shardNext = 0;
for (const flat of fullFlat.slice(0, keep)) {
  const t = cellType(level.grid[flat]);
  if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
  coveredSet.add(flat);
  path.push(flat);
  if (t === CoverCell.KEY) keysHeld.add(cellGroup(level.grid[flat]));
  if (t === CoverCell.SHARD) {
    shardsGot.add(cellGroup(level.grid[flat]));
    shardNext = cellGroup(level.grid[flat]) + 1;
  }
}

const canvas = document.createElement('canvas');
canvas.width = DESIGN_W;
canvas.height = DESIGN_H;
canvas.style.width = `${DESIGN_W}px`;
canvas.style.height = `${DESIGN_H}px`;
document.body.appendChild(canvas);

const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('no 2d context');

clayBackdrop(ctx);

drawCoverV2(ctx, { w: level.w, h: level.h, grid: level.grid }, layout, { covered: coveredSet, path, keysHeld, shardsGot, shardNext }, skin);

drawHud(ctx, level.idx, skin.name, 6, 16, {
  done: path.length,
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

document.title = `ready:${idx}`;

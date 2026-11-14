/**
 * v3 关卡全量校验（离线审计工具）。
 *
 * ## 做什么
 *
 * 读取 `data/levels-v3.json`（服务端版，含解），
 * 用 **与生成器完全相同** 的规则引擎（`core/cover/v3/rules.ts`）回放每一关的参考解：
 *
 *   1. 解码 grid → 构建规则集（局部编号体系）
 *   2. `replay(rs, path)` —— 逐步检查：
 *      移动合法性（含冰块滑行、单向门方向、钥匙门、传送门）
 *      星星收集顺序
 *      起终点约束
 *      **覆盖全部可走格**（不重复、不交叉）
 *   3. 统计机制分布与难度分布
 *
 * ## 为什么重要
 *
 * 生成器内部已做过回放校验，但那只覆盖「当次生成的候选」。
 * 本工具是对**落盘的最终文件**的独立审计 —— 能抓到
 * 序列化/编码环节引入的 bug（这正是历史上 `startAt` 用局部编号当拍平索引的那类问题）。
 *
 * ## 用法
 *
 * ```
 * npx tsx tools/audit-v3.ts
 * ```
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodeGrid, decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import { buildRuleSet, replay } from '../src/core/cover/v3/rules';
import { CoverCell, cellType } from '../src/core/cover/v3/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface LevelTableFile {
  version: string;
  count: number;
  generatedAt: string;
  hash: string;
  levels: LevelEntryWithSolution[];
}

const table = JSON.parse(
  readFileSync(join(ROOT, 'data', 'levels-v3.json'), 'utf8'),
) as LevelTableFile;

console.log(`版本: ${table.version}  数量: ${table.count}  生成于: ${table.generatedAt}`);

const failures: { idx: number; error: string }[] = [];
const mechCount: Record<string, number> = {};
const sizeCount: Record<string, number> = {};
let totalCells = 0;
let totalMech = 0;
let totalTurns = 0;
let totalCorridor = 0;
const diffBands = new Array(10).fill(0);
const Dcount = new Array(4).fill(0);
const solCount = new Array(10).fill(0);

for (const lv of table.levels) {
  const grid = decodeGrid(lv.grid, lv.w * lv.h);

  // 可走格 = 除了 VOID / BLOCK
  const cells: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    const t = cellType(grid[i]);
    if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
    cells.push(i);
  }

  // 解（拍平索引序列）
  const path = decodeSolution(lv.solution, lv.w);

  const rs = buildRuleSet(cells, grid, lv.w, lv.h);
  rs.startAt = lv.startAt >= 0 ? rs.localOf[lv.startAt] : -1;
  rs.endAt = lv.endAt >= 0 ? rs.localOf[lv.endAt] : -1;

  // 解是拍平索引 → 转成局部编号
  const localPath = path.map((f) => rs.localOf[f]);
  if (localPath.some((l) => l < 0)) {
    failures.push({ idx: lv.idx, error: '解包含不可走格' });
    continue;
  }

  const rp = replay(rs, localPath);
  if (!rp.ok) {
    failures.push({ idx: lv.idx, error: rp.error ?? '未知错误' });
    continue;
  }

  // 通过校验 —— 统计
  totalCells += lv.required;
  totalTurns += lv.turns;
  totalCorridor += lv.corridor;
  const kinds = new Set<number>();
  for (let i = 0; i < grid.length; i++) {
    const t = cellType(grid[i]);
    if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
    if (t !== CoverCell.BRICK && t !== CoverCell.START && t !== CoverCell.END) kinds.add(t);
  }
  totalMech += kinds.size;
  for (const k of kinds) {
    const name = Object.keys(CoverCell).find((key) => (CoverCell as never as Record<string, number>)[key] === k) ?? String(k);
    mechCount[name] = (mechCount[name] ?? 0) + 1;
  }
  const sizeKey = `${lv.w}x${lv.h}`;
  sizeCount[sizeKey] = (sizeCount[sizeKey] ?? 0) + 1;
  diffBands[Math.min(9, Math.floor(lv.diff / 10))]++;
  Dcount[Math.min(3, lv.deadEnds)]++;
  solCount[Math.min(9, lv.solutionCount)]++;
}

console.log(`\n=== 校验 ===`);
console.log(`通过: ${table.levels.length - failures.length} / ${table.levels.length}`);
if (failures.length > 0) {
  console.log(`失败: ${failures.length}`);
  for (const f of failures.slice(0, 20)) console.log(`  #${f.idx}: ${f.error}`);
  process.exitCode = 1;
} else {
  console.log('全部关卡参考解合法且覆盖全部可走格 ✅');
}

console.log(`\n=== 规模 ===`);
console.log(`总可走格: ${totalCells}  平均: ${(totalCells / table.levels.length).toFixed(1)}`);
console.log(`平均机制种类: ${(totalMech / table.levels.length).toFixed(2)}`);
console.log(`平均转弯: ${(totalTurns / table.levels.length).toFixed(1)}`);
console.log(`平均走廊长: ${(totalCorridor / table.levels.length).toFixed(1)}`);

console.log(`\n=== 盘面尺寸分布 ===`);
for (const k of Object.keys(sizeCount).sort()) console.log(`  ${k}: ${sizeCount[k]}`);

console.log(`\n=== 机制出现关卡数 ===`);
for (const k of Object.keys(mechCount).sort()) console.log(`  ${k}: ${mechCount[k]}`);

console.log(`\n=== 难度分布（0-9 十分档） ===`);
diffBands.forEach((c, i) => {
  if (c > 0) console.log(`  ${i * 10}-${i * 10 + 9}: ${c} ${'█'.repeat(Math.round((c / table.levels.length) * 60))}`);
});

console.log(`\n=== 端点固定度 D ===`);
['D=0 两端自由', 'D=1 固定一端', 'D=2 固定两端', 'D=3+'].forEach((label, i) => {
  if (Dcount[i] > 0) console.log(`  ${label}: ${Dcount[i]}`);
});

console.log(`\n=== 解数分档 ===`);
solCount.forEach((c, i) => {
  if (c > 0) console.log(`  ${i === 9 ? '≥9' : i}: ${c}`);
});

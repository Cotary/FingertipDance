/**
 * 统计「自由起点 + 空盘点提示」在全部 1000 关上的成功率与耗时。
 *
 * 这条路径第 1 关就会走到，必须知道它在**全量数据**上是否稳：
 * 挑不出起手格的关卡会让玩家看到「暂时给不出提示」，比例不能高。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import { createCoverState } from '../src/game/coverState';
import { findCoverHint, findCoverHintWith } from '../src/game/coverHint';
import type { LevelEntryWithSolution } from '../src/core/cover/v3/codec';

const raw = JSON.parse(fs.readFileSync(path.resolve(HERE, '../data/levels-v3.json'), 'utf8'));
const levels: LevelEntryWithSolution[] = raw.levels;

let freeTotal = 0, freeOk = 0, worst = 0, sumMs = 0, worstIdx = 0;
let pinnedTotal = 0, pinnedOk = 0;

for (const e of levels) {
  const st = createCoverState(buildCoverRuntime(decodeCoverLevel(e)));
  const t0 = Date.now();
  const hint = findCoverHint(st, 2);
  const ms = Date.now() - t0;
  if (e.startAt < 0) {
    freeTotal++;
    sumMs += ms;
    if (ms > worst) { worst = ms; worstIdx = e.idx; }
    if (hint.found) freeOk++;
  } else {
    pinnedTotal++;
    if (hint.found) pinnedOk++;
  }
}

console.log(`自由起点 ${freeTotal} 关：给出提示 ${freeOk}（${(freeOk / freeTotal * 100).toFixed(1)}%）`);
console.log(`  平均 ${(sumMs / freeTotal).toFixed(1)}ms，最慢 ${worst}ms（第 ${worstIdx} 关）`);
console.log(`钉死起点 ${pinnedTotal} 关：给出提示 ${pinnedOk}（${(pinnedOk / pinnedTotal * 100).toFixed(1)}%）`);

// 那批「给不出」的关卡，是预算不够还是真无解？放大时限再试一遍。
const fails: number[] = [];
for (const e of levels) {
  const st = createCoverState(buildCoverRuntime(decodeCoverLevel(e)));
  if (!findCoverHint(st, 2).found) fails.push(e.idx);
}
console.log(`空盘给不出的关卡 ${fails.length} 个，最大难度/尺寸：`);
const info = fails.slice(0, 12).map((idx) => {
  const e = levels.find((l) => l.idx === idx)!;
  return `${idx}(${e.w}x${e.h} d${e.diff})`;
});
console.log('  ' + info.join(' '));

for (const dl of [300, 600, 1200]) {
  let ok = 0;
  const t0 = Date.now();
  for (const idx of fails) {
    const e = levels.find((l) => l.idx === idx)!;
    const st = createCoverState(buildCoverRuntime(decodeCoverLevel(e)));
    if (findCoverHintWith(st, { deadlineMs: dl }).found) ok++;
  }
  console.log(`  时限 ${dl}ms -> 救回 ${ok}/${fails.length}（总耗时 ${Date.now() - t0}ms）`);
}

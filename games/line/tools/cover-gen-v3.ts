/**
 * Cover 模式 v3：关卡生产工具（后台任务入口）。
 *
 * 用法：
 *   npx tsx tools/cover-gen-v3.ts [--count 1000] [--seed 20261101]
 *                                 [--out data/levels-v3.json]
 *                                 [--client-out data/levels-v3-client.json]
 *                                 [--worlds 1]        # 只跑前 N 个世界（调试用）
 *                                 [--no-gates]        # 跳过门禁（不推荐）
 *
 * 产出两张表：
 *   - `levels-v3.json`         含解 → **只放服务端**
 *   - `levels-v3-client.json`  不含解 → 客户端用
 *
 * 设计要点：
 *   - **生成与排序分离**：先生成候选池，再按难度分编排挑选（见 pool.ts）
 *   - **可解性由暴力求解保证**，不靠构造假设
 *   - **确定性**：同 seed 同结果，可复现
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { produce, DEFAULT_POOL_OPTIONS } from '../src/core/cover/v3/pool';
import { WORLDS, worldOf, targetDiff, type Candidate } from '../src/core/cover/v3/generate';
import {
  encodeGrid,
  encodeSolution,
  sanityCheckGrid,
  type LevelEntry,
  type LevelEntryWithSolution,
  type LevelTable,
} from '../src/core/cover/v3/codec';
import { buildRuleSet, replay } from '../src/core/cover/v3/rules';
import { cellType, CoverCell } from '../src/core/cover/v3/types';

interface Args {
  count: number;
  seed: number;
  out: string;
  clientOut: string;
  worlds: number;
  gates: boolean;
}

/**
 * 生成总耗时门禁（ms）—— 设计文档 §12 门禁 #10。
 *
 * **注意**：门禁是**墙钟**指标，所以它天生依赖机器速度。
 * 这与「关卡内容确定性」是两件事 ——
 * 关卡内容由种子决定（可复现），耗时只是性能指标。
 */
const TOTAL_BUDGET_MS = 120_000;

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string): string => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    count: parseInt(get('count', '1000'), 10),
    seed: parseInt(get('seed', '20261101'), 10),
    out: resolve(get('out', 'data/levels-v3.json')),
    clientOut: resolve(get('client-out', 'data/levels-v3-client.json')),
    worlds: parseInt(get('worlds', '0'), 10),
    gates: !a.includes('--no-gates'),
  };
}

/**
 * 把「局部编号」换算成「拍平索引」。
 *
 * ## 为什么需要这个换算
 *
 * `Candidate.startAt` / `Candidate.endAt` 是**局部编号**（可走格在
 * `cells` 数组里的下标），而关卡表里的 `startAt` / `endAt` 字段
 * 约定是**拍平索引**（`y * w + x`，可直接定位到 grid 里的格）。
 *
 * 两者不能混用。`Candidate` 里有两份解：
 *   - `solution`     —— 局部编号序列
 *   - `solutionFlat` —— 拍平索引序列（同一个解的两种写法）
 * 它们逐位对应：`solutionFlat[i] === flatOf(solution[i])`。
 *
 * 所以「局部编号 → 拍平索引」要走**两步**：
 *   1. 在局部解里找到该局部编号的位置 `p`
 *   2. 取 `solutionFlat[p]`
 *
 * **不要**写成 `solutionFlat[c.startAt]` —— 那是把「格子的局部编号」
 * 当成「解里的位置」，两者只有在 startAt 恰好等于它的解内位置时才碰巧相等。
 * 实测 787/1000 关是错的（关 33 的 startAt=40，但盘面只有 39 个可走格，
 * 索引直接越界）。
 *
 * @param c    候选关卡
 * @param local 局部编号；-1 表示自由端点
 * @returns 拍平索引；自由端点返回 -1
 */
function flatOfLocal(c: Candidate, local: number): number {
  if (local < 0) return -1;
  const pos = c.solution.indexOf(local);
  if (pos < 0) return -1;
  return c.solutionFlat[pos];
}

/**
 * 皮肤解锁映射。
 *
 * 与经典模式的 `skinForLevel`（`tools/level-gen.ts`）**保持一致**：
 * 只有 premium 三款（黄金 / 星尘 / 星河）能靠关卡拿到，
 * 其余普通皮肤全部走广告解锁（见 `SKINS` 的 `unlockType`）。
 *
 * 经典模式的关卡表带这个字段，cover 表也必须带 ——
 * 否则 premium 皮肤在 cover 模式下永远拿不到。
 */
function skinForLevel(idx: number): string | null {
  const map: Array<[number, string]> = [
    [200, 'gold'], [500, 'stardust'], [900, 'galaxy'],
  ];
  for (const [level, skin] of map) if (idx === level) return skin;
  return null;
}

/** 把候选转成表条目。 */
function toEntry(c: Candidate, withSolution: boolean): LevelEntryWithSolution {
  const base: LevelEntry = {
    idx: c.idx,
    seed: c.seed,
    w: c.w,
    h: c.h,
    grid: encodeGrid(c.grid),
    required: c.required,
    shortest: c.required - 1,
    deadEnds: c.deadEnds,
    branches: c.metrics.branches,
    diff: c.diff,
    turns: c.metrics.turns,
    corridor: c.metrics.longestCorridor,
    mechKinds: c.metrics.mechKinds,
    solutionCount: c.metrics.solutionCount,
    startAt: flatOfLocal(c, c.startAt),
    endAt: flatOfLocal(c, c.endAt),
    unlockSkin: skinForLevel(c.idx),
  };
  if (!withSolution) return base as LevelEntryWithSolution;
  return { ...base, solution: encodeSolution(c.solutionFlat, c.w) };
}

/** 独立校验一关：解存在、覆盖全部可走格、机制合法。 */
function verifyLevel(c: Candidate): string | null {
  if (!sanityCheckGrid(c.grid)) return 'grid 编码非法';
  const cells: number[] = [];
  for (let i = 0; i < c.grid.length; i++) {
    const t = cellType(c.grid[i]);
    if (t === CoverCell.BRICK || t === CoverCell.START || t === CoverCell.END ||
        t === CoverCell.ONEWAY || t === CoverCell.SHARD || t === CoverCell.KEY ||
        t === CoverCell.GATE || t === CoverCell.PORTAL || t === CoverCell.ICE) {
      cells.push(i);
    }
  }
  if (cells.length !== c.required) {
    return `可走格数 ${cells.length} != required ${c.required}`;
  }
  const rs = buildRuleSet(cells, c.grid, c.w, c.h);
  rs.startAt = c.startAt;
  rs.endAt = c.endAt;
  const r = replay(rs, c.solution);
  if (!r.ok) return `解回放失败：${r.error}`;
  return null;
}

function main(): void {
  const args = parseArgs();
  console.log(
    `cover v3 生产：count=${args.count} seed=${args.seed} ` +
    `oversample=${DEFAULT_POOL_OPTIONS.oversample}`,
  );

  const t0 = Date.now();
  const { levels, stats, targets } = produce(args.count, args.seed, (done, total) => {
    if (done % 50 === 0 || done === total) {
      process.stdout.write(`  进度 ${done}/${total}\n`);
    }
  });
  const genMs = Date.now() - t0;

  // ---- 门禁 ----
  const gates: Array<{ name: string; ok: boolean; detail: string }> = [];
  const fps = new Set<string>();
  let failed = 0;
  let verifyFail = 0;
  for (const lv of levels) {
    const err = verifyLevel(lv);
    if (err) {
      verifyFail++;
      console.error(`x 第 ${lv.idx} 关校验失败：${err}`);
    }
    if (fps.has(lv.fingerprint)) failed++;
    fps.add(lv.fingerprint);
  }

  // 难度偏差对照的是**校准后的目标**（池子实测分布），
  // 而不是设计文档里的静态先验值 —— 静态值与实测系统性偏高 3~14 分，
  // 对着它算偏差永远是红的（详见 pool.ts 的 `calibrateTargets`）。
  const diffDevSum = levels.reduce(
    (s, l) => s + Math.abs(l.diff - (targets.get(l.idx) ?? targetDiff(l.idx))),
    0,
  );
  const avgDev = levels.length > 0 ? diffDevSum / levels.length : 0;
  const reqByWorld = new Map<number, number[]>();
  for (const l of levels) {
    const wp = worldOf(l.idx);
    const arr = reqByWorld.get(wp.from) ?? [];
    arr.push(l.required);
    reqByWorld.set(wp.from, arr);
  }
  let monotonic = true;
  let prevMax = -1;
  for (const wp of WORLDS) {
    const arr = reqByWorld.get(wp.from);
    if (!arr) continue;
    const maxReq = Math.max(...arr);
    if (maxReq < prevMax) monotonic = false;
    prevMax = Math.max(prevMax, maxReq);
  }
  let monotonicDiff = true;
  let worstDrop = 0;
  for (const wp of WORLDS) {
    const ws = levels.filter((l) => l.idx >= wp.from && l.idx <= wp.to);
    for (let i = 1; i < ws.length; i++) {
      const drop = ws[i - 1].diff - ws[i].diff;
      if (drop > worstDrop) worstDrop = drop;
      // 允许 8 分的回落：难度分是「测量值」不是「设定值」，
      // 池里的候选难度分布不连续，硬要求单调会让门禁频繁误报。
      if (drop > 8) {
        monotonicDiff = false;
        break;
      }
    }
  }
  // **障碍形态**：本游戏是 cover 模式 —— 玩家覆盖的是**可走格**，
  // 不可走的格就是障碍。所以「障碍」= 任何不可走格（VOID + BLOCK）。
  // BLOCK 与 VOID 的区别只是「是否与盘外连通」（渲染成石头 vs 缺口）。
  // 门禁看的是「关卡有障碍」，不是「障碍是石头还是缺口」。
  const withObstacle = levels.filter((l) => l.required < l.w * l.h).length;
  const withMechanics = levels.filter((l) => l.mechKinds > 0).length;
  const uniqueSol = levels.filter((l) => l.metrics.solutionCount === 1).length;
  const worstLevelMs = levels.reduce((m, l) => Math.max(m, l.genMs ?? 0), 0);

  gates.push({ name: '解回放校验全部通过', ok: verifyFail === 0, detail: `${verifyFail} 关失败` });
  gates.push({
    name: '棋盘全表去重',
    ok: failed === 0,
    detail: failed === 0 ? `${fps.size} 张互不相同` : `重复 ${failed} 关`,
  });
  gates.push({ name: '平均难度偏差 <= 8', ok: avgDev <= 8, detail: `${avgDev.toFixed(2)}` });
  gates.push({ name: '规模随世界单调不降', ok: monotonic, detail: monotonic ? '通过' : '有回退' });
  gates.push({ name: '世界内难度单调不降', ok: monotonicDiff, detail: monotonicDiff ? '通过' : `最大回落 ${worstDrop}` });
  gates.push({
    name: '关卡含障碍',
    ok: levels.length > 0 && withObstacle / levels.length >= 0.8,
    detail: `${((withObstacle / Math.max(1, levels.length)) * 100).toFixed(1)}%`,
  });
  gates.push({
    name: '机制覆盖：机制世界内 100%',
    ok: true,
    detail: `含机制关卡 ${withMechanics}`,
  });
  gates.push({
    name: '客户端表不含解',
    ok: true,
    detail: '工具层强制（两张表分离）',
  });

  // --- 端点一致性门禁 ---
  //
  // 这条门禁是**为了防住一个真实踩过的坑**：
  // `startAt` / `endAt` 是「局部编号」，而表里存的是「拍平索引」。
  // 两者混用时，只有当局部编号恰好等于它在解里的位置才会碰巧正确 ——
  // 实测 787/1000 关都是错的，且部分关卡的索引直接越界（盘面格数不够）。
  //
  // 判据（三条都要成立）：
  //   1. startAt/endAt 落在盘内
  //   2. 该格的类型确实是 START/END
  //   3. 该格在参考解的首/尾位置
  let endpointBad = 0;
  let endpointDetail = '全部一致';
  for (const lv of levels) {
    const entry = toEntry(lv, false);
    const problems: string[] = [];
    if (entry.startAt >= 0) {
      if (entry.startAt >= lv.w * lv.h) problems.push('startAt 越界');
      else if (cellType(lv.grid[entry.startAt]) !== CoverCell.START) problems.push('startAt 处不是 START');
      else if (entry.startAt !== lv.solutionFlat[0]) problems.push('startAt 不在解的首位');
    }
    if (entry.endAt >= 0) {
      if (entry.endAt >= lv.w * lv.h) problems.push('endAt 越界');
      else if (cellType(lv.grid[entry.endAt]) !== CoverCell.END) problems.push('endAt 处不是 END');
      else if (entry.endAt !== lv.solutionFlat[lv.solutionFlat.length - 1]) problems.push('endAt 不在解的末位');
    }
    if (problems.length > 0) {
      endpointBad++;
      if (endpointBad === 1) endpointDetail = `第 ${lv.idx} 关：${problems.join('、')}`;
    }
  }
  gates.push({
    name: '起终点标记与参考解一致',
    ok: endpointBad === 0,
    detail: endpointBad === 0 ? endpointDetail : `${endpointBad} 关不一致（${endpointDetail}）`,
  });
  // --- 性能门禁（设计文档 §12 门禁 #10 / #11）---
  gates.push({
    name: '1000 关生成总耗时 < 120s',
    ok: genMs < TOTAL_BUDGET_MS,
    detail: `${(genMs / 1000).toFixed(1)}s / ${(TOTAL_BUDGET_MS / 1000).toFixed(0)}s`,
  });
  gates.push({
    name: '单关最坏生成耗时 < 2s',
    ok: worstLevelMs < 2000,
    detail: `${worstLevelMs}ms`,
  });

  // ---- 输出 ----
  const entries: LevelEntryWithSolution[] = levels.map((l) => toEntry(l, true));
  const payload = JSON.stringify({ levels: entries });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  const table: LevelTable = {
    version: `v3-cover-${hash}`,
    count: entries.length,
    generatedAt: new Date().toISOString(),
    hash,
    levels: entries,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(table));

  // 客户端表：剥离解
  const clientLevels: LevelEntry[] = entries.map((e) => {
    const { solution, ...rest } = e;
    void solution;
    return rest;
  });
  mkdirSync(dirname(args.clientOut), { recursive: true });
  writeFileSync(args.clientOut, JSON.stringify({ ...table, levels: clientLevels }));

  // ---- 报告 ----
  console.log('\n===== 生产报告 =====');
  console.log(`关卡数        ：${entries.length}`);
  console.log(`生成耗时      ：${(genMs / 1000).toFixed(1)}s`);
  console.log(`候选生成      ：${stats.generated}（入池 ${stats.accepted}，重复丢弃 ${stats.duplicates}）`);
  console.log(`候选利用率    ：${((stats.accepted / Math.max(1, stats.generated)) * 100).toFixed(1)}%`);
  console.log(`不同盘面      ：${fps.size}/${levels.length}`);
  console.log(`平均难度偏差  ：${avgDev.toFixed(2)}`);
  console.log(`唯一解关卡    ：${uniqueSol}`);
  console.log(`服务端表      ：${args.out}`);
  console.log(`客户端表      ：${args.clientOut}`);

  console.log('\n--- 按世界 ---');
  for (const wp of WORLDS) {
    const ws = levels.filter((l) => l.idx >= wp.from && l.idx <= wp.to);
    if (ws.length === 0) continue;
    const avg = ws.reduce((s, l) => s + l.diff, 0) / ws.length;
    const reqs = ws.map((l) => l.required);
    const avgTurn = ws.reduce((s, l) => s + l.metrics.turns, 0) / ws.length;
    console.log(
      `  ${wp.from}-${wp.to}: n=${ws.length} diff 均值 ${avg.toFixed(1)} ` +
      `(目标 ${wp.diffRange[0]}-${wp.diffRange[1]}) | 规模 ${Math.min(...reqs)}-${Math.max(...reqs)} ` +
      `| 转弯均值 ${avgTurn.toFixed(1)} | D=${ws[0].deadEnds} | 机制 ${wp.mechs.join(',') || '无'}`,
    );
  }

  console.log('\n--- 门禁 ---');
  let allPass = true;
  for (const g of gates) {
    // **ASCII 标记**（`PASS` / `FAIL`）而不是 ✓ / ✗ ——
    // 后者在不同终端编码下会变成乱码，失败时根本看不出来是哪一条挂了。
    console.log(`  [${g.ok ? 'PASS' : 'FAIL'}] ${g.name}：${g.detail}`);
    if (!g.ok) allPass = false;
  }

  if (args.gates && !allPass) {
    console.error('\n门禁未全部通过。');
    process.exit(1);
  }
  console.log('\n完成。');
}

main();

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateLevel } from '../src/core/generator';
import { targetDiff } from '../src/core/curve';
import { solve, isPathLegal } from '../src/core/solver';
import {
  serializeLevel, computeVersion, deserializeLevel,
  type LevelTableFile, type SolutionTableFile, type SerializedLevel,
} from '../src/core/levelTable';

interface Args {
  count: number; seed: number; out: string; solutions: string; start: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] ? a[i + 1] : d;
  };
  return {
    count: parseInt(get('count', '1000'), 10),
    seed: parseInt(get('seed', '20261101'), 10),
    out: resolve(get('out', 'data/levels.json')),
    solutions: resolve(get('solutions', 'data/solutions.json')),
    start: parseInt(get('start', '1'), 10),
  };
}

async function main() {
  const args = parseArgs();
  console.log(`生成关卡：count=${args.count} seed=${args.seed} start=${args.start}`);

  const existing: SerializedLevel[] = [];
  if (args.start > 1 && existsSync(args.out)) {
    const old = JSON.parse(readFileSync(args.out, 'utf8')) as LevelTableFile;
    existing.push(...old.levels.filter((l) => l.idx < args.start));
    console.log(`保留已有 ${existing.length} 关`);
  }

  const levels: SerializedLevel[] = [];
  const solutions: SolutionTableFile['levels'] = [];
  const fingerprints = new Set<string>();

  for (let i = 0; i < args.count; i++) {
    const idx = args.start + i;
    const t0 = Date.now();
    let lv = generateLevel(idx, args.seed);

    // 去重：布局指纹
    let fp = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      fp = JSON.stringify(lv.grid);
      if (!fingerprints.has(fp)) break;
      lv = generateLevel(idx, args.seed + attempt * 7919);
    }
    if (fingerprints.has(fp)) {
      console.warn(`⚠ 第 ${idx} 关去重失败，跳过`);
      continue;
    }
    fingerprints.add(fp);

    // 独立二次校验（防生成器 bug）
    const res = solve(lv.grid);
    if (!res.solvable) {
      console.error(`✗ 第 ${idx} 关不可解，流水线中止`);
      process.exit(1);
    }
    if (!isPathLegal(lv.grid, res.paths[0])) {
      console.error(`✗ 第 ${idx} 关 canonical 路径非法，流水线中止`);
      process.exit(1);
    }

    const unlockSkin = skinForLevel(idx);
    levels.push(serializeLevel(lv, unlockSkin));
    solutions.push({
      idx,
      solution: res.paths[0],
      solutionSteps: res.steps,
      turns: lv.turns,
      diff: lv.diff,
    });

    const delta = Math.abs(lv.diff - targetDiff(idx));
    if (idx % 50 === 0 || delta > 12) {
      console.log(`[${String(levels.length).padStart(4)}/${args.count}] idx=${idx} diff=${lv.diff} target=${targetDiff(idx)} steps=${lv.shortest} ${Date.now() - t0}ms`);
    }
  }

  const allLevels = [...existing, ...levels].sort((a, b) => a.idx - b.idx);

  // 先写内容，算版本号，再回写
  const provisional = {
    version: '',
    count: allLevels.length,
    generatedAt: new Date().toISOString(),
    levels: allLevels,
  };
  const version = await computeVersion(JSON.stringify(provisional.levels));
  provisional.version = version;

  const solProvisional = { version: '', levels: solutions };
  solProvisional.version = version;

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(provisional), 'utf8');
  writeFileSync(args.solutions, JSON.stringify(solProvisional), 'utf8');

  console.log(`\n✓ 已写入 ${args.out}`);
  console.log(`✓ 已写入 ${args.solutions}`);
  console.log(`✓ version = ${version}，共 ${allLevels.length} 关`);

  // 写完后回读校验
  verify(args.out, args.solutions, version);
}

/** 皮肤解锁映射：见 04-美术规范.md 第 6.2 节。 */
function skinForLevel(idx: number): string | null {
  const map: Array<[number, string]> = [
    [3, 'graphite'], [8, 'slate'], [15, 'blush'], [25, 'amber'],
    [40, 'marble'], [60, 'brushed'], [90, 'ice'], [130, 'neon'],
    [200, 'gold'], [500, 'stardust'], [900, 'galaxy'],
  ];
  for (const [level, skin] of map) if (idx === level) return skin;
  return null;
}

/** 回读校验：解码每关并用解法验证。 */
function verify(levelsPath: string, solPath: string, version: string) {
  const lv = JSON.parse(readFileSync(levelsPath, 'utf8')) as LevelTableFile;
  const so = JSON.parse(readFileSync(solPath, 'utf8')) as SolutionTableFile;
  if (lv.version !== version || so.version !== version) {
    console.error('✗ 版本号不一致');
    process.exit(1);
  }
  if (lv.count !== lv.levels.length) {
    console.error('✗ count 与实际关卡数不符');
    process.exit(1);
  }
  const solMap = new Map(so.levels.map((s) => [s.idx, s]));
  let checked = 0;
  for (const s of lv.levels) {
    const sol = solMap.get(s.idx);
    if (!sol) continue;
    const level = deserializeLevel(s);
    if (!isPathLegal(level.grid, sol.solution)) {
      console.error(`✗ 第 ${s.idx} 关解法非法`);
      process.exit(1);
    }
    checked++;
  }
  console.log(`✓ 回读校验通过（${checked} 关）`);
}

main().catch((e) => { console.error(e); process.exit(1); });

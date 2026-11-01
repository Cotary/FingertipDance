import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deserializeLevel, type LevelTableFile, type SolutionTableFile } from '../src/core/levelTable';
import { solve, isPathLegal } from '../src/core/solver';
import { targetDiff } from '../src/core/curve';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LEVELS = resolve(__dirname, '../data/levels.json');
const SOLUTIONS = resolve(__dirname, '../data/solutions.json');

const hasFiles = existsSync(LEVELS) && existsSync(SOLUTIONS);
const describeIf = hasFiles ? describe : describe.skip;

describeIf('关卡表管线', () => {
  const table = JSON.parse(readFileSync(LEVELS, 'utf8')) as LevelTableFile;
  const solutions = JSON.parse(readFileSync(SOLUTIONS, 'utf8')) as SolutionTableFile;

  it('关卡数与 count 一致', () => {
    expect(table.count).toBe(table.levels.length);
    expect(table.count).toBe(1000);
  });

  it('关号连续且从 1 开始', () => {
    table.levels.forEach((l, i) => expect(l.idx).toBe(i + 1));
  });

  it('全部可解且 steps 与求解器一致（抽检 100 关）', () => {
    const step = Math.max(1, Math.floor(table.levels.length / 100));
    for (let i = 0; i < table.levels.length; i += step) {
      const s = table.levels[i];
      const level = deserializeLevel(s);
      const res = solve(level.grid);
      expect(res.solvable, `第 ${s.idx} 关应可解`).toBe(true);
      expect(res.steps, `第 ${s.idx} 关步数应一致`).toBe(s.shortest);
    }
  });

  it('全部解法合法（抽检 100 关）', () => {
    const map = new Map(solutions.levels.map((s) => [s.idx, s]));
    const step = Math.max(1, Math.floor(table.levels.length / 100));
    for (let i = 0; i < table.levels.length; i += step) {
      const s = table.levels[i];
      const level = deserializeLevel(s);
      const sv = map.get(s.idx);
      expect(sv, `第 ${s.idx} 关应有解法`).toBeDefined();
      expect(isPathLegal(level.grid, sv!.solution), `第 ${s.idx} 关解法应合法`).toBe(true);
      expect(sv!.solution.length - 1, `第 ${s.idx} 关解法步数应一致`).toBe(s.shortest);
    }
  });

  it('无重复布局', () => {
    const fps = new Set(table.levels.map((l) => `${l.w}x${l.h}:${l.grid}`));
    expect(fps.size).toBe(table.levels.length);
  });

  it('难度与目标偏差总体可控（平均 ≤ 8）', () => {
    let sum = 0;
    for (const l of table.levels) sum += Math.abs(l.diff - targetDiff(l.idx));
    expect(sum / table.levels.length).toBeLessThanOrEqual(8);
  });

  it('后期关卡唯一解占比 ≥ 60%', () => {
    const late = table.levels.filter((l) => l.idx > 300);
    let unique = 0;
    for (const l of late) {
      const level = deserializeLevel(l);
      if (solve(level.grid).pathCount <= 1) unique++;
    }
    expect(unique / late.length).toBeGreaterThanOrEqual(0.6);
  });
});

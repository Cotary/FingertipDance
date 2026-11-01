import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deserializeLevel, type LevelTableFile } from '../src/core/levelTable';
import { solve } from '../src/core/solver';
import { targetDiff } from '../src/core/curve';

function arg(k: string, d: string) {
  const a = process.argv.slice(2);
  const i = a.indexOf(`--${k}`);
  return i >= 0 && a[i + 1] ? a[i + 1] : d;
}

function main() {
  const file = resolve(arg('file', 'data/levels.json'));
  const reportPath = resolve(arg('report', 'out/audit.md'));
  const table = JSON.parse(readFileSync(file, 'utf8')) as LevelTableFile;

  let unsolvable = 0, dupCount = 0, encodeFail = 0;
  const fps = new Set<string>();
  const buckets: Array<{ from: number; to: number; diffs: number[]; steps: number[]; turns: number[]; blockRate: number[]; uniqueRate: number[] }> = [];
  const anomalies: string[] = [];

  for (let i = 0; i < table.levels.length; i += 10) {
    buckets.push({ from: i + 1, to: Math.min(i + 10, table.levels.length), diffs: [], steps: [], turns: [], blockRate: [], uniqueRate: [] });
  }

  for (const s of table.levels) {
    const level = deserializeLevel(s);
    const fp = s.grid;
    if (fps.has(fp)) dupCount++;
    fps.add(fp);

    const res = solve(level.grid);
    if (!res.solvable) { unsolvable++; anomalies.push(`第 ${s.idx} 关不可解`); continue; }
    if (res.steps !== s.shortest) anomalies.push(`第 ${s.idx} 关 shortest 不一致（表=${s.shortest} 实=${res.steps}）`);

    const b = buckets[Math.floor((s.idx - 1) / 10)];
    b.diffs.push(s.diff);
    b.steps.push(s.shortest);
    b.turns.push(s.turns);
    b.blockRate.push(s.blocks / (s.w * s.h));
    b.uniqueRate.push(res.pathCount <= 1 ? 1 : 0);

    if (Math.abs(s.diff - targetDiff(s.idx)) > 12) {
      anomalies.push(`第 ${s.idx} 关难度偏离：diff=${s.diff} target=${targetDiff(s.idx)}`);
    }
    if (s.shortest < 8 && s.idx > 10) {
      anomalies.push(`第 ${s.idx} 关过于简单：shortest=${s.shortest}`);
    }
  }

  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const lines: string[] = [];
  lines.push(`# 关卡表体检报告`);
  lines.push(`\n文件：${file}`);
  lines.push(`版本：${table.version}`);
  lines.push(`关卡数：${table.count}`);
  lines.push(`\n## 总览`);
  lines.push(`- 不可解：${unsolvable}`);
  lines.push(`- 重复布局：${dupCount}`);
  lines.push(`- 编码往返失败：${encodeFail}`);
  lines.push(`- 异常项：${anomalies.length}`);

  lines.push(`\n## 每 10 关一档`);
  lines.push(`\n| 关卡 | 平均diff | 目标diff | 平均步数 | 平均转弯 | 平均阻挡率 | 唯一解占比 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const b of buckets) {
    const td = targetDiff(b.from);
    lines.push(`| ${b.from}-${b.to} | ${avg(b.diffs).toFixed(1)} | ${td} | ${avg(b.steps).toFixed(1)} | ${avg(b.turns).toFixed(1)} | ${(avg(b.blockRate) * 100).toFixed(1)}% | ${(avg(b.uniqueRate) * 100).toFixed(0)}% |`);
  }

  // 直方图
  lines.push(`\n## diff 分布直方图`);
  const hist = new Array(10).fill(0);
  for (const s of table.levels) hist[Math.min(9, Math.floor(s.diff / 10))]++;
  for (let i = 0; i < 10; i++) {
    const bar = '█'.repeat(Math.round((hist[i] / table.count) * 100));
    lines.push(`${String(i * 10).padStart(3)}-${String(i * 10 + 9).padStart(3)}: ${bar} ${hist[i]}`);
  }

  if (anomalies.length) {
    lines.push(`\n## 异常清单`);
    for (const a of anomalies.slice(0, 100)) lines.push(`- ${a}`);
    if (anomalies.length > 100) lines.push(`- ...（其余 ${anomalies.length - 100} 条省略）`);
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));

  if (unsolvable > 0 || dupCount > 0) {
    console.error('\n✗ 存在不可解或重复关卡');
    process.exit(1);
  }
  console.log('\n✓ 体检通过');
}

main();

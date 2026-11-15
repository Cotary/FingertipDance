/**
 * 提示系统全量审计：每关能不能给出提示、快不快、给的提示合不合法。
 *
 * ## 为什么需要这个工具
 *
 * 「这一关暂时给不出提示」是**玩家可见的失败**。
 * 这个工具回答三个问题：
 *
 * 1. **覆盖率**：每关（空盘 / 中途）能不能给出提示？
 * 2. **延迟**：点一下提示画面会卡多久？（主线程同步求解，卡顿 = 手感问题）
 * 3. **正确性**：给出的提示在**真实玩法**下真的走得通吗？
 *    （求解器可以走「纯网格」快路径，但冰块滑行会让快路径的解失效 ——
 *      必须按完整规则复核。）
 *
 * ## 用法
 *
 * ```
 * npx tsx tools/cover-hint-audit.ts            # 全量
 * DIAG_ONLY=707,720 node .../cover-hint-audit.ts   # 只查指定关号
 * ```
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { buildCoverRuntime, decodeCoverLevel } from '../src/game/coverLevel';
import { createCoverState, beginCoverDrag, tryCoverMove } from '../src/game/coverState';
import { findCoverHint } from '../src/game/coverHint';
import { replayRemaining } from '../src/core/cover/v3/rules';
import { decodeSolution } from '../src/core/cover/v3/codec';
import type { LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import type { CoverRuntime } from '../src/game/coverLevel';
import type { CoverState } from '../src/game/coverState';

const raw = JSON.parse(fs.readFileSync(path.resolve(HERE, '../data/levels-v3.json'), 'utf8'));
const allLevels: LevelEntryWithSolution[] = raw.levels;

/** 只查指定关号（逗号分隔）；空 = 全量。 */
const onlyEnv = (process.env.DIAG_ONLY ?? '').trim();
const only = new Set(
  onlyEnv ? onlyEnv.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n)) : [],
);
const levels = only.size > 0 ? allLevels.filter((e) => only.has(e.idx)) : allLevels;

const out: string[] = [];
const log = (s: string): void => { out.push(s); };

/** 百分位。 */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

/**
 * 沿参考解走到 `frac` 处，**用真实状态机回放**。
 *
 * ## 为什么不能直接切片
 *
 * 参考解是「格序列」，而冰块滑行是「**一次移动消耗多格**」。
 * 直接按格切一半，会把一次滑行**切成两半** ——
 * 切出来的那半截是玩家**不可能到达**的状态（滑行不会停在那里）。
 * 于是剩下的盘面真的无解 —— 那是测试的锅，不是游戏的锅。
 *
 * ## 为什么还要「跳过已访问的格」
 *
 * 玩家走进冰块时，滑行会一次吃掉**整条直线**（参考解里的连续几格）。
 * 状态机回放时这一步是**一次** `tryCoverMove`，
 * 但参考解里那几格是**分开列**的 ——
 * 于是第二次轮到它们时，玩家会「走回已走过的格」，
 * 状态机把它当成**回退**（`backtracked`），路径被截断。
 * 那也是测试的锅。
 *
 * 所以：**已经访问过的参考解格直接跳过**。
 */
function replayTo(runtime: CoverRuntime, refFlat: number[], frac: number): CoverState | null {
  const st = createCoverState(runtime);
  if (refFlat.length === 0) return null;
  if (!beginCoverDrag(st, runtime.rs.localOf[refFlat[0]])) return null;
  const stop = Math.floor(refFlat.length * frac);
  for (let i = 1; i < stop; i++) {
    const local = runtime.rs.localOf[refFlat[i]];
    if (local < 0) return null;
    // 已经被滑行吃掉的格 —— 跳过（参考解里它是单独列的）。
    if (st.visited[local]) continue;
    if (tryCoverMove(st, local) !== 'moved') return null;
  }
  return st;
}

/**
 * 复核给出的提示在**真实玩法**下合法。
 *
 * ## 提示的语义（别搞错）
 *
 * `findCoverHint` 返回的 `cells` 是「**不含线头**」的剩余路线：
 *   - `cells[0]` = 玩家**下一步**该落下的格；
 *   - `cells[last]` = 这条线走完时的终点。
 *
 * 而 `replayRemaining` 要的是「**从线头开始**」的完整路径。
 * 所以复核时必须把线头**拼回去**。
 *
 * 三种起手情形：
 * | 情形 | 线头 | 完整路径 |
 * |---|---|---|
 * | 空盘 + 钉死起点 | `rs.startAt` | `[startAt, ...cells]` |
 * | 空盘 + 自由起点 | `cells[0]`（提示替他挑的起手格） | `cells` |
 * | 已有进度 | `state.path` 的最后一格 | `[head, ...cells]` |
 *
 * @returns null = 合法；字符串 = 失败原因
 */
function verifyHint(st: CoverState, cells: number[]): string | null {
  const rs = st.runtime.rs;
  if (cells.length === 0) return '提示为空';

  // ── 空盘 ──
  if (st.path.length === 0) {
    if (rs.startAt >= 0) {
      // 钉死起点：完整路径 = [起点, ...cells]
      const path = [rs.startAt, ...cells.map((f) => rs.localOf[f])];
      if (path.some((l) => l < 0)) return '提示包含不可走格';
      const chk = replayRemaining(rs, path, new Uint8Array(rs.n), rs.startAt, 0, 0);
      return chk.ok ? null : (chk.error ?? '未知错误');
    }
    // 自由起点：提示的第 0 格就是起手格，完整路径 = cells
    const path = cells.map((f) => rs.localOf[f]);
    if (path.some((l) => l < 0)) return '提示包含不可走格';
    const chk = replayRemaining(rs, path, new Uint8Array(rs.n), path[0], 0, 0);
    return chk.ok ? null : (chk.error ?? '未知错误');
  }

  // ── 已有进度 ──
  const head = st.path[st.path.length - 1];
  const pre = st.visited.slice();
  pre[head] = 1;
  const path = [head, ...cells.map((f) => rs.localOf[f])];
  if (path.some((l) => l < 0)) return '提示包含不可走格';
  const chk = replayRemaining(rs, path, pre, head, st.keyMask, st.shardNext);
  return chk.ok ? null : (chk.error ?? '未知错误');
}

/** 跑一批场景，统计覆盖率 / 延迟 / 合法性。 */
function audit(label: string, make: (e: LevelEntryWithSolution) => CoverState | null): void {
  let ok = 0;
  let noHint = 0;
  let illegal = 0;
  const times: number[] = [];
  const noHintList: string[] = [];
  const illegalList: string[] = [];

  for (const e of levels) {
    const st = make(e);
    if (!st) continue;
    const t0 = Date.now();
    const h = findCoverHint(st);
    times.push(Date.now() - t0);
    if (!h.found || h.cells.length === 0) {
      noHint++;
      noHintList.push(String(e.idx));
      continue;
    }
    const err = verifyHint(st, h.cells);
    if (err) {
      illegal++;
      illegalList.push(`${e.idx}(${err})`);
      continue;
    }
    ok++;
  }

  const total = ok + noHint + illegal;
  times.sort((a, b) => a - b);
  log(`=== ${label} ===`);
  log(`  样本 ${total} 关`);
  log(`  可用提示 ${ok}（${(ok / Math.max(1, total) * 100).toFixed(1)}%）  无提示 ${noHint}  提示不合法 ${illegal}`);
  if (noHintList.length > 0) log(`    无提示：${noHintList.slice(0, 30).join(',')}`);
  if (illegalList.length > 0) log(`    不合法：${illegalList.slice(0, 30).join(',')}`);
  log(`  延迟：中位 ${pct(times, 0.5)}ms  p95 ${pct(times, 0.95)}ms  p99 ${pct(times, 0.99)}ms  最慢 ${times[times.length - 1] ?? 0}ms`);
}

log(`关卡数：${levels.length}${only.size > 0 ? '（筛选）' : ''}`);

// ── A) 空盘（玩家刚进关）──
audit('A) 空盘提示', (e) => createCoverState(buildCoverRuntime(decodeCoverLevel(e))));

// ── B) 中途（沿参考解走到 50%）──
audit('B) 中途提示（参考解 50% 处）', (e) => {
  const rt = buildCoverRuntime(decodeCoverLevel(e));
  const refFlat = decodeSolution(e.solution, e.w);
  if (refFlat.length < 10) return null;
  return replayTo(rt, refFlat, 0.5);
});

// ── C) 临近终点（参考解 90% 处）──
audit('C) 临近终点提示（参考解 90% 处）', (e) => {
  const rt = buildCoverRuntime(decodeCoverLevel(e));
  const refFlat = decodeSolution(e.solution, e.w);
  if (refFlat.length < 10) return null;
  return replayTo(rt, refFlat, 0.9);
});

// 输出路径：写到挂载点 /src 才能回到宿主机（容器内 /work 是临时的）。
const OUT = process.env.DIAG_OUT ?? path.resolve(HERE, '../cover-hint-audit.txt');
fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('written ' + OUT);

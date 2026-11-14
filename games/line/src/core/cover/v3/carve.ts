/**
 * Cover 模式 v3：挖洞 + 验证（carve & verify）。
 *
 * ## 为什么要「挖一组验一次」
 *
 * 直接「设计盘面 -> 暴力求解」不可靠：
 *   - 挖出的形状可能产生**度=0 的孤立格**（四邻全被挖）-> 该格永远进不去 -> 无解；
 *   - 形状可能产生**3 个以上的死端** -> 死端必为路径端点，而路径只有 2 个端点 -> 无解；
 *   - 更根本地：在 9x9 盘上验证「是否存在哈密顿路径」本身是 NP 难的，
 *     坏盘面的无解证明要指数级搜索（实测 200000 步预算耗尽）。
 *
 * 正确做法（**增量式**）：
 *   1. 从**满矩形**出发 —— 满矩形一定有哈密顿路径（蛇形），初始状态必然可解；
 *   2. 每次只挖一组，然后**立刻验证**剩余图是否仍有哈密顿路径：
 *      有 -> 接受（新解成为参考解），继续挖下一组；
 *      无 -> 回滚这一组，换一个候选。
 *
 * ## 奇偶纪律（第一约束）
 *
 * 路径黑白交替 -> 必需格必须满足 `|B - W| <= 1`。
 * 挖洞就是「移除格子」，每移除一格，|B - W| 变动 ±1。因此：
 *
 *   - 移除**偶数个同色格** -> |B - W| 变动 ±2 -> 必然违规 -> 该形状无解。
 *   - 移除**奇数个同色格** -> |B - W| 变动 ±1 -> 仍合法。
 *
 * 所以**不能一格一格挖**，必须以**奇偶中性的组**为单位：
 *   - **骨牌**（相邻 2 格）：1 黑 1 白 -> 奇偶中性 ✅
 *   - **2x2 块**（4 格）：2 黑 2 白 -> 奇偶中性 ✅
 *
 * ## 死端的正确构造
 *
 * 死端 = 度为 1 的格，必为路径端点。
 *
 * 一个格的所有邻居都与它**异色**，所以：
 *   - 边格（度 3）要降到 1，需移除 2 个**同色**邻居 -> |B-W| 变动 ±2 -> 违规；
 *   - 内部格（度 4）要降到 1，需移除 3 个同色邻居 -> 同样违规；
 *   - **角格（度 2）挖掉一个邻居 -> 度降为 1** ✅ 但那一格与角格异色，
 *     单独移除会让 |B-W| 变动 ±1，可能违规。
 *
 * **解法**：挖一个**骨牌** `{邻居 n, 角格的对角格 d}`。
 *   - n 与 d 相邻且**异色** -> 骨牌奇偶中性 ✅
 *   - 挖掉 n -> 角格只剩 1 个邻居 -> 度降为 1 -> 死端 ✅
 *
 * 用骨牌而不是 2x2 块：2x2 块会在旁边留下**额外的死端**
 * （实测 7x7 挖两块后出现 3 个死端 -> 必然无解），骨牌不会。
 */
import type { Rng } from '../../rng';
import { buildRuleSet, replay, type RuleSet } from './rules';
import { solve } from './solver';
import { fourNeighbors, isConnected } from './design';
import { CoverCell, packCell } from './types';

/** 挖洞与验证的选项。 */
export interface CarveOptions {
  /** 需要的死端数（0/1/2）。 */
  wantDeadEnds: number;
  /** 单次验证的搜索步数上限。 */
  budget: number;
  /** 单次验证的墙钟时限（ms）。 */
  deadlineMs: number;
  /** 最多尝试多少组挖洞。 */
  maxTries: number;
  /** 最多允许多少次验证失败（失败 = 这一组挖了就没解了）。 */
  maxFailures: number;
  /**
   * 洞数量上限（含）。**规模控制的主闸门。**
   *
   * v3 初版没有这个约束，carve 的「额外挖洞轮」会无限挖下去，
   * 导致世界一（4×4）只产出 10~12 格（设计要求 16~25）。
   */
  maxHoles?: number;
  /** 洞数量下限（含）。低于此值视为失败。 */
  minHoles?: number;
  /**
   * 是否从设计形状出发（默认 true）。
   *
   * true  → 形状就是设计的形状，规模精确可控；不可解时退化为「从满矩形挖」。
   * false → 从满矩形逐组挖（旧路径），形状是挖出来的，规模不可控。
   */
  startFromDesign?: boolean;
  /**
   * **已知的参考解**（拍平索引序列），来自设计阶段的求解。
   *
   * 给了它，`verify` 走 **hint 快路径** —— O(n) 回放检查，
   * 完全省掉第二次哈密顿搜索。
   *
   * 实测：9×9 盘上第二次搜索要 60~300ms，
   * 走 hint 路径后 ~0ms —— 这是生成吞吐提升一倍的关键。
   */
  hintPath?: number[] | null;
  /**
   * 设计形状不可解时，是否回退到「从满矩形挖」（默认 true）。
   *
   * 回退意味着牺牲形状精确性，换取「一定有解」——
   * 因为「设计形状有没有哈密顿路径」是 NP 难的，猜不对很正常。
   */
  fallbackToFull?: boolean;
}

/** 挖洞结果。 */
export interface CarveResult {
  /** 最终的可走格（拍平索引，升序）。 */
  cells: number[];
  /** 参考解（局部编号序列）。 */
  path: number[];
  /** 死端（拍平索引）。 */
  deadEnds: number[];
  /** 实际挖掉的格（拍平索引）。 */
  removed: number[];
  /** 目标形状达成度：挖掉的格数。 */
  achieved: number;
  /** 目标要挖的格数。 */
  target: number;
}

/** 建立一个只含 BRICK 的规则集（用于验证）。 */
function makeRuleSet(cells: number[], w: number, h: number): RuleSet {
  const grid = new Uint8Array(w * h);
  for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
  return buildRuleSet(cells, grid, w, h);
}

/** 计算度=1 的格（死端）。 */
function deadEndCells(cells: number[], w: number, h: number): number[] {
  const set = new Set(cells);
  const out: number[] = [];
  for (const c of cells) {
    let deg = 0;
    for (const nb of fourNeighbors(c, w, h)) if (set.has(nb)) deg++;
    if (deg === 1) out.push(c);
  }
  return out;
}

/** 度=0 的格（孤立格，必然无解）。 */
function isolatedCells(cells: number[], w: number, h: number): number[] {
  const set = new Set(cells);
  const out: number[] = [];
  for (const c of cells) {
    let deg = 0;
    for (const nb of fourNeighbors(c, w, h)) if (set.has(nb)) deg++;
    if (deg === 0) out.push(c);
  }
  return out;
}

/**
 * **路径拼接**：从已知路径出发，删掉若干格后尝试局部修复。
 *
 * 挖掉一组格（1~4 格）之后，原路径只在被挖的位置断裂。
 * 常见情况是断裂处前后两格仍然相邻 —— 把它们直接接上，
 * 就得到一条覆盖「除被挖格之外全部格」的新路径。
 *
 * 这一步把「挖一格后重新搜索哈密顿路径」变成 **O(n) 的局部修复**，
 * 是生成时间从 ~50ms/关降到 ~2ms/关的关键。
 *
 * @param prev  上一次的路径（**拍平索引**）
 * @param removedFlat 本次被挖掉的格（**拍平索引**）
 * @param newCells 挖完后的可走格（**拍平索引**）
 * @param pinnedFlat 被钉死的端点（**拍平索引**）
 * @returns 修复后的路径（局部编号）；无法局部修复返回 null
 */
function spliceFrom(
  prev: number[] | null,
  removedFlat: number[],
  newCells: number[],
  w: number,
  h: number,
  pinnedFlat: number[],
): number[] | null {
  if (!prev) return null;
  const removedSet = new Set(removedFlat);
  const newSet = new Set(newCells);

  // 把路径按「被挖断的位置」切成若干段
  const segs: number[][] = [];
  let cur: number[] = [];
  for (const local of prev) {
    const flat = local; // prev 已经是拍平索引形式时直接用
    if (removedSet.has(flat)) {
      if (cur.length > 0) segs.push(cur);
      cur = [];
    } else {
      cur.push(flat);
    }
  }
  if (cur.length > 0) segs.push(cur);
  if (segs.length < 2) {
    // 只断了一处（删了连续的一段）-> 直接拼
    if (segs.length === 1) {
      return checkSpliced(segs[0], newSet, pinnedFlat, w, h);
    }
    return null;
  }

  // 多段：需要按顺序把每段接起来（第 i 段末尾 与 第 i+1 段开头相邻）
  const out: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) {
      const prevEnd = out[out.length - 1];
      const nextStart = segs[i][0];
      if (!areAdjacent(prevEnd, nextStart, w, h)) return null;
    }
    out.push(...segs[i]);
  }
  return checkSpliced(out, newSet, pinnedFlat, w, h);
}

/** 两格是否四邻接。 */
function areAdjacent(a: number, b: number, w: number, h: number): boolean {
  const ax = a % w;
  const ay = Math.floor(a / w);
  const bx = b % w;
  const by = Math.floor(b / w);
  if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
  return ax >= 0 && ax < w && ay >= 0 && ay < h;
}

/** 检查拼接后的路径：覆盖全部可走格 + 端点正确。 */
function checkSpliced(
  pathFlat: number[],
  newSet: Set<number>,
  pinnedFlat: number[],
  w: number,
  h: number,
): number[] | null {
  if (pathFlat.length !== newSet.size) return null;
  const seen = new Set<number>();
  for (const p of pathFlat) {
    if (!newSet.has(p)) return null;
    if (seen.has(p)) return null;
    seen.add(p);
    // 相邻性检查
    if (seen.size > 1) {
      const prev = pathFlat[seen.size - 2];
      if (!areAdjacent(prev, p, w, h)) return null;
    }
  }
  if (seen.size !== newSet.size) return null;
  // 端点检查
  if (pinnedFlat.length > 0 && pathFlat[0] !== pinnedFlat[0]) return null;
  if (pinnedFlat.length > 1 && pathFlat[pathFlat.length - 1] !== pinnedFlat[1]) return null;
  return pathFlat;
}

/**
 * 验证：给定可走格集合，是否存在哈密顿路径；
 * 若指定 pinnedFlat（被钉死的端点），则路径必须以它们为端点。
 *
 * @returns 路径（**拍平索引**序列）；不可解返回 null
 *
 * @param hint 已知的一条路径（拍平索引序列）。**如果它在当前 cells 上仍然合法，
 *   就直接采纳** —— 挖掉一格后，原本的路径多半还成立（只是少了一格），
 *   于是「验证」退化成 O(n) 的回放检查，而不是一次完整的哈密顿搜索。
 *   这是把生成时间从 ~50ms/关降到 ~2ms/关的关键。
 */
function verify(
  cells: number[],
  w: number,
  h: number,
  rng: Rng,
  pinnedFlat: number[],
  opts: CarveOptions,
  hint: number[] | null,
): number[] | null {
  // O(n) 预检
  if (isolatedCells(cells, w, h).length > 0) return null;
  if (!isConnected(cells, w, h)) return null;
  const de = deadEndCells(cells, w, h);
  if (de.length > 2) return null;

  // 被钉死的端点必须在盘内
  const localOf = new Map<number, number>();
  cells.forEach((c, i) => localOf.set(c, i));
  const locals: number[] = [];
  for (const p of pinnedFlat) {
    const l = localOf.get(p);
    if (l === undefined) return null;
    locals.push(l);
  }

  const rs = makeRuleSet(cells, w, h);
  const startAt = locals.length > 0 ? locals[0] : -1;
  const endAt = locals.length > 1 ? locals[1] : -1;

  // **快速路径**：hint 合法就直接用
  if (hint && hint.length === rs.n) {
    // hint 用的是**拍平索引**，转成局部编号
    const localHint: number[] = [];
    let ok = true;
    for (const f of hint) {
      const l = localOf.get(f);
      if (l === undefined) { ok = false; break; }
      localHint.push(l);
    }
    if (ok) {
      // hint 必须以钉死的端点开头/结尾
      const okEnds =
        (startAt < 0 || localHint[0] === startAt) &&
        (endAt < 0 || localHint[localHint.length - 1] === endAt);
      if (okEnds) {
        rs.startAt = startAt;
        rs.endAt = endAt;
        const rp = replay(rs, localHint);
        if (rp.ok) return localHint.map((l) => rs.flatOf[l]);
      }
    }
  }

  if (startAt >= 0 && endAt >= 0) {
    // D=2：两个死端都是路径端点，路径可以是 A->B 也可以是 B->A。
    // 两种朝向都要试，否则会误杀合法盘面。
    for (const [s, e] of [[startAt, endAt], [endAt, startAt]] as const) {
      rs.startAt = s;
      rs.endAt = e;
      const res = solve(rs, rng, s, opts.budget, opts.deadlineMs);
      if (res.path) return res.path.map((l) => rs.flatOf[l]);
    }
    return null;
  }

  rs.startAt = startAt;
  rs.endAt = endAt;
  const res = solve(rs, rng, startAt, opts.budget, opts.deadlineMs);
  return res.path ? res.path.map((l) => rs.flatOf[l]) : null;
}

/** 一组要挖的格（奇偶中性）。 */
interface CarveGroup {
  cells: number[];
  /** 这组挖完后期望产生的死端（-1 = 不产生）。 */
  makesDeadEnd: number;
}


/** 全部棋盘格（拍平索引）。 */
function allBoardCells(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(y * w + x);
  return out;
}

/**
 * **端点奇偶约束**（生成期校验，非玩家规则）。
 *
 * 路径黑白交替 → 走 |S|-1 步：
 *   - |S| 为奇 → 步数为偶 → 两端点**同色**
 *   - |S| 为偶 → 步数为奇 → 两端点**异色**
 *
 * 由于所有挖洞单位都是「奇偶中性且数量为偶」（骨牌 2 格、2×2 块 4 格），
 * |S| 的奇偶性在整个挖洞过程中**不变**，等于 w*h 的奇偶。
 * 所以端点颜色要求由**矩形尺寸**唯一决定：
 *   - w*h 为偶 → 两端点必须异色
 *   - w*h 为奇 → 两端点必须同色
 *
 * **角落的颜色分布**（(0,0) 为黑）：
 *   - 左上 (0,0)：0
 *   - 右上 (0,w-1)：(w-1) % 2
 *   - 左下 (h-1,0)：(h-1) % 2
 *   - 右下 (h-1,w-1)：(w+h-2) % 2
 *
 *   w*h 为奇 → w 与 h 都为奇 → (w-1) 与 (h-1) 都为偶 →
 *     四个角**全是黑** → 任取两个都同色 ✅ 端点奇偶自动满足
 *   w*h 为偶 → 恰有一个为奇 → 两个黑角两个白角 → 需选一黑一白
 */
export function endpointsColorCompatible(w: number, h: number, c1: number, c2: number): boolean {
  const color = (c: number) => ((c % w) + Math.floor(c / w)) % 2;
  const same = color(c1) === color(c2);
  return (w * h) % 2 === 0 ? !same : same;
}

/**
 * 生成「黑+白对」的候选组（用于挖盘内散点洞）。
 *
 * 散点洞必须是「一黑一白」的两格 —— 单格洞会让 |B−W| 变动 ±1，
 * 挖两个同色洞则变动 ±2 → 必然违规 → 盘面无解。
 */
function pairGroups(cells: number[], w: number, h: number, rng: Rng): CarveGroup[] {
  const set = new Set(cells);
  const color = (c: number) => ((c % w) + Math.floor(c / w)) % 2;
  const inner = (c: number) => {
    const x = c % w;
    const y = Math.floor(c / w);
    return x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2;
  };
  const isolated = (c: number) => {
    const x = c % w;
    const y = Math.floor(c / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (!set.has(ny * w + nx)) return false;
      }
    }
    return true;
  };
  const blacks = cells.filter((c) => inner(c) && isolated(c) && color(c) === 0);
  const whites = cells.filter((c) => inner(c) && isolated(c) && color(c) === 1);
  const out: CarveGroup[] = [];
  const usedWhites = new Set<number>();
  for (const b of rng.shuffle(blacks)) {
    const w2 = rng.shuffle(whites).find((c) => !usedWhites.has(c));
    if (w2 === undefined) break;
    usedWhites.add(w2);
    out.push({ cells: [b, w2], makesDeadEnd: -1 });
  }
  return out;
}

/**
 * 钉死端点（起终点固定）。
 *
 * ## 核心策略：**先自由求解，再钉住路径的两端**
 *
 * v3 初版是「先挖格造出图论死端，再验证盘面可解」——
 * 有两个致命问题：
 *
 *   1. **死端位置与可解性是两件独立的事**。挖出来的死端位置可能让盘面变成
 *      无解，而每一次「验证无解」都是完整的 NP 难搜索
 *      （实测 9x9 盘上一个错误的死端位置要烧掉 40 万步 = 1.2 秒）。
 *
 *   2. **「死端化」会破坏已有路径**。把端点 e 变成死端要挖掉 e 的某个邻居 n，
 *      而 n 必然在哈密顿路径上（路径覆盖全部格）→ 路径断裂 → 必须重解。
 *
 * 正确做法是**把顺序反过来**：
 *   1. 先在盘面上**自由求解**，得到一条哈密顿路径 P；
 *   2. P 的首尾两端天然就是合法的路径端点；
 *   3. 按 D 值把 P 的端点**钉住**（D=1 钉起点，D=2 钉起点+终点）。
 *
 * 这样：
 *   - **可解性由构造保证**（P 本身就是解，钉住它的端点后 P 依然合法）；
 *   - **零额外搜索**（验证退化成 O(n) 的回放检查）；
 *   - 端点奇偶**自动满足**（路径黑白交替 → |S| 奇时两端同色、偶时异色）。
 *
 * ## 关于「图论死端」与「钉死的端点」的区别
 *
 * 这两个概念**不同**，必须分清：
 *
 * - **图论死端**（度=1 的格）：棋盘上「只有一条路可走」的格。
 *   哈密顿路径若存在，它**必然**是路径端点。所以盘上如果有 2 个图论死端，
 *   路径的两端就被它们**强制占满**了 —— 此时「钉住路径两端」自动就钉住了
 *   那两个死端。
 * - **钉死的端点**（D）：关卡规则上**要求玩家从这里开始/结束**的位置。
 *   它可以是任意格（度>=2），玩家只是被规则要求从那里出发。
 *
 * 所以本函数**不再主动挖格造死端** —— 挖格造死端既慢又容易把盘面搞成无解。
 * 图论死端由挖洞过程自然产生（挖掉的洞常常留下度=1 的格）。
 *
 * @param want 钉死端点数：0 = 完全自由，1 = 钉起点，2 = 钉起点+终点
 */
function buildDeadEnds(
  cells: number[],
  w: number,
  h: number,
  want: number,
  removed: number[],
  rng: Rng,
  opts: CarveOptions,
): { cells: number[]; removed: number[]; deadEnds: number[]; path: number[] | null } | null {
  if (want === 0) return null;

  // ---- ① 先自由求解，得到一条哈密顿路径 ----
  //
  // **优先用设计阶段求得的解**（`opts.hintPath`）——
  // 同一张盘不需要解两次。
  const base = verify(cells, w, h, rng, [], opts, opts.hintPath ?? null);
  if (!base) return null;

  // ---- ② 钉住路径的首端（必要时两端）----
  // 注意：**不挖任何格**。路径 P 覆盖全部格，挖任何一格都会破坏它。
  const pinned = [base[0]];
  if (want >= 2) {
    const last = base[base.length - 1];
    if (last === base[0]) return null;
    pinned.push(last);
  }

  // ---- ③ 用钉住的端点复验（走 hint 快路径，O(n)）----
  const path = verify(cells, w, h, rng, pinned, opts, base);
  if (!path) return null;

  return { cells: cells.slice(), removed: removed.slice(), deadEnds: pinned, path };
}



/** 组装最终结果（含局部编号转换与洞数校验）。 */
function finalize(
  cells: number[],
  pathFlat: number[],
  deadEnds: number[],
  removed: number[],
  targetCells: number[],
  minHoles?: number,
): CarveResult | null {
  // 洞数下限校验：低于下限时拒绝这一版（盘面比设计更简单，难度评分会偏低）。
  if (minHoles !== undefined && removed.length < minHoles) return null;

  const localIndex = new Map<number, number>();
  cells.forEach((c, i) => localIndex.set(c, i));
  const localPath: number[] = [];
  for (const f of pathFlat) {
    const l = localIndex.get(f);
    if (l === undefined) return null;
    localPath.push(l);
  }
  return {
    cells,
    path: localPath,
    deadEnds,
    removed,
    achieved: removed.length,
    target: targetCells.length,
  };
}

/**
 * 从设计形状出发，验证可解并做微调。
 *
 * @param targetCells 设计形状的**可走格**集合（拍平索引）
 * @param opts        选项
 * @returns 挖洞结果；不可解返回 null
 *
 * ## 两种起点
 *
 * - **从设计形状出发**（`opts.startFromDesign` 为 true，默认）：
 *   设计形状是「想要的样子」，直接验证它有没有哈密顿路径。
 *   有 → 接受；无 → **退化为「挖掉最少的格」**（找一组最小改动使它可解）。
 *   这条路径保证成品的形状**就是设计的形状**，规模也精确可控。
 *
 * - **从满矩形出发**（旧路径）：满矩形必然可解，然后逐组挖洞并验证。
 *   形状是「挖出来的」，与设计意图偏离，且规模不可控（v3 初版的世界一
 *   设计 16 格却只产出 12 格）。
 */
export function carveAndVerify(
  targetCells: number[],
  w: number,
  h: number,
  rng: Rng,
  opts: CarveOptions,
): CarveResult | null {
  const startFromDesign = opts.startFromDesign !== false;
  if (startFromDesign) {
    const r = carveFromDesign(targetCells, w, h, rng, opts);
    if (r) return r;
    // **回退**：设计形状不可解 → 从满矩形增量挖（可解性由「挖一组验一次」保证）。
    // 这条路径牺牲形状精确性，换取「一定有解」。
    if (opts.fallbackToFull !== false) {
      return carveFromFull(targetCells, w, h, rng, { ...opts, startFromDesign: false });
    }
    return null;
  }
  return carveFromFull(targetCells, w, h, rng, opts);
}

/**
 * 路径 A：从设计形状出发。
 *
 * 直接验证设计形状（+ 死端构造）有没有哈密顿路径。
 * 有 → 接受（形状与规模都精确可控）；无 → 返回 null 交给调用方回退。
 */
function carveFromDesign(
  targetCells: number[],
  w: number,
  h: number,
  rng: Rng,
  opts: CarveOptions,
): CarveResult | null {
  const targetSet = new Set(targetCells);
  let cells: number[] = targetCells.slice();
  /** 已挖掉的格（拍平索引）。设计本身的洞必须计入。 */
  const removed: number[] = allBoardCells(w, h).filter((c) => !targetSet.has(c));

  // ---- 死端构造 ----
  const deadEnds: number[] = [];
  let solvedPath: number[] | null = null;
  if (opts.wantDeadEnds > 0) {
    const made = buildDeadEnds(cells, w, h, opts.wantDeadEnds, removed, rng, opts);
    if (!made) return null;
    cells = made.cells;
    removed.length = 0;
    removed.push(...made.removed);
    deadEnds.push(...made.deadEnds);
    solvedPath = made.path;
  }

  // ---- 验证设计形状 ----
  //
  // **用 hint 快路径**：如果已经有解，直接回放检查（O(n)）；
  // 没有才做完整搜索。
  //
  // `opts.hintPath` 是设计阶段求得的解（拍平索引）——
  // 有了它就**完全不需要再搜索一次**。
  //
  // D=0 的世界（自由端点）没有 `buildDeadEnds` 的解可用，
  // 所以这里老老实实搜一次 —— 但 `designShape` 的 `requireSolvable`
  // 已经证明这盘有解，搜索会很快（Warnsdorff 剪枝有效）。
  const path = verify(cells, w, h, rng, deadEnds, opts, solvedPath ?? opts.hintPath ?? null);
  if (!path) return null;

  return finalize(cells, path, deadEnds, removed, targetCells, opts.minHoles);
}

/**
 * 路径 B：从满矩形出发，逐组挖洞并验证。
 *
 * 满矩形必然可解（蛇形路径），所以每挖一组都验证，
 * 挖不掉的就保留 —— **可解性由构造保证**，不依赖运气。
 */
function carveFromFull(
  targetCells: number[],
  w: number,
  h: number,
  rng: Rng,
  opts: CarveOptions,
): CarveResult | null {
  let cells: number[] = allBoardCells(w, h);
  const targetSet = new Set(targetCells);
  const removed: number[] = [];
  let currentPath: number[] | null = null;

  // ---- ① 死端构造 ----
  const deadEnds: number[] = [];
  const protectedCells = new Set<number>();
  if (opts.wantDeadEnds > 0) {
    const made = buildDeadEnds(cells, w, h, opts.wantDeadEnds, removed, rng, opts);
    if (!made) return null;
    cells = made.cells;
    removed.length = 0;
    removed.push(...made.removed);
    deadEnds.push(...made.deadEnds);
    for (const d of deadEnds) protectedCells.add(d);
  }

  // 死端 -> 局部编号（每次挖洞后都要重算）
  const recomputeEndpoints = (): { startLocal: number; endLocal: number } => {
    const lo = new Map<number, number>();
    cells.forEach((c, i) => lo.set(c, i));
    const dl = deadEnds.map((c) => lo.get(c)).filter((v): v is number => v !== undefined);
    return {
      startLocal: dl.length > 0 ? dl[0] : -1,
      endLocal: dl.length > 1 ? dl[1] : -1,
    };
  };
  void recomputeEndpoints;

  // ---- ② 逐组挖洞 ----
  //
  // 从满矩形出发：每挖一组都验证，挖不掉的保留 —— 可解性由构造保证。
  const allGroups: CarveGroup[] = [];
  const preferred: CarveGroup[] = [];

  // **骨牌组（主）**：相邻 2 格，1 黑 1 白 -> 奇偶中性。
  // 用骨牌而不是 2x2 块作为主要粒度，因为 2x2 太少：
  // 4x4 盘只有 1 个内部 2x2 块 -> 所有早期关卡长得一模一样。
  // 骨牌在 4x4 上有 24 种 -> 形状多样性天差地别。
  //
  // **preferred 的方向**：一组里**全部**格都在目标形状之外，才算「要挖的洞」。
  // （反过来挖会把设计保留的格挖掉 —— v3 初版的 bug：
  //  设计 16 格的盘，最后只剩 10~12 格。）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      // 横向骨牌
      if (x + 1 < w) {
        const g: CarveGroup = { cells: [c, c + 1], makesDeadEnd: -1 };
        allGroups.push(g);
        if (g.cells.every((k) => !targetSet.has(k))) preferred.push(g);
      }
      // 纵向骨牌
      if (y + 1 < h) {
        const g: CarveGroup = { cells: [c, c + w], makesDeadEnd: -1 };
        allGroups.push(g);
        if (g.cells.every((k) => !targetSet.has(k))) preferred.push(g);
      }
    }
  }

  // **2x2 组（辅）**：hole / corner 家族的大块形状。
  for (let y = 1; y + 1 < h - 1; y++) {
    for (let x = 1; x + 1 < w - 1; x++) {
      const g = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1];
      const grp: CarveGroup = { cells: g, makesDeadEnd: -1 };
      allGroups.push(grp);
      if (g.every((c) => !targetSet.has(c))) preferred.push(grp);
    }
  }
  // 黑+白对（scatter 家族）
  for (const g of pairGroups(cells, w, h, rng)) {
    const grp: CarveGroup = { cells: g.cells, makesDeadEnd: -1 };
    allGroups.push(grp);
    if (g.cells.every((c) => !targetSet.has(c))) preferred.push(grp);
  }

  // **失败预算**：证明「这一组挖下去就没解了」本身是 NP 难的，
  // 坏盘面的无解证明要指数级搜索。所以必须限制失败次数，
  // 否则生成时间会被几个难缠的盘面拖垮。
  // 放弃的代价只是「这一格没挖掉」，盘面稍微简单一点 —— 完全可接受。
  let failures = 0;
  const maxFailures = opts.maxFailures ?? 12;

  /**
   * 挖洞主循环。limit 是「最多挖几组」。
   *
   * **快速路径（路径拼接）**：挖掉一组之后，原路径只在被挖的格数处断裂。
   * 如果每处断裂的前后两格仍然相邻，就可以直接把断裂处接上 ——
   * 不用重新搜索哈密顿路径，只需 O(n) 的回放检查。
   * 这是把生成时间从 ~50ms/关降到 ~2ms/关的关键。
   */
  const mine = (groups: CarveGroup[], limit: number): void => {
    let done = 0;
    for (const g of rng.shuffle(groups)) {
      if (done >= limit) break;
      if (failures >= maxFailures) break;
      // **洞预算闸门**：不能超过 maxHoles。
      // v3 初版缺这道闸门，carve 会把盘掏空（世界一只剩 10~12 格）。
      if (opts.maxHoles !== undefined && removed.length + g.cells.length > opts.maxHoles) continue;
      if (g.cells.some((c) => !cells.includes(c))) continue;
      if (g.cells.some((c) => protectedCells.has(c))) continue;
      const trial = cells.filter((c) => !g.cells.includes(c));

      // 尝试路径拼接（快路径）
      let path = spliceFrom(currentPath, g.cells, trial, w, h, deadEnds);
      if (!path) {
        path = verify(trial, w, h, rng, deadEnds, opts, currentPath);
        if (!path) {
          failures++;
          continue;
        }
      }
      cells = trial;
      currentPath = path;
      removed.push(...g.cells);
      done++;
    }
  };

  // 第一轮：贴合目标形状（挖「目标形状之外」的格）。
  //
  // 早期 bug：`maxTries` 被当成「最多挖多少格」用，且传的是 `design.cells.length`
  // （= 目标可走格数），于是挖到几乎整张盘都空了 —— 既慢（几十次验证）
  // 又把盘面挖成了筛子。语义应该是「组数」，且要有合理上限。
  const targetGroups = Math.max(
    1,
    Math.round((w * h - targetCells.length) / 2),
  );
  mine(preferred, Math.min(targetGroups, 4));

  // 第二轮：**额外**挖若干组，制造形状多样性。
  //
  // 为什么必须有这一轮：形状库的每个家族能产出的形态很有限
  // （'notch' 只有 4 个边 × 少量长度 = 十几种；'corner' 只有 4 种）。
  // 只挖到「刚好符合目标形状」的话，整个世界会产出大量一模一样的盘面
  // （实测 4x4 世界的 12 关有 9 关完全相同）。
  //
  // 额外挖洞同样走「挖一格验一次」，所以可解性依然有保证；
  // 代价只是盘面比设计形状更「碎」一点 —— 视觉上更耐看，难度也更高。
  //
  // **洞预算**：额外轮的量必须受 maxHoles 约束，否则会掏空盘面。
  const extraAllowance = opts.maxHoles === undefined
    ? 1 + rng.int(0, 2)
    : Math.max(0, Math.min(1 + rng.int(0, 2), opts.maxHoles - removed.length));
  const fallback = allGroups.filter((g) => !preferred.includes(g));
  if (extraAllowance > 0) mine(fallback, extraAllowance);

  // ---- ③ 最终验证 + 取参考解 ----
  const finalPath = verify(cells, w, h, rng, deadEnds, opts, currentPath);
  if (!finalPath) return null;

  return finalize(cells, finalPath, deadEnds, removed, targetCells, opts.minHoles);
}

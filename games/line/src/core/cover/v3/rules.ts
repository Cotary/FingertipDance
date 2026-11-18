/**
 * Cover 模式 v3：规则引擎。
 *
 * 一个关卡的全部玩法约束集中在这里：走格规则、单向门、星星顺序、钥匙门、
 * 传送门、冰块滑行、起终点约束。
 *
 * 设计要点：**生成器与校验器共用这一份实现**（单一事实源），
 * 保证「生成时认为合法的关卡」与「校验时认为合法的关卡」判定一致。
 */
import { CoverCell, DIR } from './types';

/** 规则集：由盘面导出，节点编号 0..n-1（局部编号）。 */
export interface RuleSet {
  n: number;
  w: number;
  h: number;
  /** 拍平索引 -> 局部编号；不可走为 -1。 */
  localOf: Int32Array;
  /** 局部编号 -> 拍平索引。 */
  flatOf: Int32Array;
  /** 局部编号 -> 格子类型。 */
  typeOf: Uint8Array;
  /** 局部编号 -> 方向（仅单向门有意义）。 */
  dirOf: Uint8Array;
  /** 局部编号 -> 分组（钥匙/门配对、星星编号、传送门配对）。 */
  groupOf: Uint8Array;
  /** 局部编号 x 4 + 方向 -> 相邻局部编号；无则为 -1。 */
  nbr: Int32Array;
  /** 局部编号 -> 传送门搭档；无则为 -1。 */
  portalOf: Int32Array;
  /** 起点约束：-1 = 自由；否则必须从该局部编号起步。 */
  startAt: number;
  /** 终点约束：-1 = 自由；否则必须在该局部编号收尾。 */
  endAt: number;
  /** 是否含冰块（含则关闭 F/UD 剪枝，因为滑行会一次消耗多格）。 */
  hasIce: boolean;
  /** 是否含传送门（含则关闭 F/UD 剪枝，因为额外边会改变度数语义）。 */
  hasPortal: boolean;
  /**
   * **纯网格模式**：忽略冰块滑行与传送门额外边，只按四邻接走。
   *
   * ## 为什么需要这个开关（性能的关键）
   *
   * 冰块滑行会让「一次移动消耗多格」、传送门会加额外边 ——
   * 这两者都会让 F/UD 剪枝失效（格级度数 != 移动图度数），
   * 于是 9x9 盘的求解退化成指数级。
   *
   * 但注意：**参考解完全不需要用冰块和传送门**！
   * 机制是「加在已验证存在的解上」的 —— 参考解走的就是普通四邻接路径。
   * 所以「纯网格模式」下找到的路径，**在完整规则下同样合法**。
   *
   * 于是求解可以**全程用纯网格模式**：
   *   - 剪枝永远有效 -> 快；
   *   - 找到的路径在完整规则下依然合法 -> 正确。
   */
  plain: boolean;
  /**
   * **禁用传送边**（冰块滑行仍然生效）。
   *
   * ## 为什么需要这个独立于 `plain` 的开关
   *
   * `plain=true` 把**滑行和传送边一起关掉**，于是它求出来的路径
   * 可能「在冰块上转弯」—— 真实玩法下滑行会冲过头，这条路走不通。
   *
   * 而 `plain=false`（完整规则）把传送边也打开，于是**路径不再是四邻接链**：
   * 传送跳跃会跳过中间格，黑白交替（奇偶剪枝）的前提被破坏，
   * 求解器被迫在「大得多」的路径空间里搜索 —— 9x9 盘上实测
   * 纯网格 77 个节点就找到解，完整规则要 30 万个节点还找不到。
   *
   * 但**传送边其实用不上**：传送门是**可选**的（见 `candidateMoves` 的说明），
   * 生成器保证的参考解**从不使用传送边**。所以只要关掉传送边、
   * 保留滑行，就既拿到了「真实玩法下的合法路径」，又保住了剪枝。
   */
  noPortal: boolean;
}

/** 一次移动的结果。 */
export interface Move {
  /** 移动方向（0上 1下 2左 3右）。 */
  dir: number;
  /** 本次移动新消耗的局部编号序列（按经过顺序）。滑行会消耗多格。 */
  consumed: number[];
  /** 落点（消耗序列的最后一个）。 */
  target: number;
  /** 拾取的星星分组；0 = 无。 */
  shard: number;
  /** 拾取的钥匙分组；0 = 无。 */
  key: number;
  /** 是否走了传送门额外边。 */
  viaPortal: boolean;
  /**
   * 本次移动**结束后**的钥匙掩码（含滑行途中捡到的钥匙）。
   *
   * 为什么要有它：滑行是一次移动吃掉多格，**中途捡到的钥匙必须立刻生效** ——
   * 滑行途中的门就该被这枚刚捡到的钥匙打开。
   * 「道具是行进中拿到的，不是障碍」，所以钥匙不能等到移动结束才结算。
   */
  keyMask: number;
  /**
   * 本次移动**结束后**的下一个待收集星星分组（0 基）。
   *
   * 同上：滑行途中按顺序捡到的星星要沿滑行逐格推进，
   * 否则「滑行跨过了编号不符的星星」根本判不出来。
   */
  shardNext: number;
}

/**
 * 构造规则集。
 *
 * **grid 是唯一事实源**：每格 1 字节 = (type << 4) | (dir << 2) | group。
 * 方向与分组都从同一个字节里解出来 —— 之前用三个独立数组（type/dir/group）
 * 传参，重建规则集时会丢掉方向与分组，导致单向门箭头归零、星星编号全 0，
 * 回放校验必失败、机制被整体丢弃。**现在只接受 grid，杜绝这类信息丢失。 */
export function buildRuleSet(
  cells: number[],
  grid: Uint8Array,
  w: number,
  h: number,
): RuleSet {
  const n = cells.length;
  const localOf = new Int32Array(w * h).fill(-1);
  const flatOf = new Int32Array(n);
  cells.forEach((c, i) => {
    localOf[c] = i;
    flatOf[i] = c;
  });
  const typeOf = new Uint8Array(n);
  const dirOf = new Uint8Array(n);
  const groupOf = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = grid[flatOf[i]];
    typeOf[i] = (b >>> 4) & 0x0f;
    dirOf[i] = (b >>> 2) & 0x03;
    groupOf[i] = b & 0x03;
  }
  const nbr = new Int32Array(n * 4).fill(-1);
  for (let i = 0; i < n; i++) {
    const c = flatOf[i];
    const x = c % w;
    const y = Math.floor(c / w);
    if (y > 0) nbr[i * 4 + DIR.UP] = localOf[c - w];
    if (y < h - 1) nbr[i * 4 + DIR.DOWN] = localOf[c + w];
    if (x > 0) nbr[i * 4 + DIR.LEFT] = localOf[c - 1];
    if (x < w - 1) nbr[i * 4 + DIR.RIGHT] = localOf[c + 1];
  }
  // 传送门配对
  const portalOf = new Int32Array(n).fill(-1);
  const byGroup = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (typeOf[i] !== CoverCell.PORTAL) continue;
    const g = groupOf[i];
    const arr = byGroup.get(g) ?? [];
    arr.push(i);
    byGroup.set(g, arr);
  }
  for (const arr of byGroup.values()) {
    for (let k = 0; k + 1 < arr.length; k += 2) {
      portalOf[arr[k]] = arr[k + 1];
      portalOf[arr[k + 1]] = arr[k];
    }
  }

  const hasIce = typeOf.includes(CoverCell.ICE);
  const hasPortal = portalOf.some((v) => v >= 0);

  return {
    n,
    w,
    h,
    localOf,
    flatOf,
    typeOf,
    dirOf,
    groupOf,
    nbr,
    portalOf,
    startAt: -1,
    endAt: -1,
    hasIce,
    hasPortal,
    plain: false,
    noPortal: false,
  };
}

/** 复制一份规则集（可切换纯网格模式 / 禁用传送边）。 */
export function withPlain(rs: RuleSet, plain: boolean): RuleSet {
  if (rs.plain === plain) return rs;
  return { ...rs, plain };
}

/**
 * 复制一份规则集，**禁用传送边**（冰块滑行仍然生效）。
 *
 * 这是提示求解器要的「中间档」：滑行要遵守（真实玩法如此），
 * 传送边不要（参考解从不使用它，而它会毁掉剪枝）。
 */
export function withNoPortal(rs: RuleSet): RuleSet {
  if (rs.noPortal) return rs;
  return { ...rs, noPortal: true };
}

/**
 * 某个格是否可以进入（不考虑已走状态）。
 *
 * **注意**：这里**不检查单向门箭头** —— 箭头的检查在两处，
 * 分别是「离开」时（`stepMove` 开头）和「滑行途中进入」时
 * （`slideBlocked`）。合并到一处会漏掉其中一种。
 */
function enterable(
  rs: RuleSet,
  v: number,
  visited: Uint8Array,
  keyMask: number,
): boolean {
  if (v < 0) return false;
  if (visited[v]) return false;
  if (rs.typeOf[v] === CoverCell.GATE) {
    const g = rs.groupOf[v];
    if ((keyMask & (1 << g)) === 0) return false;
  }
  return true;
}

/**
 * 滑行途中进入 `v` 是否被阻断（**在进入之前**判定）。
 *
 * ## 为什么要有这个函数
 *
 * 滑行是一次移动吃掉多格，途中的每一格都要按**完整规则**判定。
 * 之前只有 `enterable()`（已走 / 障碍 / 未开锁的门），
 * **漏掉了单向门箭头** —— 于是滑行会从背面「穿过」单向门。
 *
 * ## 两条阻断规则
 *
 * 1. **单向门箭头**：门的箭头钉死了「允许的离开方向」。
 *    滑行方向与箭头不一致 → 不能进入 → **停在门前**。
 *    （箭头一致时可以从它上面滑过去，也可以停在它上面。）
 * 2. **星星编号**：星星必须按编号顺序经过。滑行若要跨过
 *    一颗编号不是「下一个待收集」的星星 → **停在它前面**
 *    （不能跨过去白捡一颗乱序的星星）。
 *
 * 钥匙**不阻断** —— 钥匙是行进中拿到的道具，捡到就生效。
 *
 * ## 传送门为什么不在这里
 *
 * 传送门**不是墙** —— 它要**被吃掉**（滑行到它上面就停），
 * 而不是「停在它前面」。所以它不进 `slideBlocked`，
 * 而是在滑行循环里单独处理（见 `stepMove`）。
 *
 * @param shardNext 当前「下一个必须收集」的星星分组（0 基）
 */
function slideBlocked(rs: RuleSet, v: number, dir: number, shardNext: number): boolean {
  if (v < 0) return true;
  if (rs.typeOf[v] === CoverCell.ONEWAY && rs.dirOf[v] !== dir) return true;
  if (rs.typeOf[v] === CoverCell.SHARD && rs.groupOf[v] !== shardNext) return true;
  return false;
}

/**
 * 从 cur 出发，沿 dir 移动一步；若是冰块则滑行到撞墙。
 *
 * **传送门语义（可选式）**：传送门格可以像普通格一样走进去；
 * 另外，站在传送门格上时还可以**选择**传送到它的搭档格（额外边）。
 *
 * 为什么是「可选」而不是「强制」：
 *   强制传送会让「一次移动消耗两格」，格级度数不再等于移动图度数，
 *   F/UD 剪枝全部失效，求解器在 9x9 盘上会指数爆炸。
 *   可选传送保留了传送门带来的额外路线（更多解、更多拓扑变化），
 *   且参考解可以完全不使用传送边 —— 于是解法求解依然走完整剪枝，速度可控。
 *
 * ## 滑行语义（2026-11-16 修复）
 *
 * 滑行途中每一格都要按完整规则判定，**遇到不满足的格就停在它前面**：
 *   - 单向门箭头与滑行方向不一致 → 停在门前（**本次修复的核心**）；
 *   - 星星编号不是下一个待收集的 → 停在它前面；
 *   - 未开锁的门 / 已走过的格 / 障碍 → 停在它前面。
 *
 * **传送门例外**：传送门**不是墙**，它要被吃掉 ——
 * 滑行到传送门格就停在那里（**打断滑行**），玩家可以主动传送到搭档。
 *
 * 滑行途中捡到的**钥匙立刻生效**（同一段滑行后面的门可以被
 * 刚捡到的钥匙打开），星星也沿滑行**逐格推进**顺序。
 * 「道具是行进中拿到的，不是障碍」—— 它们不该让滑行停下。
 *
 * @returns 新消耗的局部编号序列；不可移动返回 null
 */
export function stepMove(
  rs: RuleSet,
  cur: number,
  dir: number,
  visited: Uint8Array,
  keyMask: number,
  shardNext = 0,
): number[] | null {
  // 单向门：该格只能沿指定方向离开
  if (rs.typeOf[cur] === CoverCell.ONEWAY && rs.dirOf[cur] !== dir) return null;

  const first = rs.nbr[cur * 4 + dir];
  if (!enterable(rs, first, visited, keyMask)) return null;
  // 目标格若是乱序的星星 → 一步都走不了（与滑行同一套判定）
  if (rs.typeOf[first] === CoverCell.SHARD && rs.groupOf[first] !== shardNext) return null;

  const consumed: number[] = [first];
  // 纯网格模式：冰块不滑行（当普通格走）
  if (rs.plain || rs.typeOf[first] !== CoverCell.ICE) return consumed;

  // 冰块：沿进入方向继续滑行，直到下一格不可进入
  //
  // **滑行途中钥匙/星星的摘取状态逐格推进** —— 见 `slideBlocked` 的说明。
  let curCell = first;
  let simKeyMask = keyMask;
  let simShardNext = shardNext;
  for (;;) {
    const nx = rs.nbr[curCell * 4 + dir];
    if (!enterable(rs, nx, visited, simKeyMask)) break;
    if (slideBlocked(rs, nx, dir, simShardNext)) break;
    consumed.push(nx);
    // 沿途的道具立刻生效
    if (rs.typeOf[nx] === CoverCell.KEY) simKeyMask |= 1 << rs.groupOf[nx];
    if (rs.typeOf[nx] === CoverCell.SHARD) simShardNext = rs.groupOf[nx] + 1;
    curCell = nx;
    // **传送门打断滑行**：滑到传送门格就停 —— 传送门被吃掉，
    // 玩家站在它上面可以主动传送到搭档（不自动传送）。
    if (rs.typeOf[nx] === CoverCell.PORTAL) break;
  }
  return consumed;
}

/**
 * 枚举 cur 的所有候选移动。
 *
 * 除四邻接移动外，传送门格额外提供一条「跳到搭档」的边。
 * 该边消耗 [搭档]（cur 已在路径上，不重复消耗）。
 */
export function candidateMoves(
  rs: RuleSet,
  cur: number,
  visited: Uint8Array,
  keyMask: number,
  shardNext = 0,
): Move[] {
  const out: Move[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const consumed = stepMove(rs, cur, dir, visited, keyMask, shardNext);
    if (!consumed) continue;
    out.push(makeMove(rs, dir, consumed, false, keyMask, shardNext));
  }
  // 传送门额外边：站在传送门上可以传送到搭档
  // 纯网格模式下禁用（保持剪枝有效，且参考解不需要传送）
  // `noPortal` 模式同样禁用 —— 保留冰块滑行，但要保住四邻接链的结构。
  if (!rs.plain && !rs.noPortal && rs.typeOf[cur] === CoverCell.PORTAL) {
    const partner = rs.portalOf[cur];
    // 传送落点也要走完整规则：已走过 / 未开锁的门 → 不能传过去；
    // 落点是乱序的星星 → 也不能传过去（否则可以白捡一颗乱序的星星）。
    if (
      partner >= 0 &&
      enterable(rs, partner, visited, keyMask) &&
      !(rs.typeOf[partner] === CoverCell.SHARD && rs.groupOf[partner] !== shardNext)
    ) {
      out.push(makeMove(rs, -1, [partner], true, keyMask, shardNext));
    }
  }
  return out;
}

/**
 * 组装一次移动（含星星/钥匙拾取信息）。
 *
 * **拾取状态沿消耗序列逐格推进** —— 滑行会一次吃掉多格，
 * 中途捡到的钥匙必须立刻生效（同一段滑行后面的门能被它打开），
 * 星星也必须逐格校验顺序。
 */
function makeMove(
  rs: RuleSet,
  dir: number,
  consumed: number[],
  viaPortal: boolean,
  keyMask: number,
  shardNext: number,
): Move {
  const target = consumed[consumed.length - 1];
  let shard = 0;
  let key = 0;
  let nextKeyMask = keyMask;
  let nextShardNext = shardNext;
  for (const c of consumed) {
    if (rs.typeOf[c] === CoverCell.SHARD) {
      shard = rs.groupOf[c] + 1;
      nextShardNext = rs.groupOf[c] + 1;
    }
    if (rs.typeOf[c] === CoverCell.KEY) {
      key = rs.groupOf[c] + 1;
      nextKeyMask |= 1 << rs.groupOf[c];
    }
  }
  return { dir, consumed, target, shard, key, viaPortal, keyMask: nextKeyMask, shardNext: nextShardNext };
}

/**
 * 应用一次移动：更新 visited / keyMask / shardNext。
 *
 * **状态直接取 `mv` 里算好的结果**（`mv.keyMask` / `mv.shardNext`）——
 * 它们是滑行途中逐格推进出来的，不能在这里用「最后一次拾取」重算。
 */
export function applyMove(
  mv: Move,
  visited: Uint8Array,
  state: { keyMask: number; shardNext: number },
): void {
  for (const c of mv.consumed) visited[c] = 1;
  state.keyMask = mv.keyMask;
  state.shardNext = mv.shardNext;
}

/** 星星顺序校验：shardNext 表示下一个必须收集的星星分组（0 基）。 */
export function shardAllows(rs: RuleSet, v: number, shardNext: number): boolean {
  if (rs.typeOf[v] !== CoverCell.SHARD) return true;
  // group 为 0 基编号，必须等于下一个待收集的编号
  return rs.groupOf[v] === shardNext;
}

/**
 * 回放校验**剩余段**：从线头出发走完 `path`，检查每一步都合法。
 *
 * ## 与 `replay` 的区别
 *
 * - `replay`：校验**整盘** —— path 必须覆盖全部可走格，长度必须等于 `rs.n`。
 *   用于生成器校验参考解。
 * - `replayRemaining`：校验**续段** —— 玩家已经走过一部分（记在 `pre` 里），
 *   这里只校验「剩下的部分能不能接着走完」。
 *   用于提示系统：提示给出的是「从线头开始的剩余路线」。
 *
 * ## 判定内容
 *
 * 1. 路径起点必须就是线头（`path[0] === head`）；
 * 2. 每一步都必须是**完整规则**下合法的移动（冰块滑行、单向门、
 *    传送边、钥匙门都按真实玩法走）；
 * 3. 星星必须按编号顺序收集；
 * 4. 钉死了终点就必须落在终点；
 * 5. **剩余格必须被全部覆盖** —— 不能漏格（漏了就是没走完）。
 *
 * 第 2 条是提示系统的**正确性关键**：
 * 求解器可以用「纯网格模式」求解（剪枝永远有效，快），
 * 但纯网格模式下冰块不会滑行 —— 求出的路径可能在冰块处转弯，
 * 真实玩法下滑行会冲过头，这条路走不通。
 * 所以纯网格求出的路径**必须**用本函数在完整规则下复核。
 *
 * @param pre 已经走过的格（局部编号集合，非 0 = 障碍）
 * @param head 当前线头（局部编号）
 * @param initKeyMask 玩家已持有的钥匙
 * @param initShardNext 玩家下一个要收集的星星编号
 */
export function replayRemaining(
  rs: RuleSet,
  path: number[],
  pre: Uint8Array,
  head: number,
  initKeyMask = 0,
  initShardNext = 0,
): { ok: boolean; error?: string } {
  if (path.length === 0) return { ok: false, error: '空路径' };
  if (path[0] !== head) return { ok: false, error: `路径起点 ${path[0]} != 线头 ${head}` };

  const visited = pre.slice();
  const state = { keyMask: initKeyMask, shardNext: initShardNext };

  let cur = head;
  visited[cur] = 1;
  if (rs.typeOf[cur] === CoverCell.KEY) state.keyMask |= 1 << rs.groupOf[cur];
  if (rs.typeOf[cur] === CoverCell.SHARD) state.shardNext = rs.groupOf[cur] + 1;

  let p = 1;
  while (p < path.length) {
    const moves = candidateMoves(rs, cur, visited, state.keyMask, state.shardNext);
    let matched: Move | null = null;
    for (const mv of moves) {
      if (p + mv.consumed.length > path.length) continue;
      let ok = true;
      for (let k = 0; k < mv.consumed.length; k++) {
        if (mv.consumed[k] !== path[p + k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = mv;
        break;
      }
    }
    if (!matched) {
      return { ok: false, error: `第 ${p} 步不是合法移动（当前 ${cur}）` };
    }
    applyMove(matched, visited, state);
    cur = matched.target;
    p += matched.consumed.length;
  }

  if (rs.endAt >= 0 && cur !== rs.endAt) {
    return { ok: false, error: `终点应为 ${rs.endAt}，实际 ${cur}` };
  }
  // 覆盖检查：所有「没走过」的格都必须被这段路径覆盖。
  for (let i = 0; i < rs.n; i++) {
    if (!visited[i]) return { ok: false, error: `未覆盖格 ${i}` };
  }
  return { ok: true };
}

/**
 * 回放校验：按规则重走一遍 path，检查是否合法且覆盖全部可走格。
 *
 * 这是**完整规则**下的校验（含冰块滑行与传送门），
 * 与生成器共用同一份实现 —— 保证「认为合法」与「校验合法」一致。
 */
export function replay(
  rs: RuleSet,
  path: number[],
): { ok: boolean; error?: string } {
  const n = rs.n;
  if (path.length !== n) {
    return { ok: false, error: `路径长度 ${path.length} != 可走格数 ${n}` };
  }
  const visited = new Uint8Array(n);
  const state = { keyMask: 0, shardNext: 0 };

  let cur = path[0];
  if (cur < 0 || cur >= n) return { ok: false, error: '起点越界' };
  if (rs.startAt >= 0 && cur !== rs.startAt) {
    return { ok: false, error: `起点应为 ${rs.startAt}，实际 ${cur}` };
  }
  visited[cur] = 1;
  if (rs.typeOf[cur] === CoverCell.KEY) state.keyMask |= 1 << rs.groupOf[cur];
  if (rs.typeOf[cur] === CoverCell.SHARD) state.shardNext = rs.groupOf[cur] + 1;

  let p = 1;
  while (p < path.length) {
    const moves = candidateMoves(rs, cur, visited, state.keyMask, state.shardNext);
    let matched: Move | null = null;
    for (const mv of moves) {
      if (p + mv.consumed.length > path.length) continue;
      let ok = true;
      for (let k = 0; k < mv.consumed.length; k++) {
        if (mv.consumed[k] !== path[p + k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = mv;
        break;
      }
    }
    if (!matched) {
      return { ok: false, error: `第 ${p} 步不是合法移动（当前 ${cur}）` };
    }
    applyMove(matched, visited, state);
    cur = matched.target;
    p += matched.consumed.length;
  }

  if (rs.endAt >= 0 && cur !== rs.endAt) {
    return { ok: false, error: `终点应为 ${rs.endAt}，实际 ${cur}` };
  }
  // 覆盖检查
  for (let i = 0; i < n; i++) {
    if (!visited[i]) return { ok: false, error: `未覆盖格 ${i}` };
  }
  return { ok: true };
}

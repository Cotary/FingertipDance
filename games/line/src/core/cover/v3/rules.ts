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
  };
}

/** 复制一份规则集（可切换纯网格模式）。 */
export function withPlain(rs: RuleSet, plain: boolean): RuleSet {
  if (rs.plain === plain) return rs;
  return { ...rs, plain };
}

/** 某个格是否可以进入（不考虑已走状态）。 */
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
 * @returns 新消耗的局部编号序列；不可移动返回 null
 */
export function stepMove(
  rs: RuleSet,
  cur: number,
  dir: number,
  visited: Uint8Array,
  keyMask: number,
): number[] | null {
  // 单向门：该格只能沿指定方向离开
  if (rs.typeOf[cur] === CoverCell.ONEWAY && rs.dirOf[cur] !== dir) return null;

  const first = rs.nbr[cur * 4 + dir];
  if (!enterable(rs, first, visited, keyMask)) return null;

  const consumed: number[] = [first];
  // 纯网格模式：冰块不滑行（当普通格走）
  if (rs.plain || rs.typeOf[first] !== CoverCell.ICE) return consumed;

  // 冰块：沿进入方向继续滑行，直到下一格不可进入（已走 / 障碍 / 锁住的门 / 盘外）
  let curCell = first;
  for (;;) {
    const nx = rs.nbr[curCell * 4 + dir];
    if (!enterable(rs, nx, visited, keyMask)) break;
    consumed.push(nx);
    curCell = nx;
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
): Move[] {
  const out: Move[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const consumed = stepMove(rs, cur, dir, visited, keyMask);
    if (!consumed) continue;
    out.push(makeMove(rs, dir, consumed, false));
  }
  // 传送门额外边：站在传送门上可以传送到搭档
  // 纯网格模式下禁用（保持剪枝有效，且参考解不需要传送）
  if (!rs.plain && rs.typeOf[cur] === CoverCell.PORTAL) {
    const partner = rs.portalOf[cur];
    if (partner >= 0 && !visited[partner]) {
      out.push(makeMove(rs, -1, [partner], true));
    }
  }
  return out;
}

/** 组装一次移动（含星星/钥匙拾取信息）。 */
function makeMove(rs: RuleSet, dir: number, consumed: number[], viaPortal: boolean): Move {
  const target = consumed[consumed.length - 1];
  let shard = 0;
  let key = 0;
  for (const c of consumed) {
    if (rs.typeOf[c] === CoverCell.SHARD) shard = rs.groupOf[c] + 1;
    if (rs.typeOf[c] === CoverCell.KEY) key = rs.groupOf[c] + 1;
  }
  return { dir, consumed, target, shard, key, viaPortal };
}

/** 应用一次移动：更新 visited / keyMask。 */
export function applyMove(
  mv: Move,
  visited: Uint8Array,
  state: { keyMask: number; shardNext: number },
): void {
  for (const c of mv.consumed) visited[c] = 1;
  if (mv.key > 0) state.keyMask |= 1 << (mv.key - 1);
  if (mv.shard > 0) state.shardNext = mv.shard;
}

/** 星星顺序校验：shardNext 表示下一个必须收集的星星分组（0 基）。 */
export function shardAllows(rs: RuleSet, v: number, shardNext: number): boolean {
  if (rs.typeOf[v] !== CoverCell.SHARD) return true;
  // group 为 0 基编号，必须等于下一个待收集的编号
  return rs.groupOf[v] === shardNext;
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
    const moves = candidateMoves(rs, cur, visited, state.keyMask);
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
    // 星星顺序
    for (const c of matched.consumed) {
      if (rs.typeOf[c] === CoverCell.SHARD && rs.groupOf[c] !== state.shardNext) {
        return { ok: false, error: `星星顺序错误：期望 ${state.shardNext}，实际 ${rs.groupOf[c]}` };
      }
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

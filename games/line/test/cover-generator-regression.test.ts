/**
 * cover v3 生成器的**回归测试**。
 *
 * 这个文件里的每一条都对应一个**真实踩过的 bug** ——
 * 它们曾经让 1000 关里有 62 关退化成「零机制」关卡（最难的那段反而最简单）。
 *
 * ## 背景：两个致命 bug
 *
 * ### Bug ①：冰块方向判定反了
 *
 * 规则（`rules.ts` 的 `stepMove`）：**进入冰块后沿「进入方向」滑行**。
 * 而 `findIceSpot` 校验时用的是「**离开**方向」——
 * 两者只在「解在冰块处直行」时相等。
 *
 * 一旦解在冰块处转弯：
 *   - 进入方向的下一格可走 → 滑行吃掉解之外的格 → 参考解失效
 *     → **整盘机制被清零**（52 关）；
 *   - 进入方向的下一格被挡 → 滑行 0 格停下 → 冰块**毫无玩法效果**（93 关）。
 *
 * 实测 685 个冰块里 161 个方向判定错误（23.5%）。
 *
 * ### Bug ②：机制互相覆盖
 *
 * 单向门/传送门用了 `used` 集合，但**星星、钥匙门、冰块各自为政**。
 * 于是钥匙门可能把一颗星星盖成 GATE（星星编号断档），
 * 冰块可能把一颗星星盖成 ICE —— 而 `shardAllows` 要求星星编号连续，
 * 编号一断就**永远走不下去**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { decodeGrid, decodeSolution, type LevelEntryWithSolution } from '../src/core/cover/v3/codec';
import { buildRuleSet, replay, stepMove } from '../src/core/cover/v3/rules';
import { CoverCell, cellType, DIR, OPPOSITE, type Dir } from '../src/core/cover/v3/types';

/** 读取真实关卡表（服务端版，含解）。 */
function loadLevels(): LevelEntryWithSolution[] {
  const file = path.resolve(__dirname, '../data/levels-v3.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { levels: LevelEntryWithSolution[] };
  return raw.levels;
}

const LEVELS = loadLevels();

/** 由坐标差求方向。 */
function dirBetween(from: number, to: number, w: number): number {
  const dx = (to % w) - (from % w);
  const dy = Math.floor(to / w) - Math.floor(from / w);
  if (dx === 0 && dy === -1) return DIR.UP;
  if (dx === 0 && dy === 1) return DIR.DOWN;
  if (dx === -1 && dy === 0) return DIR.LEFT;
  if (dx === 1 && dy === 0) return DIR.RIGHT;
  return -1;
}

describe('cover v3 / 回归：冰块方向', () => {
  it('每个冰块的「进入方向」与「离开方向」一致（否则滑行会吃掉解之外的格）', () => {
    let iceCount = 0;
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
        cells.push(i);
      }
      const rs = buildRuleSet(cells, grid, entry.w, entry.h);
      const path = decodeSolution(entry.solution, entry.w).map((f) => rs.localOf[f]);

      for (let pos = 1; pos < path.length - 1; pos++) {
        if (rs.typeOf[path[pos]] !== CoverCell.ICE) continue;
        iceCount++;
        const dIn = dirBetween(rs.flatOf[path[pos - 1]], rs.flatOf[path[pos]], entry.w);
        const dOut = dirBetween(rs.flatOf[path[pos]], rs.flatOf[path[pos + 1]], entry.w);
        expect(
          dIn,
          `第 ${entry.idx} 关：冰块在解的位置 ${pos} 处转向（dIn=${dIn} != dOut=${dOut}）`,
        ).toBe(dOut);
      }
    }
    // 表里必须真的有冰块，否则这条测试是空转
    expect(iceCount).toBeGreaterThan(0);
  });

  it('冰块的滑行直线与解的路径完全重合（撞墙才停，不能多走一格）', () => {
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
        cells.push(i);
      }
      const rs = buildRuleSet(cells, grid, entry.w, entry.h);
      const path = decodeSolution(entry.solution, entry.w).map((f) => rs.localOf[f]);

      for (let pos = 1; pos < path.length - 1; pos++) {
        if (rs.typeOf[path[pos]] !== CoverCell.ICE) continue;
        const d = dirBetween(rs.flatOf[path[pos - 1]], rs.flatOf[path[pos]], entry.w);

        // 沿进入方向走到「不能走」为止，每一格都必须在解里
        let idx = pos;
        let cur = rs.flatOf[path[pos]];
        for (;;) {
          const x = cur % entry.w;
          const y = Math.floor(cur / entry.w);
          const nx = x + (d === DIR.LEFT ? -1 : d === DIR.RIGHT ? 1 : 0);
          const ny = y + (d === DIR.UP ? -1 : d === DIR.DOWN ? 1 : 0);
          if (nx < 0 || nx >= entry.w || ny < 0 || ny >= entry.h) break;
          const nxtFlat = ny * entry.w + nx;
          const nxtLocal = rs.localOf[nxtFlat];
          if (nxtLocal < 0) break;
          idx++;
          expect(
            path[idx],
            `第 ${entry.idx} 关：冰块滑行会经过解之外的格 ${nxtFlat}`,
          ).toBe(nxtLocal);
          cur = nxtFlat;
        }
      }
    }
  });
});

describe('cover v3 / 回归：机制互不覆盖', () => {
  it('一个格只承载一种机制（星星编号不能被别的机制盖掉）', () => {
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      // 星星必须按 0,1,2... 连续编号 —— 编号断档会让玩家永远走不下去
      const shardGroups = new Set<number>();
      const keyGroups = new Set<number>();
      const portalGroups = new Set<number>();
      let shardCount = 0;

      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        const g = grid[i] & 0x03;
        if (t === CoverCell.SHARD) {
          shardCount++;
          shardGroups.add(g);
        }
        if (t === CoverCell.KEY) keyGroups.add(g);
        if (t === CoverCell.PORTAL) portalGroups.add(g);
      }

      // 星星编号必须是从 0 开始的连续段
      if (shardCount > 0) {
        const sorted = [...shardGroups].sort((a, b) => a - b);
        expect(sorted[0], `第 ${entry.idx} 关星星编号应从 0 开始`).toBe(0);
        for (let i = 0; i < sorted.length; i++) {
          expect(sorted[i], `第 ${entry.idx} 关星星编号应连续`).toBe(i);
        }
      }
      // 钥匙与门必须成对（同 group 各一个）
      for (const g of keyGroups) {
        let gateCount = 0;
        for (let i = 0; i < grid.length; i++) {
          if (cellType(grid[i]) === CoverCell.GATE && (grid[i] & 0x03) === g) gateCount++;
        }
        expect(gateCount, `第 ${entry.idx} 关钥匙 group ${g} 缺少配对的门`).toBeGreaterThan(0);
      }
      // 传送门必须成对
      for (const g of portalGroups) {
        let cnt = 0;
        for (let i = 0; i < grid.length; i++) {
          if (cellType(grid[i]) === CoverCell.PORTAL && (grid[i] & 0x03) === g) cnt++;
        }
        expect(cnt % 2, `第 ${entry.idx} 关传送门 group ${g} 未成对`).toBe(0);
      }
    }
  });

  it('单向门的箭头方向 == 解在该处的离开方向', () => {
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
        cells.push(i);
      }
      const rs = buildRuleSet(cells, grid, entry.w, entry.h);
      const path = decodeSolution(entry.solution, entry.w).map((f) => rs.localOf[f]);

      for (let pos = 0; pos < path.length - 1; pos++) {
        const v = path[pos];
        if (rs.typeOf[v] !== CoverCell.ONEWAY) continue;
        const d = dirBetween(rs.flatOf[v], rs.flatOf[path[pos + 1]], entry.w);
        expect(rs.dirOf[v], `第 ${entry.idx} 关单向门方向错误`).toBe(d);
      }
    }
  });
});

describe('cover v3 / 回归：滑行 × 单向门（2026-11-16 修复）', () => {
  /**
   * **全量 1000 关**在**新规则**下参考解依然合法。
   *
   * 修复改变了滑行的语义（撞反向单向门 → 停在门前），
   * 所以必须确认**存量关卡不需要重生成**。
   */
  it('全部 1000 关的参考解在新规则下依然合法', () => {
    let checked = 0;
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
        cells.push(i);
      }
      const rs = buildRuleSet(cells, grid, entry.w, entry.h);
      if (entry.startAt >= 0) rs.startAt = rs.localOf[entry.startAt];
      if (entry.endAt >= 0) rs.endAt = rs.localOf[entry.endAt];
      const path = decodeSolution(entry.solution, entry.w).map((f) => rs.localOf[f]);
      const r = replay(rs, path);
      expect(r.ok, `第 ${entry.idx} 关参考解在新规则下失效：${r.error}`).toBe(true);
      checked++;
    }
    expect(checked).toBe(LEVELS.length);
  });

  /**
   * 任意方向进入冰块，滑行都**不能穿过箭头不一致的单向门**。
   *
   * 这条覆盖的是「玩家从非参考解方向进入冰块」的路线 ——
   * 生成器只保证参考解方向合法，其他方向是玩家的自由。
   */
  it('滑行永不穿过箭头不一致的单向门（任意进入方向）', () => {
    let slideCount = 0;
    for (const entry of LEVELS) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      const cells: number[] = [];
      for (let i = 0; i < grid.length; i++) {
        const t = cellType(grid[i]);
        if (t === CoverCell.VOID || t === CoverCell.BLOCK) continue;
        cells.push(i);
      }
      const rs = buildRuleSet(cells, grid, entry.w, entry.h);

      for (let ice = 0; ice < rs.n; ice++) {
        if (rs.typeOf[ice] !== CoverCell.ICE) continue;
        for (let dir = 0; dir < 4; dir++) {
          // 玩家沿 dir 方向滑行 → 上游格在 ice 的 **dir 反方向**
          const upstream = rs.nbr[ice * 4 + OPPOSITE[dir as Dir]];
          if (upstream < 0) continue;
          const visited = new Uint8Array(rs.n);
          visited[upstream] = 1;
          const consumed = stepMove(rs, upstream, dir, visited, 0, 0);
          // 必须真的滑起来了（消耗序列的第一格是冰块，且不止一格）
          if (!consumed || consumed[0] !== ice || consumed.length < 2) continue;
          slideCount++;
          for (const c of consumed) {
            if (rs.typeOf[c] === CoverCell.ONEWAY) {
              expect(
                rs.dirOf[c],
                `第 ${entry.idx} 关：滑行穿过了箭头不一致的单向门（格 ${c}）`,
              ).toBe(dir);
            }
          }
        }
      }
    }
    expect(slideCount, '应当统计到若干条滑行路线').toBeGreaterThan(0);
  });
});

describe('cover v3 / 回归：机制覆盖率', () => {
  it('机制世界内 100% 的关卡至少有一种机制（不能退化成零机制关卡）', () => {
    // 世界二起才有机制
    const withMech = LEVELS.filter((l) => l.idx >= 13);
    const zero = withMech.filter((l) => l.mechKinds === 0);
    expect(
      zero.map((l) => l.idx),
      '这些关卡退化成零机制关卡（机制注入失败后整盘被清零）',
    ).toEqual([]);
  });

  it('世界七（冰块世界）的关卡真的有冰块', () => {
    const w7 = LEVELS.filter((l) => l.idx >= 705);
    expect(w7.length).toBeGreaterThan(0);
    let withIce = 0;
    for (const entry of w7) {
      const grid = decodeGrid(entry.grid, entry.w * entry.h);
      for (let i = 0; i < grid.length; i++) {
        if (cellType(grid[i]) === CoverCell.ICE) {
          withIce++;
          break;
        }
      }
    }
    // 至少 80% 的世界七关卡带冰块（其余可能是注入位置不足，退化但不致命）
    expect(withIce / w7.length).toBeGreaterThan(0.8);
  });
});

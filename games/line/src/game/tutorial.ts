/**
 * 新手引导关 —— 前端手写，不占正式关号。
 *
 * ## 为什么手写而不是用生成器
 *
 * 生成器造的是「有挑战的盘」：它保证可解，但不保证**只教一件事**。
 * 引导关的要求正好相反 —— 第 1 关必须一眼看出「要从起点拖到终点、
 * 且每一格都要踩到」，盘面上不能有任何干扰物。
 *
 * 所以这三关是**逐格写死**的，和 1000 关正式表完全脱钩：
 *
 * - 关号用负数（`-1 / -2 / -3`），永不与正式关号（1..1000）撞；
 * - 不写 `level_records`、不参与星级、不影响 `max_level`；
 * - 不进地图页、不进排行榜。
 *
 * ## 三关怎么切分
 *
 * | 关 | 教什么 | 盘面 | 为什么这么排 |
 * |---|---|---|---|
 * | 1 | 拖线 + 铺满全盘 | 3×3 纯空格 | 不会就不能玩，必须单独教、零干扰 |
 * | 2 | 钥匙与门 + 冰面滑行 | 4×4 | 都是「走法规则」：一个限制进入、一个不可控停 |
 * | 3 | 星屑顺序 + 单向门 + 传送门 | 5×5 | 都是「特殊格」：一个限制顺序、两个改走法 |
 *
 * 一关只堆同类规则，玩家的心理负担才是「一条新规则」而不是三条。
 *
 * ## 每关的讲解文案只写两行
 *
 * 长文案没人读。每关开头给一张卡：一句"这关学什么"+ 一句"怎么过"。
 *
 * ## 可解性怎么保证
 *
 * 手写盘面最容易出的错是「画完发现无解」。`test/tutorial.test.ts`
 * 用正式的规则回放（`solve` + `replay`）逐关验证，改盘面时跑一下就知道。
 */
import { CoverCell, packCell, DIR } from '../core/cover/v3/types';
import type { CoverLevel } from './coverLevel';

/** 引导关卡号基数：第 1 关 -1，第 2 关 -2，第 3 关 -3。 */
export const TUTORIAL_BASE = -1;

/** 引导关总数。 */
export const TUTORIAL_COUNT = 3;

/** 一关引导的定义。 */
export interface TutorialLevel {
  /** 负数关号：-1 / -2 / -3 */
  idx: number;
  /** 标题（卡片上的大字） */
  title: string;
  /** 两行说明（卡片正文） */
  lines: [string, string];
  /** 关卡本体 */
  level: CoverLevel;
}

/**
 * 字符画 → 关卡。
 *
 * ## 为什么用字符画
 *
 * 盘面是手调的，`['..#..', ...]` 这种写法能**一眼看出形状**。
 * 直接往 `Uint8Array` 里填 packCell 的十六进制数，改一格要算半天，
 * 而且没法 review。
 *
 * 图例：
 *
 * | 字符 | 含义 |
 * |---|---|
 * | `.` | 普通可走格 |
 * | `#` | 石头（盘内障碍，不可走） |
 * | `S` / `E` | 起点 / 终点（也是可走格） |
 * | `A` `B` | 钥匙 A / B（group 0 / 1） |
 * | `a` `b` | 门 A / B（与 A / B 配对） |
 * | `*` | 星屑（group 按出现顺序 0,1,2…） |
 * | `^` `v` `<` `>` | 单向门（只能朝箭头方向离开） |
 * | `1` `2` | 传送门（同数字成对） |
 * | `I` | 冰面 |
 * | 空格 | 盘外缺口（VOID） |
 *
 * 钥匙用「大写 + 对应小写」而不是"按出现顺序自动配对"：
 * 后者在图上有两把钥匙时完全看不出谁配谁，容易画错还看不出来。
 */
function fromArt(art: string[], idx: number, seed: number): CoverLevel {
  const h = art.length;
  const w = Math.max(...art.map((r) => r.length));

  const grid = new Uint8Array(w * h);
  let startAt = -1;
  let endAt = -1;
  let required = 0;
  let shardNext = 0;
  /** 传送门的 group 分配表（`1` → 0, `2` → 1） */
  const portalGroup = new Map<string, number>();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = art[y][x] ?? ' ';
      const i = y * w + x;
      let cell = packCell(CoverCell.VOID);

      switch (ch) {
        case '.':
          cell = packCell(CoverCell.BRICK);
          required++;
          break;
        case '#':
          cell = packCell(CoverCell.BLOCK);
          break;
        case 'S':
          cell = packCell(CoverCell.START);
          startAt = i;
          required++;
          break;
        case 'E':
          cell = packCell(CoverCell.END);
          endAt = i;
          required++;
          break;
        case 'A':
          cell = packCell(CoverCell.KEY, 0, 0);
          required++;
          break;
        case 'B':
          cell = packCell(CoverCell.KEY, 0, 1);
          required++;
          break;
        case 'a':
          cell = packCell(CoverCell.GATE, 0, 0);
          required++;
          break;
        case 'b':
          cell = packCell(CoverCell.GATE, 0, 1);
          required++;
          break;
        case '*':
          // group 只有 2 bit（0..3），引导关最多 4 颗星
          cell = packCell(CoverCell.SHARD, 0, shardNext++ & 0x03);
          required++;
          break;
        case '^':
          cell = packCell(CoverCell.ONEWAY, DIR.UP);
          required++;
          break;
        case 'v':
          cell = packCell(CoverCell.ONEWAY, DIR.DOWN);
          required++;
          break;
        case '<':
          cell = packCell(CoverCell.ONEWAY, DIR.LEFT);
          required++;
          break;
        case '>':
          cell = packCell(CoverCell.ONEWAY, DIR.RIGHT);
          required++;
          break;
        case '1':
        case '2': {
          if (!portalGroup.has(ch)) portalGroup.set(ch, portalGroup.size);
          cell = packCell(CoverCell.PORTAL, 0, portalGroup.get(ch)!);
          required++;
          break;
        }
        case 'I':
          cell = packCell(CoverCell.ICE);
          required++;
          break;
        default:
          cell = packCell(CoverCell.VOID);
      }
      grid[i] = cell;
    }
  }

  return {
    idx,
    seed,
    w,
    h,
    grid,
    required,
    diff: 0,
    deadEnds: startAt >= 0 && endAt >= 0 ? 2 : 0,
    startAt,
    endAt,
    mechKinds: 1,
    solutionCount: 1,
  };
}

/**
 * 第 1 关：3×3，只有起点终点，必须铺满。
 *
 * ```
 * S . .
 * . . .
 * . . E
 * ```
 *
 * 只有 9 格，蛇形和绕圈都能过 —— 目的不是难，而是让玩家**发现**
 * 「不铺满不算过」。这一条不教，后面所有关都无从谈起。
 */
const L1 = fromArt([
  'S..',
  '...',
  '..E',
], TUTORIAL_BASE, 9101);

/**
 * 第 2 关：4×4，钥匙与门 + 冰面。
 *
 * ```
 * S . A .
 * . . . .
 * . a I I
 * . . E .
 * ```
 *
 * - 钥匙 A 在右上，门 a 在左下：**必须先绕上去拿钥匙**，直冲门会被挡。
 * - 冰面 I 在门右边两格：踩上去会一路滑到最右，不能中途停。
 *
 * ## 终点为什么在 (3,2) 而不是右下角
 *
 * 4×4 是**偶盘**。棋盘染色后，哈密顿路径的两个端点必须**异色**，
 * 否则无解 —— 起点 (0,0) 是深色，终点若放 (3,3) 也是深色，必然画不出解。
 * 这条规则最初没考虑到，写了 7 个候选全部无解（见 `tools/probe-tutorial.ts`
 * 的实测记录）。放到 (3,2) 就异色了。
 *
 * 奇盘（5×5）没有这个限制，两端必须同色 —— 第 3 关的 (0,0)/(4,4) 正因此成立。
 */
const L2 = fromArt([
  'S.A.',
  '....',
  '.aII',
  '..E.',
], TUTORIAL_BASE - 1, 9102);

/**
 * 第 3 关：5×5，星屑顺序 + 传送门。
 *
 * ```
 * S . * . .
 * . . . . .
 * . . * . .
 * . . . . .
 * 1 . . 1 E
 * ```
 *
 * - 两颗星屑必须按序（先 `*` group0 再 group1），跳着捡不生效。
 * - 传送门 `1`↔`1` 在最下排左右两端：踩左边那个，立刻从右边出来，
 *   是通往终点的捷径。**传送是强制的** —— 踩上去没有"不传"的选项，
 *   这正是要教的东西。
 *
 * ## 为什么这一关不放单向门
 *
 * 单向门 + 传送门一起出现时，玩家分不清「这里走不通」是因为箭头还是
 * 因为传送门 —— 两种机制的失败反馈长得一样（都是"走不过去"）。
 * 单向门留到正式关第一次遇到时用提示卡补（见 `main.ts` 的机制首见提示）。
 *
 * ## 盘面是实测出来的，不是画的
 *
 * 5×5 加传送门很容易画成无解（传送强制跳跃会切断"铺满"的可能）。
 * 这个布局经过 `tools/probe-tutorial.ts` 逐个候选实测，
 * `test/tutorial.test.ts` 用正式求解器 + 回放锁住。
 */
const L3 = fromArt([
  'S.*..',
  '.....',
  '..*..',
  '.....',
  '1..1E',
], TUTORIAL_BASE - 2, 9103);

/** 三关引导，按顺序。 */
export const TUTORIAL_LEVELS: TutorialLevel[] = [
  {
    idx: L1.idx,
    title: '一条线，铺满它',
    lines: ['从起点按住，拖到终点。', '每一格都要踩到，不能重复、不能断。'],
    level: L1,
  },
  {
    idx: L2.idx,
    title: '先拿钥匙，小心冰面',
    lines: ['门锁着，得先捡到同色的钥匙。', '冰面踩上去就一直滑，停不下来。'],
    level: L2,
  },
  {
    idx: L3.idx,
    title: '按顺序，借捷径',
    lines: ['星屑要按编号顺序捡，跳着捡不算。', '传送门成对，踩一个就从另一个出来。'],
    level: L3,
  },
];

/** 是不是引导关号。 */
export function isTutorialLevel(idx: number): boolean {
  return idx <= TUTORIAL_BASE && idx > TUTORIAL_BASE - 100;
}

/** 按关号取引导关。 */
export function tutorialByIndex(idx: number): TutorialLevel | undefined {
  return TUTORIAL_LEVELS.find((t) => t.idx === idx);
}

/**
 * 第几关（从 1 开始）。不是引导关返回 0。
 *
 * UI 上写「引导 2/3」，不能写关号 `-2` —— 玩家会以为进度坏了。
 */
export function tutorialStepOf(idx: number): number {
  const i = TUTORIAL_LEVELS.findIndex((t) => t.idx === idx);
  return i < 0 ? 0 : i + 1;
}

/** 下一关的关号；已是最后一关返回 null。 */
export function nextTutorialIdx(idx: number): number | null {
  const i = TUTORIAL_LEVELS.findIndex((t) => t.idx === idx);
  if (i < 0 || i + 1 >= TUTORIAL_LEVELS.length) return null;
  return TUTORIAL_LEVELS[i + 1].idx;
}

/** 第一关的关号（入口）。 */
export const FIRST_TUTORIAL_IDX = TUTORIAL_LEVELS[0].idx;

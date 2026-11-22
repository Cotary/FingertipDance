/**
 * 机制首见说明卡 —— 「第几关第一次遇到单向门」这类提示。
 *
 * ## 为什么不是让运营配 1000 行
 *
 * 1000 关是生成器产的，机制分布跟着种子走（实测：单向门首现第 13 关、
 * 星屑第 33 关、钥匙门第 65 关、传送门第 153 关、冰面第 705 关）。
 * 让运营逐关标「这关该不该弹卡」既做不完，也会和关卡表更新脱节 ——
 * 换了版本、机制提前了，配置还停在老位置，于是提示卡在该出现时不出现。
 *
 * 所以：**首现位置由关卡表自动推导**（解码 `grid` 扫每关有哪些机制格），
 * 运营只管一个总开关（`features.mechIntro`）。
 *
 * ## 为什么不是"首次出现那一关才弹"
 *
 * 首现那一关可能一次冒出两种新机制（第 65 关就同时有钥匙和门），
 * 两张卡叠在一起等于没讲。所以按**机制**分别记「见过没」，
 * 同一关里最多弹一张（按固定顺序，一次只讲一个），其余的顺延到
 * 之后遇到它的关再弹 —— 反正它会反复出现（单向门 616 关、星屑 628 关）。
 *
 * ## 引导关已经教过的，不再弹
 *
 * 引导第 2 关教了钥匙门 + 冰面，第 3 关教了星屑 + 传送门。
 * 走完引导后这些机制要立刻标记为"已见"，否则第 33 关会再给玩家讲一遍星屑 ——
 * 那会让他觉得"这游戏把我当第一次玩"。
 */

import { decodeGrid } from '../core/cover/v3/codec';
import { CoverCell, cellType } from '../core/cover/v3/types';
import type { LevelEntry } from '../core/cover/v3/codec';

/** 会弹说明卡的机制（按讲解顺序：先走法限制，后特殊格）。 */
export const MECH_ORDER = [
  CoverCell.ONEWAY,
  CoverCell.KEY,
  CoverCell.GATE,
  CoverCell.SHARD,
  CoverCell.PORTAL,
  CoverCell.ICE,
] as const;

export type MechType = (typeof MECH_ORDER)[number];

/** 一张说明卡的内容。 */
export interface MechCard {
  mech: MechType;
  title: string;
  /** 两行说明 */
  lines: [string, string];
}

/**
 * 说明卡文案。
 *
 * 每条只讲**这一条规则怎么用**，不讲设计意图、不做鼓励。
 * 玩家在关卡里遇到卡是来办事的，不是来读文案的。
 *
 * 钥匙与门是**同一张卡**（一个机制的两半）：分成两张会说两遍
 * "先拿钥匙再开门"，第二张纯属噪音。
 */
export const MECH_CARDS: Record<number, MechCard> = {
  [CoverCell.ONEWAY]: {
    mech: CoverCell.ONEWAY,
    title: '单向门',
    lines: ['带箭头的格子只能朝箭头方向走过去。', '逆着箭头走不过去 —— 不是卡住了，是方向不对。'],
  },
  [CoverCell.KEY]: {
    mech: CoverCell.KEY,
    title: '钥匙与门',
    lines: ['先踩到钥匙，同色的门才会开。', '没拿钥匙就走到门前，会被挡回来。'],
  },
  [CoverCell.GATE]: {
    mech: CoverCell.GATE,
    title: '钥匙与门',
    lines: ['先踩到钥匙，同色的门才会开。', '没拿钥匙就走到门前，会被挡回来。'],
  },
  [CoverCell.SHARD]: {
    mech: CoverCell.SHARD,
    title: '星屑',
    lines: ['星屑要按编号顺序捡，跳着捡不算。', '顺序错了那一颗不亮，得回去重走。'],
  },
  [CoverCell.PORTAL]: {
    mech: CoverCell.PORTAL,
    title: '传送门',
    lines: ['成对的门，踩一个立刻从另一个出来。', '传送是强制的，没有"不传"的选项。'],
  },
  [CoverCell.ICE]: {
    mech: CoverCell.ICE,
    title: '冰面',
    lines: ['踩上冰面会一直滑，直到撞到东西才停。', '想在冰面中间拐弯，得先把后面的路铺好。'],
  },
};

/**
 * 扫一关有哪些机制格。
 *
 * @returns 机制类型的集合（不含 BRICK / VOID / BLOCK / 起终点）
 */
export function mechsOf(entry: LevelEntry): Set<number> {
  const grid = decodeGrid(entry.grid, entry.w * entry.h);
  const out = new Set<number>();
  for (const b of grid) {
    const t = cellType(b);
    if (t === CoverCell.ONEWAY || t === CoverCell.KEY || t === CoverCell.GATE ||
        t === CoverCell.SHARD || t === CoverCell.PORTAL || t === CoverCell.ICE) {
      out.add(t);
    }
  }
  return out;
}

/**
 * 某个机制第一次出现的关号（只扫已经加载的关卡）。
 *
 * ## 生产代码不用它，但它是**诊断与测试的入口**
 *
 * 界面上的判定走 `pickMechCard`（看这一关有没有没见过的机制），
 * 不需要"首现关号"。但排查问题时要回答"单向门到底第几关第一次出现"——
 * 靠肉眼翻 1000 关的 grid 不现实。测试也用它锁住「首现位置有没有变」
 * （关卡表一更新，玩家第一次遇到某机制的位置就跟着变了）。
 *
 * 所以**保留**，并在注释里写明它不是死代码的理由 ——
 * 否则下一个人会以为它没人用而删掉，连带删掉测试的依据。
 *
 * ## 为什么允许"扫不到"
 *
 * 客户端是**分批加载**关卡表的（`CoverLevelStore.ensure`）。启动时可能只有
 * 前 50 关，而冰面首次出现在第 705 关 —— 这时返回 `undefined` 是诚实的：
 * 我们确实不知道。调用方据此"先不弹"，等那一批加载进来再判断。
 *
 * 返回 0 才是错的：那会让调用方以为"第 0 关就该弹"，然后弹不出来还不报错。
 */
export function firstLevelOf(mech: number, loaded: LevelEntry[]): number | undefined {
  for (const e of loaded) {
    if (mechsOf(e).has(mech)) return e.idx;
  }
  return undefined;
}

/**
 * 给出这一关**该弹**的说明卡（最多一张）。
 *
 * @param entry 即将进入的关卡
 * @param seen 已经见过的机制集合（会被本函数读取，不修改）
 * @returns 需要弹的卡；`null` = 这一关不弹
 */
export function pickMechCard(entry: LevelEntry, seen: ReadonlySet<number>): MechCard | null {
  const here = mechsOf(entry);
  // 按固定顺序挑第一个没见过的 —— 同一关有两种新机制时只讲一个，
  // 另一个留到之后遇到它的关（它们都会反复出现）
  for (const m of MECH_ORDER) {
    if (here.has(m) && !seen.has(m)) {
      // 钥匙/门是一张卡：见到其中任意一个都算"这一族"见过了
      return MECH_CARDS[m] ?? null;
    }
  }
  return null;
}

/**
 * 把「这一关见过的机制」合进已见集合。
 *
 * 钥匙与门必须**一起**标记：玩家在第 65 关看到的是"钥匙+门"这张卡，
 * 如果只标记 KEY，第 66 关遇到单独的门又会弹一次同样的卡。
 */
export function markSeen(seen: Set<number>, entry: LevelEntry): void {
  const here = mechsOf(entry);
  for (const m of here) seen.add(m);
  if (here.has(CoverCell.KEY) || here.has(CoverCell.GATE)) {
    seen.add(CoverCell.KEY);
    seen.add(CoverCell.GATE);
  }
}

/** 引导关教过的机制 —— 走完引导直接标记为已见。 */
export const TAUGHT_IN_TUTORIAL: number[] = [
  CoverCell.KEY, CoverCell.GATE, CoverCell.ICE, CoverCell.SHARD, CoverCell.PORTAL,
];

/**
 * 生成「已见集合」的本地存储键。
 *
 * ## 为什么不落服务端
 *
 * 这是**纯体验**状态，不影响任何奖励与进度。放服务端要多一次读写、
 * 还要处理"换设备后又被讲一遍"（其实再讲一遍无害）。
 * 本地存一份就够：换设备重看一次说明卡，比为了它加一张表划算。
 */
export const KEY_MECH_SEEN = 'mech_seen';

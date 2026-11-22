/**
 * 主题注册表。
 *
 * ## 现在只有两套 —— 而且是刻意的
 *
 * 目录里曾经挂过十一套。它们不是不能跑，是**判据不过**：
 * 把颜色抽掉只看灰度，认不出是哪一套 —— 那只是换了色板，不是换了世界。
 * 玩家在主题页上划到一套"深蓝版天青"，学到的不是"这个世界还有别的样子"，
 * 而是"这些卡片是凑数的"。所以这一版把没做完的**先全部摘掉**：
 * 主题页上出现的每一套，都是六通道（棋盘 / 机制 / 路径 / 音效 / 动效 / 触感）
 * 整套做完的。
 *
 * | 主题 | 轴 | 换掉了什么 |
 * |---|---|---|
 * | 秘色天青 | 釉面 | 平涂格 → 釉面棋子（暗展柜 + 金缮光迹，默认旗舰） |
 * | 鸣沙丹青 | 矿物颗粒 + 壁画剥蚀 | 暗冷釉面 → 暖土壁上的剥落色块（唯一的亮暖场） |
 *
 * 两套在灰度上四象分明：**釉面光滑 / 壁面颗粒**。一个冷暗、一个暖亮，
 * 摆在同一张海报上也不会认错。
 *
 * 摘掉的文件没有删（`ink.ts` / `kintsugi.ts` / `pixel.ts` / `neon.ts` / `abyss.ts` /
 * `linear.ts` / `gilded.ts`）—— 它们各自守过一条语法轴，重做时是参照。
 * 只要不注册，主题页不会展示、存档里的旧 id 也会被 `themeById` 安全退化掉。
 */
import type { BoardTheme } from './types';
import { MISE_THEME } from './mise';
import { MINGSHA_THEME } from './mingsha';

/** 全部主题（陈列顺序 = 解锁关号递增，玩家看到的就是「一条进阶线」）。 */
export const THEMES: BoardTheme[] = [MISE_THEME, MINGSHA_THEME].sort(
  (a, b) => a.unlock.value - b.unlock.value,
);

/**
 * 本地解锁条件的快照。
 *
 * ## 为什么要有
 *
 * 服务端下发的覆盖是**每次启动**应用的，而 `THEMES` 里的对象是模块级单例 ——
 * 直接把 `theme.unlock` 改掉之后，这个改动会一直留着。
 * 下次收到的配置如果**少了一个主题**（运营删了那行 / 配置回滚到旧版本），
 * 那个主题会保留上一次覆盖的值，而不是回落到客户端常量 ——
 * 表现是「后台已经改回去了，玩家还是解锁不了」。
 *
 * 所以每次应用覆盖前，先把所有主题还原成这里记下的本地值。
 */
const LOCAL_UNLOCK = new Map(THEMES.map((t) => [t.id, { ...t.unlock }]));

/**
 * 应用服务端下发的主题解锁条件。
 *
 * ## 规则
 *
 * - 只覆盖**客户端存在的 id**；服务端多出来的（新主题，客户端还没发版）忽略
 * - 下发的 id 缺失时，该主题保持本地常量 —— 宁可热更不了，也不清空玩家的主题墙
 * - `list` 为空 / undefined 时只做「还原本地」，等于不覆盖
 * - 覆盖后按解锁关号重排：主题页是一条「进阶线」，
 *   顺序不跟着变的话，玩家会看到「免费主题排在 60 关后面」
 *
 * `unlock` 是字符串（服务端 JSON 里没有联合类型），这里做白名单校验。
 */
export function applyThemeUnlocks(
  list?: Array<{ id: string; unlock: string; value: number }>,
): void {
  for (const t of THEMES) {
    const local = LOCAL_UNLOCK.get(t.id);
    if (local) t.unlock = { ...local };
  }

  for (const item of list ?? []) {
    const t = THEMES.find((x) => x.id === item.id);
    if (!t) continue;
    if (item.unlock !== 'free' && item.unlock !== 'ad' && item.unlock !== 'milestone') continue;
    t.unlock = {
      type: item.unlock,
      value: item.unlock === 'milestone' ? Math.max(0, Math.floor(item.value) || 0) : 0,
    };
  }

  // 原地排序：其它模块拿的是同一个数组引用（`THEMES.filter` 之类），
  // 换成新数组的话它们看到的还是旧顺序。
  THEMES.sort((a, b) => a.unlock.value - b.unlock.value);
}

/** 按 id 查找。 */
export function themeById(id: string | undefined): BoardTheme | undefined {
  if (!id) return undefined;
  return THEMES.find((t) => t.id === id);
}

/** 主题 id 是否存在（用于校验本地存的装备值）。 */
export function isThemeId(id: string | undefined): boolean {
  return themeById(id) !== undefined;
}

export type { BoardTheme, ThemeDrawCtx, ThemeState, ThemeTier, ThemeUnlock } from './types';
export { themeUnlocked } from './types';

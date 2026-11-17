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

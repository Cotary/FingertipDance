/**
 * 主题注册表。
 *
 * 九套，**每套只换一条语法轴**——这是它们不像「特效堆」的唯一原因：
 *
 * | 主题 | 轴 | 换掉了什么 |
 * |---|---|---|
 * | 秘色天青 | 釉面 | 平涂格 → 釉面棋子（暗展柜 + 金缮光迹，默认旗舰） |
 * | 水墨山河 | 媒介 | 深色发光 → 亮纸墨块（唯一的浅色盘面） |
 * | 玻璃穹顶 | 材质 | 实心块 → 透光块 |
 * | 金缮瓷盘 | 器物质感 | 发光的格 → 一片片瓷（缝是暗的，走过填金） |
 * | 像素街机 | 分辨率 | 连续边缘 → 硬像素 + 扫描线 |
 * | 圆格罗盘 | 几何 | 方格 → 圆心 |
 * | 赛博霓虹 | 平面 | 有面 → 只有发光框 + 网点 |
 * | 黑曜熔岩 | 光源 | 外照光 → 自发光 |
 * | 金线装饰 | 秩序 | 色块 → 只有线 |
 * | 深海荧光 | 形态 | 直边 → 只有软体（没有一条直边） |
 *
 * 后四套用 `kit.ts` 拼装（流程共享、钩子各异），前三个共用 `linear.ts`
 * （差异靠 `mode` + 规格数据），只有金线是独立实现：
 * 它的规则最严（完全无格面、实体用斜线、线是唯一亮物），
 * 并进通用渲染器会被稀释成「又一个深色主题」。
 *
 * 曾经还有 6 套基础主题（共用「双色棋盘格 + 单色线」句法、只换色板）。
 * 它们被砍掉的原因不是工作量，而是**判据不过**：把颜色抽掉只看灰度，
 * 认不出是哪一套 —— 那只是换了色板，不是换了世界。
 */
import type { BoardTheme } from './types';
import { makeLinearTheme } from './linear';
import { PREMIUM_SPECS } from './premium-specs';
import { drawGildedBackdrop, drawGildedBoard } from './gilded';
import { INK_THEME } from './ink';
import { NEON_THEME } from './neon';
import { PIXEL_THEME } from './pixel';
import { ABYSS_THEME } from './abyss';
import { KINTSUGI_THEME } from './kintsugi';
import { MISE_THEME } from './mise';

/**
 * 金线装饰：独立渲染器（已实测）。
 *
 * 不并进 `linear.ts` 是有意的 —— 见文件头说明。宁可留一份专用实现。
 */
const GILDED: BoardTheme = {
  id: 'gilded',
  name: '金线装饰',
  tagline: '没有格面，只有金线',
  tier: 'premium',
  unlock: { type: 'milestone', value: 900 },
  // 金线的底色与画框都按「可视范围」铺。
  // 它原本写死从 (0,0) 起画 —— 等比缩放后上下会多出几十像素，
  // 不平移的话画框会落在屏幕外，看起来就是「没有边框」。
  backdrop: (ctx, box) => {
    ctx.save();
    ctx.translate(box.x, box.y);
    drawGildedBackdrop(ctx, box.w, box.h);
    ctx.restore();
  },
  // 界面配色：深翡翠 + 金。胶囊和按钮压暗一档，避免和盘面的金线抢亮度
  chrome: {
    pill: '#173A31',
    pillInk: '#F0DFA8',
    primary: '#8A6A18',
    primaryInk: '#FFF3CE',
    ghost: '#21473C',
    ghostInk: '#DCC58A',
    ink: '#EFDFB4',
    inkSoft: 'rgba(220,200,150,0.74)',
    groove: 'rgba(201,162,39,0.18)',
    fill: '#C9A227',
  },
  board: (c) =>
    drawGildedBoard(
      c.ctx,
      // 结构兼容，直接透传
      { w: c.board.w, h: c.board.h, grid: c.board.grid },
      c.layout,
      c.state,
      c.now,
    ),
};

/** 全部主题（陈列顺序 = 解锁关号递增，玩家看到的就是「一条进阶线」）。 */
export const THEMES: BoardTheme[] = [
  MISE_THEME,
  INK_THEME,
  ...PREMIUM_SPECS.map(makeLinearTheme),
  KINTSUGI_THEME,
  PIXEL_THEME,
  NEON_THEME,
  GILDED,
  ABYSS_THEME,
].sort((a, b) => a.unlock.value - b.unlock.value);

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

/**
 * 主题色板。
 * - GAME_THEME：游戏内深色扁平（沿用现有 04-美术规范 的主色板）
 * - LOBBY_THEME：大厅/地图/排行/我的 亮色卡通
 * 全部 UI 都从主题取色，禁止在页面里写死颜色。
 */

/** 主题接口。所有 UI 模块用到的颜色都在这里。 */
export interface Theme {
  /** 页面底色 */
  bg: string;
  /** 次级底色（卡片背板、轨道底） */
  bgLight: string;
  /** 面板/卡片底 */
  panel: string;
  /** 描边 */
  border: string;
  /** 主文本 */
  text: string;
  /** 次文本 */
  subText: string;
  /** 强调色（危险 / 断线） */
  accent: string;
  /** 成功色 */
  success: string;
  /** 主蓝（主按钮） */
  blue: string;
  /** 金（星级 / 里程碑） */
  yellow: string;
  /** 紫（皮肤 / 高级） */
  purple: string;
  /** 卡片投影（rgba 字符串） */
  shadow: string;
}

/** 游戏内深色主题。与 T13 起的既有 ui/hud.ts 的 COLORS 逐值一致，一色不改。 */
export const GAME_THEME: Theme = {
  bg: '#141824',
  bgLight: '#1E2436',
  panel: '#262D42',
  border: '#39415C',
  text: '#E8ECF5',
  subText: '#8A94AD',
  accent: '#E97E6A',
  success: '#5EA94C',
  blue: '#6692F5',
  yellow: '#F2C14E',
  purple: '#9B7BE8',
  shadow: 'rgba(0,0,0,0.35)',
};

/** 大厅亮色卡通主题。 */
export const LOBBY_THEME: Theme = {
  bg: '#EEF3FF',
  bgLight: '#FFFFFF',
  panel: '#FFFFFF',
  border: '#DCE5F7',
  text: '#22304D',
  subText: '#7C8AA6',
  accent: '#FF7A6B',
  success: '#37C07A',
  blue: '#3D7BFF',
  yellow: '#FFC93C',
  purple: '#9B7BE8',
  shadow: 'rgba(34,48,77,0.10)',
};

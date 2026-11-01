/**
 * 设计 token —— 「糖果夜空 / Candy Night」唯一真相源。
 *
 * 全应用只有 **一套** 色板：深蓝紫夜空 + 高饱和糖果色 + 发光的厚圆角果冻块。
 * 大厅与游戏内不再区分明暗主题（旧的双主题正是「风格不一致」的根源），
 * 只在层级上区分：背景 < 玻璃卡片 < 糖果按钮 < 高光/发光。
 *
 * 约束：
 * - 页面里禁止写死颜色，一律从 THEME / CANDY 取
 * - 不引入任何图片 / 字体文件 / SVG 资源，全部 Canvas 2D 程序化绘制
 */

/** 一种糖果色的四个明度层。 */
export interface CandyColor {
  /** 主色（按钮顶面中部） */
  base: string;
  /** 高光（顶面最上） */
  light: string;
  /** 暗部（厚底边 / 阴影） */
  dark: string;
  /** 发光（rgba，用于光晕与外描边） */
  glow: string;
}

/**
 * 糖果色轮。按钮、徽章、图标按语义从这里取，不新造颜色。
 * 每个色都是「亮得起来、暗得下去」的一族，保证厚底边与高光都有色可用。
 */
export const CANDY = {
  blue: { base: '#4FC3F7', light: '#B3E9FF', dark: '#1B78C0', glow: 'rgba(79,195,247,0.45)' },
  green: { base: '#7ED957', light: '#CDF7B0', dark: '#3E9A2A', glow: 'rgba(126,217,87,0.45)' },
  orange: { base: '#FFA940', light: '#FFD79B', dark: '#C96A00', glow: 'rgba(255,169,64,0.45)' },
  pink: { base: '#FF6B9D', light: '#FFBBD2', dark: '#BF2C60', glow: 'rgba(255,107,157,0.45)' },
  purple: { base: '#B388FF', light: '#DCC7FF', dark: '#6B3FCB', glow: 'rgba(179,136,255,0.45)' },
  gold: { base: '#FFD54F', light: '#FFEFB0', dark: '#C99400', glow: 'rgba(255,213,79,0.45)' },
  coral: { base: '#FF6B6B', light: '#FFB5B5', dark: '#BE2F2F', glow: 'rgba(255,107,107,0.45)' },
} as const satisfies Record<string, CandyColor>;

/** 糖果色键名。 */
export type CandyKey = keyof typeof CANDY;

/**
 * 主题色板。
 * 键名沿用 T13 起的既有命名，避免 16 个引用文件全部改签名；
 * 但语义已统一到夜空体系（bg 不再分亮/暗两套）。
 */
export interface Theme {
  /** 夜空主色（中间调，山影之上的主体） */
  bg: string;
  /** 夜空底部（山影） */
  bgLight: string;
  /** 玻璃卡片底 */
  panel: string;
  /** 描边（半透明白，压在任何底色上都成立） */
  border: string;
  /** 主文本 */
  text: string;
  /** 次文本 */
  subText: string;
  /** 危险 / 断线 */
  accent: string;
  /** 成功 */
  success: string;
  /** 主蓝（主按钮） */
  blue: string;
  /** 金（星级 / 里程碑） */
  yellow: string;
  /** 紫（皮肤 / 高级） */
  purple: string;
  /** 投影 */
  shadow: string;
  /** 夜空渐变顶 */
  skyTop: string;
  /** 夜空渐变中 */
  skyMid: string;
  /** 夜空渐变底 */
  skyBottom: string;
  /** 山影剪影 */
  ridge: string;
  /** 玻璃卡片的填充 */
  glass: string;
  /** 玻璃卡片的边光 */
  glassEdge: string;
}

/** 「糖果夜空」色板。全应用唯一。 */
export const THEME: Theme = {
  bg: '#1B1252',
  bgLight: '#0B0824',
  panel: '#2A2270',
  border: 'rgba(255,255,255,0.20)',
  text: '#FFFFFF',
  subText: '#A9A6E0',
  accent: '#FF6B6B',
  success: '#7ED957',
  blue: '#4FC3F7',
  yellow: '#FFD54F',
  purple: '#B388FF',
  shadow: 'rgba(6,3,26,0.45)',
  skyTop: '#2E2078',
  skyMid: '#1B1252',
  skyBottom: '#0B0824',
  ridge: '#120C3A',
  glass: 'rgba(255,255,255,0.09)',
  glassEdge: 'rgba(255,255,255,0.20)',
};

/**
 * 兼容别名。
 * T23 曾用 GAME_THEME（深色）与 LOBBY_THEME（亮色）两套，视觉割裂；
 * 现统一为 THEME，两个名字都指向同一个对象，让既有 import 无需改动即可变统一。
 */
export const GAME_THEME: Theme = THEME;
export const LOBBY_THEME: Theme = THEME;

/** 圆角 token。所有卡片/按钮只允许用这几档，保证节奏一致。 */
export const R = {
  /** 小：徽章、图标底 */
  sm: 16,
  /** 中：列表行、小卡片 */
  md: 24,
  /** 大：主卡片、面板 */
  lg: 32,
  /** 特大：大按钮、弹窗 */
  xl: 44,
} as const;

/** 间距 token（8pt 基准）。 */
export const SP = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

/** 字重。卡通风格靠粗字撑骨架，标题一律 800。 */
export const W = {
  regular: 500,
  mid: 600,
  bold: 800,
} as const;

/** 字体栈：只用系统字体，微信端零成本。 */
export const FONT_STACK = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

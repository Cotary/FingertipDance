/**
 * 设计 token —— 「秘色·天青 / Mise Celadon」唯一真相源。
 *
 * 全应用只有 **一套** 色板：墨石暗底 + 青瓷玉色 + 鎏金 CTA + 朱砂点睛。
 * 层级：背景 < 石卡 < 金按钮 < 高光/光迹。
 *
 * 约束：
 * - 页面里禁止写死颜色，一律从 THEME / CANDY 取
 * - 不引入任何图片 / 字体文件 / SVG 资源，全部 Canvas 2D 程序化绘制
 * - 金色覆盖 ≤8%：金只给 CTA 和光迹，不做装饰
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
 * 色轮（天青语义）。按钮、徽章、图标按语义从这里取，不新造颜色。
 * 每个色都是「亮得起来、暗得下去」的一族，保证厚底边与高光都有色可用。
 */
export const CANDY = {
  blue: { base: '#6E9E82', light: '#A8C8B2', dark: '#4A7260', glow: 'rgba(110,158,130,0.45)' },
  green: { base: '#4A7260', light: '#7FA892', dark: '#2D5245', glow: 'rgba(74,114,96,0.45)' },
  orange: { base: '#C9A227', light: '#F2DCA8', dark: '#8A6B3C', glow: 'rgba(201,162,39,0.45)' },
  pink: { base: '#C04B33', light: '#D9705A', dark: '#8E3424', glow: 'rgba(192,75,51,0.45)' },
  purple: { base: '#7A6FA8', light: '#B8AED8', dark: '#524878', glow: 'rgba(122,111,168,0.45)' },
  gold: { base: '#E0B33C', light: '#F4D278', dark: '#AE861F', glow: 'rgba(224,179,60,0.45)' },
  coral: { base: '#D9705A', light: '#F0A896', dark: '#A74434', glow: 'rgba(217,112,90,0.45)' },
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

/** 「秘色天青」色板。全应用唯一。 */
export const THEME: Theme = {
  bg: '#0C1310',
  bgLight: '#060A08',
  panel: '#1E3229',
  border: 'rgba(197,191,175,0.14)',
  text: '#EDE7DA',
  subText: '#A39B86',
  accent: '#C04B33',
  success: '#6E9E82',
  blue: '#8A6B3C',
  yellow: '#E0B33C',
  purple: '#7A6FA8',
  shadow: 'rgba(3,6,5,0.50)',
  skyTop: '#14211B',
  skyMid: '#0C1310',
  skyBottom: '#060A08',
  ridge: '#0E1713',
  glass: 'rgba(237,231,218,0.06)',
  glassEdge: 'rgba(237,231,218,0.14)',
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

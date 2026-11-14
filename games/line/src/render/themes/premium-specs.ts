/**
 * 三套典藏主题的规格数据。
 *
 * 每套只占**一条轴**（材质 / 几何 / 光源），这是它们不像特效堆的唯一原因。
 * 解锁走里程碑，不放广告 —— 看广告解锁的东西不配叫典藏。
 */
import type { LinearSpec } from './linear';
import type { ThemeChrome } from './types';

/** 界面配色：和盘面同一族，但压暗一档 —— 胶囊/按钮是「器件」，不该和盘面抢亮度。 */
const GLASS_CHROME: ThemeChrome = {
  pill: '#2C4A6E', pillInk: '#EAF4FF',
  primary: '#3E6FA8', primaryInk: '#F4FAFF',
  ghost: '#2C4A6A', ghostInk: '#E2EFFC',
  ink: '#EAF3FF', inkSoft: 'rgba(214,232,250,0.74)',
  groove: 'rgba(160,200,240,0.22)', fill: '#9CC8F0',
};

const ORBIT_CHROME: ThemeChrome = {
  pill: '#1B3560', pillInk: '#E6F0FF',
  primary: '#3A63A8', primaryInk: '#F2F7FF',
  ghost: '#22406C', ghostInk: '#DCEAFF',
  ink: '#E2EEFF', inkSoft: 'rgba(198,218,255,0.72)',
  groove: 'rgba(130,170,230,0.20)', fill: '#6EA8FF',
};

const OBSIDIAN_CHROME: ThemeChrome = {
  pill: '#33170F', pillInk: '#FFE3C8',
  primary: '#B8431A', primaryInk: '#FFF0E0',
  ghost: '#3C231A', ghostInk: '#FFD9B8',
  ink: '#FFE6D2', inkSoft: 'rgba(255,196,160,0.74)',
  groove: 'rgba(255,120,60,0.18)', fill: '#FF6B2C',
};

export const PREMIUM_SPECS: LinearSpec[] = [
  // ── 玻璃穹顶 · 材质轴 ──
  {
    id: 'glass',
    name: '玻璃穹顶',
    tagline: '厚玻璃叠在一起，一道斜光带横穿',
    tier: 'premium',
    unlock: { type: 'milestone', value: 200 },
    mode: 'glass',
    bg: { base: '#101A2B', deep: '#050B16', accent: 'rgba(200,230,255,0.10)' },
    plate: { fill: 'rgba(20,34,54,0.78)', edge: 'rgba(180,220,255,0.26)' },
    // 半透明格：明暗差只能靠「上缘亮线 + 留缝」，不能靠填充色 —— 一填满就不是玻璃
    cell: { fill: 'rgba(150,190,230,0.10)', edge: 'rgba(190,225,255,0.22)', radius: 0.22, gap: 0.07 },
    walk: { fill: 'rgba(228,244,255,0.55)', edge: 'rgba(255,255,255,0.95)', glow: '' },
    trail: { halo: 'rgba(120,180,230,0.30)', core: '#DCEBFF', hot: '#FFFFFF' },
    icon: {
      style: 'ice',
      ink: '#DCEEFF',
      accent: 'rgba(200,235,255,0.55)',
      chip: '#FFFFFF',
      deep: '#0A1826',
      back: 'rgba(10,24,38,0.62)',
      backEdge: 'rgba(190,225,255,0.32)',
    },
    hint: '#FFE9A8',
    marker: '#FFFFFF',
    chrome: GLASS_CHROME,
  },

  // ── 圆格罗盘 · 几何轴 ──
  {
    id: 'orbit',
    name: '圆格罗盘',
    tagline: '缎带穿过圆心，像珠子穿在绳上',
    tier: 'premium',
    unlock: { type: 'milestone', value: 400 },
    mode: 'orbit',
    bg: { base: '#0A1626', deep: '#04080F', accent: 'rgba(110,168,255,0.09)' },
    plate: { fill: '#101F33', edge: 'rgba(110,168,255,0.24)' },
    cell: { fill: 'transparent', edge: 'rgba(140,180,240,0.24)', radius: 0.5, gap: 0 },
    walk: { fill: 'rgba(56,104,186,0.50)', edge: 'rgba(150,196,255,0.88)', glow: '' },
    trail: { halo: 'rgba(16,34,60,0.88)', core: '#6EA8FF', hot: '#EAF3FF' },
    icon: {
      style: 'constellation',
      ink: '#B4CFFF',
      accent: '#6EA8FF',
      chip: '#EAF3FF',
      deep: '#08111E',
      back: '',
      backEdge: 'transparent',
    },
    hint: '#FFE9A8',
    marker: '#EAF3FF',
    chrome: ORBIT_CHROME,
  },

  // ── 黑曜熔岩 · 光源轴 ──
  {
    id: 'obsidian',
    name: '黑曜熔岩',
    tagline: '黑暗里只有走过的路在燃烧',
    tier: 'premium',
    unlock: { type: 'milestone', value: 700 },
    mode: 'burn',
    bg: { base: '#0B0A0C', deep: '#040304', accent: 'rgba(255,120,60,0.07)' },
    plate: { fill: '#151012', edge: 'rgba(255,92,26,0.20)' },
    cell: { fill: '#1F1719', edge: 'rgba(255,130,70,0.20)', radius: 0.14, gap: 0.05 },
    walk: { fill: 'rgba(255,92,26,0.40)', edge: 'rgba(255,190,120,0.90)', glow: 'rgba(255,92,26,0.16)' },
    trail: { halo: 'rgba(255,60,10,0.18)', core: '#FF6B2C', hot: '#FFB067' },
    icon: {
      style: 'seal',
      ink: '#1A0C06',
      accent: '#FF7A3C',
      chip: '#FFE6C8',
      deep: '#100806',
      back: '',
      backEdge: 'transparent',
    },
    hint: '#FFC27A',
    marker: '#FFF0D0',
    chrome: OBSIDIAN_CHROME,
  },
];

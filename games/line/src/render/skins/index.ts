/**
 * 皮肤工厂：皮肤清单 + 调色板 + 纹理绘制。
 * `Skin` 接口是皮肤的唯一真相源（`src/ui/skins.ts` 皮肤页从此导入）。
 */
import {
  texNone, texWood, texMarble, texBrushed, texIce, texNeon, texGold, texStardust, texGalaxy,
  type TextureCtx,
} from './textures';

/** 皮肤档位。 */
export type SkinTier = 'free' | 'normal' | 'premium';

/** 解锁方式。 */
export type UnlockType = 'default' | 'level' | 'ad' | 'milestone';

/** 纹理类型。 */
export type TextureType =
  | 'none' | 'marble' | 'brushed' | 'ice' | 'neon'
  | 'wood' | 'gold' | 'stardust' | 'galaxy';

/** 皮肤定义。 */
export interface Skin {
  id: string;
  name: string;
  tier: SkinTier;
  unlockType: UnlockType;
  unlockValue: number;
  hue: number;
  sat: number;
  light: number;
  texture: TextureType;
}

/** 皮肤清单。必须覆盖四种解锁方式。 */
export const SKINS: Skin[] = [
  { id: 'wood', name: '原木', tier: 'free', unlockType: 'default', unlockValue: 0, hue: 28, sat: 45, light: 48, texture: 'wood' },
  { id: 'mint', name: '薄荷', tier: 'free', unlockType: 'default', unlockValue: 0, hue: 160, sat: 42, light: 52, texture: 'none' },
  { id: 'graphite', name: '石墨', tier: 'normal', unlockType: 'level', unlockValue: 3, hue: 220, sat: 12, light: 40, texture: 'none' },
  { id: 'slate', name: '青岩', tier: 'normal', unlockType: 'level', unlockValue: 8, hue: 200, sat: 22, light: 46, texture: 'none' },
  { id: 'blush', name: '藕粉', tier: 'normal', unlockType: 'level', unlockValue: 15, hue: 340, sat: 48, light: 62, texture: 'none' },
  { id: 'amber', name: '琥珀', tier: 'normal', unlockType: 'level', unlockValue: 25, hue: 42, sat: 72, light: 55, texture: 'none' },
  { id: 'marble', name: '大理石', tier: 'normal', unlockType: 'level', unlockValue: 40, hue: 40, sat: 15, light: 72, texture: 'marble' },
  { id: 'brushed', name: '金属拉丝', tier: 'normal', unlockType: 'level', unlockValue: 60, hue: 210, sat: 18, light: 58, texture: 'brushed' },
  { id: 'ice', name: '冰晶', tier: 'normal', unlockType: 'level', unlockValue: 90, hue: 190, sat: 55, light: 68, texture: 'ice' },
  { id: 'neon', name: '霓虹', tier: 'normal', unlockType: 'level', unlockValue: 130, hue: 285, sat: 85, light: 60, texture: 'neon' },
  { id: 'gold', name: '黄金', tier: 'premium', unlockType: 'milestone', unlockValue: 200, hue: 45, sat: 80, light: 55, texture: 'gold' },
  { id: 'stardust', name: '星尘', tier: 'premium', unlockType: 'milestone', unlockValue: 500, hue: 265, sat: 60, light: 45, texture: 'stardust' },
  { id: 'galaxy', name: '星河', tier: 'premium', unlockType: 'milestone', unlockValue: 900, hue: 255, sat: 65, light: 40, texture: 'galaxy' },
  { id: 'ad_rose', name: '玫瑰', tier: 'normal', unlockType: 'ad', unlockValue: 0, hue: 345, sat: 62, light: 58, texture: 'none' },
  { id: 'ad_ocean', name: '深海', tier: 'normal', unlockType: 'ad', unlockValue: 0, hue: 205, sat: 68, light: 42, texture: 'none' },
  { id: 'ad_ember', name: '余烬', tier: 'normal', unlockType: 'ad', unlockValue: 0, hue: 18, sat: 70, light: 50, texture: 'none' },
];

/** 按 id 查找皮肤，找不到返回默认皮肤（第一个）。 */
export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** 由 HSL 生成的派生调色板。 */
export interface SkinPalette {
  base: string;
  light: string;
  dark: string;
  border: string;
  glow: string;
}

/** 根据皮肤生成调色板。 */
export function paletteOf(skin: Skin): SkinPalette {
  const { hue, sat, light } = skin;
  return {
    base: `hsl(${hue}, ${sat}%, ${light}%)`,
    light: `hsl(${hue}, ${sat}%, ${Math.min(95, light + 22)}%)`,
    dark: `hsl(${hue}, ${sat}%, ${Math.max(8, light - 22)}%)`,
    border: `hsl(${hue}, ${Math.min(100, sat + 10)}%, ${Math.max(10, light - 32)}%)`,
    glow: `hsl(${hue}, ${Math.min(100, sat + 15)}%, ${Math.min(85, light + 30)}%)`,
  };
}

/** 确定性伪随机（同一格每次渲染一致）。 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 在指定矩形内绘制皮肤纹理。
 */
export function paintSkin(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = 1,
  timeMs = 0,
): void {
  const p = paletteOf(skin);
  const t: TextureCtx = { ctx, x, y, w, h, rand: makeRand(seed * 2654435761) };
  switch (skin.texture) {
    case 'none': texNone(t, p.base, p.light); break;
    case 'wood': texWood(t, p.base, p.dark); break;
    case 'marble': texMarble(t, p.base, p.border); break;
    case 'brushed': texBrushed(t, p.base, p.dark); break;
    case 'ice': texIce(t, p.base, p.light); break;
    case 'neon': texNeon(t, p.base, p.glow); break;
    case 'gold': texGold(t, p.base, p.light, p.dark); break;
    case 'stardust': texStardust(t, p.base, p.light, timeMs); break;
    case 'galaxy': texGalaxy(t, p.base, p.glow, p.dark, timeMs); break;
  }
}

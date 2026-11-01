/**
 * 皮肤定义（与 04-美术规范.md 一致）。T16 会填满，先留接口。
 */

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

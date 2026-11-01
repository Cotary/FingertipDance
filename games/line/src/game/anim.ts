/** 缓动函数集。输入 t ∈ [0,1]，输出缓动后的进度。 */
export const Ease = {
  /** 二次缓出。 */
  outQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  /** 三次缓出。 */
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  /** 二次缓入。 */
  inQuad: (t: number): number => t * t,
  /** 弹性缓出。 */
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  /** 阻尼正弦（用于抖动）。 */
  damped: (t: number, freq = 6): number => Math.sin(t * Math.PI * freq) * (1 - t),
};

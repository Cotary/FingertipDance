/**
 * 音效合成器。不使用音频文件，全部用 WebAudio 生成。
 * 微信端无 WebAudio → 由 platform.vibrate() 兜底。
 */

/**
 * 音效合成器。惰性创建 AudioContext（必须在用户手势后调用）。
 */
export class Audio {
  private ctx: AudioContext | null = null;

  /** 惰性创建 AudioContext。 */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      // 浏览器环境才有 window / AudioContext；微信端 window 未定义 → 走 catch 返回 null
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!Ctor) return null;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** 播放一个音。 */
  private tone(freq: number, durationMs: number, type: OscillatorType, volume: number, delayMs = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + delayMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.02);
  }

  /** 点亮砖块。 */
  light(): void { this.tone(880, 30, 'square', 0.15); }

  /** 断线。 */
  break(): void {
    this.tone(220, 120, 'square', 0.18);
    this.tone(200, 60, 'square', 0.12, 40);
  }

  /** 通关琶音（C-E-G）。 */
  win(): void {
    this.tone(523, 100, 'triangle', 0.2, 0);
    this.tone(659, 100, 'triangle', 0.2, 100);
    this.tone(784, 180, 'triangle', 0.22, 200);
  }

  /** 解锁皮肤。 */
  unlock(): void {
    this.tone(1046, 150, 'sine', 0.18, 0);
    this.tone(1568, 200, 'sine', 0.2, 120);
  }
}

/** 全局单例。 */
export const audio = new Audio();

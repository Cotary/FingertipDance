/**
 * 特效系统：粒子迸发、位置扩散环。不要求确定性，可直接使用 Math.random()。
 * （`core/` 层才是硬性要求，特效层不受限。）
 */

/** 粒子。 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

/** 位置迸发（渲染时已算出屏幕坐标）。 */
interface Burst {
  x: number;
  y: number;
  at: number;
  color: string;
}

/**
 * 特效系统。管理粒子与扩散环。
 */
export class Fx {
  private particles: Particle[] = [];
  private bursts: Burst[] = [];

  /**
   * 在指定屏幕坐标生成粒子迸发。
   */
  burst(x: number, y: number, color: string, count = 16): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 120 + Math.random() * 180;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 500 + Math.random() * 300,
        size: 3 + Math.random() * 4,
        color,
      });
    }
  }

  /**
   * 按格子索引记录一次扩散环迸发（延迟到渲染时再取坐标）。
   */
  burstAt(idx: number, w: number, cell: number, originX: number, originY: number, color: string): void {
    this.bursts.push({
      x: originX + (idx % w) * cell + cell / 2,
      y: originY + Math.floor(idx / w) * cell + cell / 2,
      at: Date.now(),
      color,
    });
  }

  /**
   * 更新并绘制所有特效。
   * @param dt 距上次更新的毫秒数
   */
  update(ctx: CanvasRenderingContext2D, dt: number): void {
    const now = Date.now();

    // 更新粒子（重力 + 位移 + 生命周期）
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vy += 400 * (dt / 1000); // 重力
    }

    // 绘制粒子
    ctx.save();
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 绘制扩散环
    ctx.save();
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      const elapsed = now - b.at;
      if (elapsed > 600) { this.bursts.splice(i, 1); continue; }
      const r = (elapsed / 600) * 60;
      ctx.globalAlpha = 1 - elapsed / 600;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 当前是否还有活跃特效。 */
  get active(): boolean {
    return this.particles.length > 0 || this.bursts.length > 0;
  }

  /** 清空所有特效。 */
  clear(): void {
    this.particles = [];
    this.bursts = [];
  }
}

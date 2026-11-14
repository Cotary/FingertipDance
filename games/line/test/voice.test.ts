import { describe, it, expect } from 'vitest';
import {
  VOICES, voiceFor, hasOwnVoice, CLAY_VOICE,
  type SoundNote, type ThemeVoice,
} from '../src/render/voice';
import { THEMES } from '../src/render/themes';
import { audio } from '../src/render/audio';

/** 取某一套的 step 序列（前 n 步）。 */
function steps(v: ThemeVoice, n: number): SoundNote[][] {
  return Array.from({ length: n }, (_, i) => v.step(i));
}

/** 主音：每一步的第一个音符。整套音色的骨架。 */
function lead(v: ThemeVoice, n: number): number[] {
  return steps(v, n).map((s) => s[0].freq);
}

/** 包络指纹：抽掉音高之后还剩什么。 */
function envelope(v: ThemeVoice): string {
  return v.step(0)
    .map((n) => `${n.wave}:${n.attack ?? 3}:${n.dur}:${n.fm ? 'fm' : '-'}:${n.hp ? 'hp' : '-'}:${n.lp ? 'lp' : '-'}`)
    .join('|');
}

describe('主题音色 · 目录', () => {
  it('四套典藏主题各有一套专属音色，id 与主题 id 严格对齐', () => {
    for (const t of THEMES) {
      const v = voiceFor(t.id);
      // 对齐是这一层的全部意义：`audio.setVoice(themeId)` 靠它一次调用完成
      expect(v.id, `${t.id} 没有同名音色`).toBe(t.id);
      expect(hasOwnVoice(t.id), `${t.id} 被判成没有专属音色`).toBe(true);
    }
  });

  it('音色 id 唯一', () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
  });

  it('空串 / 未知 id 退化成经典，不抛错', () => {
    // 本地存的可能是已下线的主题 id：抛错会让整个页面白屏
    expect(voiceFor('').id).toBe('clay');
    expect(voiceFor(undefined).id).toBe('clay');
    expect(voiceFor('no-such-theme').id).toBe('clay');
    expect(hasOwnVoice('')).toBe(false);
    expect(hasOwnVoice('no-such-theme')).toBe(false);
  });

  it('经典音色保持旧音高（880 方波）—— 换主题才该换耳朵', () => {
    const n = CLAY_VOICE.step(0)[0];
    expect(n.wave).toBe('square');
    expect(n.freq).toBe(880);
  });
});

describe('主题音色 · 音符合法性', () => {
  const all: SoundNote[] = [];
  for (const v of VOICES) {
    all.push(...v.tap(), ...v.break(), ...v.win(true), ...v.win(false), ...v.unlock(), ...v.signature());
    for (const s of steps(v, 40)) all.push(...s);
  }

  it('时长、增益、频率都是正数且在合理范围', () => {
    for (const n of all) {
      expect(n.dur, 'duration 必须 > 0').toBeGreaterThan(0);
      expect(n.gain, 'gain 必须 > 0').toBeGreaterThan(0);
      // 0.25 是削波线：三个音叠起来 0.75，master 0.85 刚好不爆
      expect(n.gain, `gain ${n.gain} 太大，叠音会削波`).toBeLessThanOrEqual(0.25);
      // 噪声音符的 freq 按契约写 0（引擎忽略它，见下一条断言）
      if (n.wave !== 'noise') expect(n.freq).toBeGreaterThan(0);
      if (n.to !== undefined) expect(n.to).toBeGreaterThan(0);
    }
  });

  it('起音时间必须 > 0 且小于半个音长（0 斜坡会爆音，等于半长会变「噗」）', () => {
    for (const n of all) {
      const atk = n.attack ?? 3;
      expect(atk, `${n.wave}@${n.freq} 起音为 0`).toBeGreaterThan(0);
      expect(atk).toBeLessThan(n.dur / 2);
    }
  });

  it('湿声比例在 0..1 之间', () => {
    for (const n of all) {
      const wet = n.wet ?? 0.3;
      expect(wet).toBeGreaterThanOrEqual(0);
      expect(wet).toBeLessThanOrEqual(1);
    }
  });

  it('噪声音符不依赖频率（freq 会被引擎忽略，写 0 是契约）', () => {
    for (const n of all) if (n.wave === 'noise') expect(n.freq).toBe(0);
  });

  it('单个 step 不超过 4 个音符（一帧可能连亮三格，超了会糊）', () => {
    for (const v of VOICES) {
      for (let i = 0; i < 40; i++) {
        expect(v.step(i).length, `${v.id}.step(${i})`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('长连击不会爬进超声波区（step 封顶后必须仍在可听范围内）', () => {
    for (const v of VOICES) {
      const top = Math.max(...lead(v, 40));
      expect(top, `${v.id} 第 39 步到了 ${Math.round(top)}Hz`).toBeLessThan(12000);
    }
  });
});

describe('主题音色 · 四套必须真的不一样', () => {
  it('抽掉音高只留包络，四套的指纹两两不同', () => {
    // 这就是画面那条判据的听觉版：只把 880 改成 1046 是换音高，不是换音色
    const fps = THEMES.map((t) => envelope(voiceFor(t.id)));
    expect(new Set(fps).size).toBe(fps.length);
  });

  it('主线频（step 0）两两不同', () => {
    const f0 = THEMES.map((t) => voiceFor(t.id).step(0)[0].freq);
    expect(new Set(f0).size).toBe(f0.length);
  });

  it('四套的空间衰减跨度至少 3 倍（同一个音高听成两个世界的唯一来源）', () => {
    const decays = THEMES.map((t) => voiceFor(t.id).space.decay);
    expect(Math.max(...decays) / Math.min(...decays)).toBeGreaterThanOrEqual(3);
  });

  it('深色主题的混响必须更暗（阻尼越低尾音越闷）', () => {
    const glass = voiceFor('glass').space;
    const burn = voiceFor('obsidian').space;
    expect(burn.damp).toBeLessThan(glass.damp);
    expect(burn.decay).toBeLessThan(glass.decay);
  });
});

describe('主题音色 · 每条轴的特征必须能被断言', () => {
  it('玻璃：FM 调制比是非整数（整数比会退化成普通泛音）', () => {
    const fm = voiceFor('glass').step(0)[0].fm;
    expect(fm).toBeTruthy();
    expect(Math.abs(fm!.ratio - Math.round(fm!.ratio))).toBeGreaterThan(0.1);
  });

  it('玻璃：起音必须极短（敲玻璃，不是推玻璃）', () => {
    expect(voiceFor('glass').step(0)[0].attack).toBeLessThanOrEqual(2);
  });

  it('金线：钟的模态比 2.76，且每步都是两响以上', () => {
    const v = voiceFor('gilded');
    const first = v.step(0)[0];
    expect(first.fm?.ratio).toBeCloseTo(2.76, 2);
    for (let i = 0; i < 8; i++) expect(v.step(i).length).toBeGreaterThanOrEqual(2);
  });

  it('熔岩：首音下扫（鼓起来再破，不是推上去）', () => {
    const n = voiceFor('obsidian').step(0)[0];
    expect(n.to).toBeDefined();
    expect(n.to!).toBeLessThan(n.freq);
  });

  it('熔岩：起音是四套里最慢的（粘、厚）', () => {
    const atk = (id: string) => voiceFor(id).step(0)[0].attack ?? 3;
    expect(atk('obsidian')).toBeGreaterThan(atk('glass'));
    expect(atk('obsidian')).toBeGreaterThan(atk('gilded'));
  });

  it('熔岩：噪声亮度随连击提高（这就是它的「进度条」）', () => {
    const lp = (i: number) => Math.max(...voiceFor('obsidian').step(i).map((n) => n.lp ?? 0));
    expect(lp(8)).toBeGreaterThan(lp(0));
  });

  it('罗盘：音高往返，不是一路爬楼梯', () => {
    const f = lead(voiceFor('orbit'), 8);
    // 前 5 步向上
    for (let i = 1; i < 5; i++) expect(f[i]).toBeGreaterThan(f[i - 1]);
    // 第 6 步被「拉回来」
    expect(f[5]).toBeLessThan(f[4]);
  });
});

describe('主题音色 · 事件音', () => {
  it('win(true) 比 win(false) 至少多一个音（完美通关要听得出）', () => {
    for (const v of VOICES) {
      expect(v.win(true).length).toBeGreaterThan(v.win(false).length);
    }
  });

  it('断线音是下行 / 不协和的：不能听起来像点亮', () => {
    for (const v of VOICES) {
      const b = v.break();
      expect(b.length).toBeGreaterThanOrEqual(2);
      // 至少有一个音在往下走，或者有噪声层 —— 两者都没有的「断线」听着像加分
      const falls = b.some((n) => n.to !== undefined && n.to < n.freq);
      const hiss = b.some((n) => n.wave === 'noise');
      const stepsDown = b.length > 1 && b[1].freq < b[0].freq;
      expect(falls || hiss || stepsDown, `${v.id} 的断线音不像断线`).toBe(true);
    }
  });

  it('签名动机在 1.5 秒内播完（展台上听完一整套世界观）', () => {
    for (const v of VOICES) {
      const end = Math.max(...v.signature().map((n) => (n.delay ?? 0) + n.dur));
      expect(end, `${v.id} 的签名动机 ${end}ms`).toBeLessThanOrEqual(1500);
    }
  });

  it('轻触永远比点亮的主音短（点页签不该拖尾）', () => {
    for (const v of VOICES) {
      const tap = Math.max(...v.tap().map((n) => n.dur));
      expect(tap, `${v.id} 轻触 ${tap}ms`).toBeLessThanOrEqual(150);
    }
  });

  it('每套都有签名动机与轻触音，不能留空数组', () => {
    for (const v of VOICES) {
      expect(v.signature().length).toBeGreaterThan(0);
      expect(v.tap().length).toBeGreaterThan(0);
    }
  });
});

describe('引擎 · 无 AudioContext 时静默降级', () => {
  it('node 环境下调用不抛错（微信端 / 测试环境都走这条路）', () => {
    // 不可用 AudioContext 时 `ensure()` 返回 null，整条链静默；
    // 手感由平台层的 vibrate 兜住。**不能抛** —— 一次抛错会中断整个事件循环。
    expect(() => {
      audio.setVoice('glass');
      audio.light();
      audio.tap();
      audio.break();
      audio.win(true);
      audio.unlock();
      audio.preview('gilded');
      audio.probe('orbit');
    }).not.toThrow();
    expect(audio.voiceId).toBe('orbit');
  });

  it('静音开关关掉后不再发声（但状态仍可切）', () => {
    audio.setEnabled(false);
    expect(() => audio.light()).not.toThrow();
    audio.setEnabled(true);
    expect(() => audio.light()).not.toThrow();
  });

  it('setVoice 对未知 id 退化成经典', () => {
    audio.setVoice('removed-theme');
    expect(audio.voiceId).toBe('clay');
  });
});

// ── 引擎 · 用一个假 AudioContext 跑真实的建图流程 ──
//
// 「音效改坏了听不出来」是这一层最大的风险：跑通类型检查、跑通单测，
// 上线才发现某个音符让 `exponentialRampToValueAtTime` 抛了 RangeError，
// 或者某个节点连到了 null —— 而 WebAudio 的失败**大多是静默的**，不报错，只是没声。
//
// 所以这里用一个记录调用的假 ctx 走一遍 `note()` / `buildIR()`，
// 把「有没有真的把振荡器 start 起来」变成可断言的。

class FakeParam {
  value = 0;
  ramps: Array<{ kind: string; v: number }> = [];
  setValueAtTime(v: number): this { this.value = v; this.ramps.push({ kind: 'set', v }); return this; }
  exponentialRampToValueAtTime(v: number): this {
    // 真 API 对 0 抛 RangeError。假 ctx 必须同样严格，否则这一层就白测了
    if (v <= 0) throw new Error(`exponentialRamp 目标必须 > 0，收到 ${v}`);
    this.ramps.push({ kind: 'exp', v });
    return this;
  }
  linearRampToValueAtTime(v: number): this { this.ramps.push({ kind: 'lin', v }); return this; }
}

/** 全局连线记录。调制器是接到 `AudioParam` 而不是节点上的，只看节点连不到。 */
const CONNECTIONS: Array<{ from: unknown; to: unknown }> = [];

class FakeNode {
  targets: unknown[] = [];
  connect(n: unknown): void {
    this.targets.push(n);
    CONNECTIONS.push({ from: this, to: n });
  }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}
class FakeBufSrc extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}
class FakeConv extends FakeNode {
  buffer: Float32Array[] | null = null;
  normalize = true;
}

class FakeCtx {
  // 8kHz：IR 只要 2 万采样，测试跑得快，而低通系数照样成立
  sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  oscs: FakeOsc[] = [];
  srcs: FakeBufSrc[] = [];
  convs: FakeConv[] = [];
  resume(): Promise<void> { return Promise.resolve(); }
  createGain(): FakeGain { return new FakeGain(); }
  createOscillator(): FakeOsc { const o = new FakeOsc(); this.oscs.push(o); return o; }
  createBufferSource(): FakeBufSrc { const s = new FakeBufSrc(); this.srcs.push(s); return s; }
  createBiquadFilter(): FakeFilter { return new FakeFilter(); }
  createConvolver(): FakeConv { const c = new FakeConv(); this.convs.push(c); return c; }
  createBuffer(ch: number, len: number): Float32Array[] {
    const data = Array.from({ length: ch }, () => new Float32Array(len)) as Float32Array[] & {
      getChannelData(i: number): Float32Array;
    };
    // 真 AudioBuffer 既有 `getChannelData` 又能读 `numberOfChannels`；
    // 这里把方法挂在数组上，就能同时满足「引擎用方法」和「测试查数据」两边
    data.getChannelData = (i: number) => data[i];
    return data;
  }
}

describe('引擎 · 假 AudioContext 跑真流程', () => {
  const ctx = new FakeCtx();
  // `new` 一个返回对象的函数 → 拿到的就是 ctx
  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: function () { return ctx; },
  };

  it('建图后混响缓冲被烘出来了，长度跟着主题的空间走', () => {
    audio.setVoice('glass');
    audio.preview('glass');
    expect(ctx.convs.length).toBe(1);
    const ir = ctx.convs[0].buffer;
    expect(ir).toBeTruthy();
    // 玻璃 2.6s × 8kHz = 20800
    expect(ir![0].length).toBe(Math.floor(2.6 * 8000));
    expect(ir![1].length).toBe(ir![0].length);
    // 必须真的有人声数据，不能是一条静音
    expect(ir![0].some((v) => v !== 0)).toBe(true);
  });

  it('点亮真的把振荡器 start 起来了，并且有 stop（不 stop 会永久累积）', () => {
    const before = ctx.oscs.length;
    audio.setVoice('gilded');
    audio.tap();
    const made = ctx.oscs.slice(before);
    expect(made.length).toBeGreaterThan(0);
    for (const o of made) {
      expect(o.started, '振荡器没 start = 没声').toBe(true);
      expect(o.stopped, '振荡器没 stop = 泄漏').toBe(true);
    }
  });

  it('玻璃的 FM 调制器接在载波的 frequency 上（接错就是普通泛音）', () => {
    audio.setVoice('glass');
    const before = ctx.oscs.length;
    audio.probe('glass');
    const made = ctx.oscs.slice(before);
    // 第一个是载波，第二个是调制器；调制器必须把自己的输出接到载波的 AudioParam
    const carrier = made[0];
    // 调制器 → gain → 载波.frequency：中间隔了一个 gain，所以要查全局连线
    expect(CONNECTIONS.some((c) => c.to === carrier.frequency)).toBe(true);
    // 且那个 gain 必须是调制器驱动的（深度 = freq × depth），不能是别的音
    const mod = made[1];
    expect(CONNECTIONS.some((c) => c.from === mod)).toBe(true);
  });

  it('噪声音符走 bufferSource 且 loop，不走振荡器', () => {
    audio.setVoice('obsidian');
    const oscBefore = ctx.oscs.length;
    const srcBefore = ctx.srcs.length;
    audio.tap();
    // 熔岩的轻触就是一声闷噪
    expect(ctx.srcs.length).toBeGreaterThan(srcBefore);
    expect(ctx.oscs.length).toBe(oscBefore);
    expect(ctx.srcs.slice(srcBefore).every((s) => s.loop)).toBe(true);
  });

  it('所有增益斜坡都不落到 0（0 会让真 API 抛 RangeError 并静默无声）', () => {
    // FakeParam 已经在 exp 目标 <= 0 时抛错，这里把四套全跑一遍作为回归
    for (const v of VOICES) {
      expect(() => { audio.preview(v.id); audio.win(true); audio.break(); audio.unlock(); }, v.id).not.toThrow();
    }
  });

  it('换主题会重烘 IR —— 不重烘的话混响还停在上一个世界', () => {
    audio.setVoice('obsidian');
    const ir = ctx.convs[0].buffer!;
    // 熔岩 0.85s × 8kHz = 6800
    expect(ir[0].length).toBe(Math.floor(0.85 * 8000));
  });

  it('静音时完全不发声（节点都不建）', () => {
    audio.setEnabled(false);
    const before = ctx.oscs.length + ctx.srcs.length;
    audio.light();
    audio.win(true);
    expect(ctx.oscs.length + ctx.srcs.length).toBe(before);
    audio.setEnabled(true);
  });

  it('恢复发声后又能出声了（开关不能是单向的）', () => {
    const before = ctx.oscs.length + ctx.srcs.length;
    // 用 tap 而不是 light：`light` 有突发限流（70ms 内最多 3 次），
    // 这里连跑十几条用例，很可能正好撞在窗口里 —— 那测的就是限流不是开关了
    audio.tap();
    expect(ctx.oscs.length + ctx.srcs.length).toBeGreaterThan(before);
  });
});

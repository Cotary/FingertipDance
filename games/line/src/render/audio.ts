/**
 * 音效合成器。不使用音频文件，全部用 WebAudio 生成。
 * 微信端无 WebAudio → 由 `platform.vibrate()` 兜底。
 *
 * ## 这一版改了什么
 *
 * 旧版是四个裸振荡器：`tone(880, 30, 'square', 0.15)`。
 * 主题换了世界，耳朵没换 —— 四套典藏主题（玻璃 / 罗盘 / 熔岩 / 金线）
 * 的画面差异在听觉上完全丢失了。
 *
 * 现在拆成两层：
 *
 * - **音色定义**（`voice.ts`）：纯数据，给定第几步吐出 `SoundNote[]`，可在 node 里单测；
 * - **合成引擎**（本文件）：只认 `SoundNote`，负责振荡器 / FM / 滤波 / 混响总线。
 *
 * 引擎不认识任何一套主题，主题也不认识 AudioContext —— 这是能写测试的前提。
 *
 * ## 总线结构
 *
 * ```
 * 每个音符 → gain(包络) → [hp] → [lp] ─┬─→ dry ─────────┐
 *                                       └─→ send → conv ─┴─→ master → destination
 * ```
 *
 * 湿声走**一路卷积混响**，IR 由代码生成（噪声 × 幂次衰减 × 一阶低通）。
 * 混响不是「加点空间感」的装饰：四个 `space` 的衰减从 0.85s 到 2.6s，
 * 这才是同一个音高在听感上属于两个世界的原因 ——
 * 干声无论如何都像掌机蜂鸣器。
 *
 * ## 几个必须知道的坑
 *
 * 1. **`exponentialRampToValueAtTime` 不能落到 0**，只能到 0.0001，否则抛异常且静默无声；
 * 2. **起音时间不能为 0**，直接从 0 斜坡是爆音的来源；
 * 3. **IR 只在切主题时重建一次**，2.6s × 48kHz × 2ch 是 25 万次循环，
 *    每帧做会卡；用 `irFor` 记住当前已经烘过哪一套；
 * 4. **iOS / 微信要求用户手势后才能出声**：`resume()` 放在每次发声前做（成本极低），
 *    比挂一次性监听稳 —— 玩家可能在页面切走回来后又失效。
 */
import {
  CLAY_VOICE,
  voiceFor,
  type SoundNote,
  type ThemeVoice,
} from './voice';

/** 音符太多会爆音，也会糊成一片。这个窗口是实测调出来的。 */
const BURST_WINDOW_MS = 70;
const BURST_MAX = 3;

/**
 * 没有 `blocked` 音色的主题退化成这一声。
 *
 * 一记被闷住的低叩：没有高频、没有余韵。它必须比落子**低**、比断线**短** ——
 * "不行"和"你错了"是两件事。
 */
const BLOCKED_DEFAULT: SoundNote[] = [
  { wave: 'triangle', freq: 196, to: 147, dur: 90, gain: 0.055, attack: 1, lp: 800, wet: 0.06 },
  { wave: 'noise', freq: 0, dur: 30, gain: 0.028, attack: 1, lp: 640, wet: 0.05 },
];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private conv: ConvolverNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private voice: ThemeVoice = CLAY_VOICE;
  /** 已经烘过哪一套的 IR（空串 = 还没烘） */
  private irFor = '';
  /** 连击步数。断线 / 通关归零 —— 这就是「乐句」的边界 */
  private step = 0;
  private enabled = true;
  private burstAt = 0;
  private burstN = 0;
  /** 最近一段逐格音的声源（跳过开场时要停掉还没响的）。 */
  private settleNodes: AudioScheduledSourceNode[] = [];

  // ── 图 ────────────────────────────────────────────────

  /**
   * 惰性建图。必须在用户手势后首次调用（浏览器自动播放策略）。
   *
   * 微信端 `window.AudioContext` 不存在 → 走 catch 返回 null，整条链静默降级，
   * 由调用方的 `platform.vibrate()` 兜住手感。
   */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;

      const ctx = new Ctor();
      const master = ctx.createGain();
      // 0.85 而不是 1：给叠音留头room，三个音同时响时不会削波
      master.gain.value = this.enabled ? 0.85 : 0;
      master.connect(ctx.destination);

      const dry = ctx.createGain();
      dry.gain.value = 1;
      dry.connect(master);

      const wet = ctx.createGain();
      wet.gain.value = 1;
      wet.connect(master);

      const conv = ctx.createConvolver();
      // 自己生成的 IR 已经限幅到 0.5，交给 Convolver 归一化会把暗的 IR 抬成糊
      conv.normalize = false;
      conv.connect(wet);

      this.ctx = ctx;
      this.master = master;
      this.dryBus = dry;
      this.conv = conv;
      this.buildIR();
      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * 按当前 theme 的空间参数烘一条 IR。
   *
   * 生成式 IR 的好处是四套主题的空间差可以只用一个「衰减 + 阻尼」表达，
   * 不用带四个 wav；坏处是暗的 IR 能量更低，所以末尾统一限幅到 0.5。
   */
  private buildIR(): void {
    const ctx = this.ctx;
    const conv = this.conv;
    if (!ctx || !conv) return;
    if (this.irFor === this.voice.id) return;
    this.irFor = this.voice.id;

    const { decay, damp } = this.voice.space;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * decay));
    const buf = ctx.createBuffer(2, len, sr);

    // 一阶低通：k = 1 - e^(-2π·fc/sr)。fc 越低 → k 越小 → 尾音越暗
    const k = 1 - Math.exp((-2 * Math.PI * damp) / sr);
    const pre = Math.floor(sr * 0.012); // 12ms 预延迟，声音不会糊在直击声上

    let peak = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const t = i / len;
        // 幂次而不是线性：线性衰减听着像「被人掐断」，室内混响是幂次的
        const env = Math.pow(1 - t, 2.4);
        lp += (Math.random() * 2 - 1 - lp) * k;
        const v = lp * env;
        d[i] = v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }

    // 限幅：峰值 0.5。不然后面 `space.wet` 的比例对不上，暗 IR 反而更响
    if (peak > 0) {
      const g = 0.5 / peak;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] *= g;
      }
    }
    conv.buffer = buf;
  }

  /** 1 秒白噪，循环取用。噪声层（熔岩的噼啪、玻璃的碎）全靠它。 */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const n = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  // ── 合成一个音符 ──────────────────────────────────────

  /** 合成一个音符，返回发声的声源节点（跳过开场时要停掉还没响的）。 */
  private note(ctx: AudioContext, n: SoundNote): AudioScheduledSourceNode[] {
    const dry = this.dryBus;
    const conv = this.conv;
    if (!dry || !conv) return [];

    const t0 = ctx.currentTime + (n.delay ?? 0) / 1000;
    const dur = Math.max(0.02, n.dur / 1000);
    // 起音必须 > 0，且不能吃掉半个音长，否则长音会变成「噗」
    const atk = Math.min(Math.max((n.attack ?? 3) / 1000, 0.001), dur * 0.5);
    const peak = Math.max(n.gain, 0.0002);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    // 终点是 0.0001 不是 0 —— 指数斜坡不能到 0
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    // 滤波链：先高通后低通（顺序反了会让低通的直流偏移进到高通里）。
    //
    // 带通是**第三种**：砂纸、石屑、掐沙这三声的全部性格都在"一条窄带"上，
    // 用 hp+lp 夹出来的宽窄是错的 —— 夹出来的是"一片噪声"，带通才是"砂"。
    let tail: AudioNode = amp;
    if (n.bp) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(Math.max(20, n.bp), t0);
      if (n.bpTo !== undefined) {
        // 扫落：2400→850 就是"砂从指间磨过去"的那一下（设计稿 grind）
        bp.frequency.exponentialRampToValueAtTime(Math.max(20, n.bpTo), t0 + (n.sweep ?? dur * 0.85));
      }
      bp.Q.value = n.q ?? 1;
      tail.connect(bp);
      tail = bp;
    } else {
      if (n.hp) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = n.hp;
        hp.Q.value = 0.7;
        tail.connect(hp);
        tail = hp;
      }
      if (n.lp) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = n.lp;
        lp.Q.value = 0.7;
        tail.connect(lp);
        tail = lp;
      }
    }

    tail.connect(dry);
    const send = ctx.createGain();
    send.gain.value = n.wet ?? 0.3;
    tail.connect(send);
    send.connect(conv);

    // ── 声源 ──
    if (n.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      src.loop = true;
      src.connect(amp);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
      return [src];
    }

    const osc = ctx.createOscillator();
    osc.type = n.wave;
    osc.frequency.setValueAtTime(Math.max(1, n.freq), t0);
    if (n.to !== undefined) {
      // 扫频走 85% 的时长，留一点余量让尾巴停在终点而不是半路
      // 扫频时长可以独立于包络（见 `Note.sweep`）：石章的 112→58 要走 90ms，
      // 而它的增益要衰减 220ms。绑在一起就变成"下滑的长音"。
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.to), t0 + (n.sweep ?? dur * 0.85));
    }

    let mod: OscillatorNode | undefined;
    if (n.fm) {
      mod = ctx.createOscillator();
      const mg = ctx.createGain();
      mod.type = 'sine';
      mod.frequency.value = Math.max(1, n.freq * n.fm.ratio);
      const depth = Math.max(1, n.freq * n.fm.depth);
      mg.gain.setValueAtTime(depth, t0);
      // 调制深度衰减 = 音色从「金属」滑向「纯音」，这是钟声的灵魂
      mg.gain.exponentialRampToValueAtTime(Math.max(depth * 0.02, 1), t0 + (n.fm.decay ?? dur * 0.4));
      mod.connect(mg);
      mg.connect(osc.frequency);
      mod.start(t0);
      mod.stop(t0 + dur + 0.05);
    }

    osc.connect(amp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return mod ? [osc, mod] : [osc];
  }

  /** 播一组音符。返回发声的声源节点（`settleAt` 要留着它们，跳过时能停）。 */
  private fire(notes: SoundNote[]): AudioScheduledSourceNode[] {
    if (!this.enabled) return [];
    const ctx = this.ensure();
    if (!ctx) return [];
    // 每次发声前摸一下 —— 页面切走回来、iOS 首次手势后都会是 suspended。
    //
    // 但 `OfflineAudioContext` **不能** resume：它的 state 天生是 suspended，
    // resume() 直接抛 InvalidStateError（音频试听页就是这么挂的）。
    // 而且 resume 返回的是 Promise，不接住的话失败会变成 unhandled rejection。
    const offline =
      typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    if (!offline && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const srcs: AudioScheduledSourceNode[] = [];
    for (const n of notes) srcs.push(...this.note(ctx, n));
    return srcs;
  }

  /**
   * 突发限流。
   *
   * 拖动时一帧可能连亮三格，每格 3 个音符 → 9 个振荡器同时起振会削波。
   * 超出预算直接丢弃：宁可少一声，不要爆一下。
   */
  private budget(): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.burstAt > BURST_WINDOW_MS) {
      this.burstAt = now;
      this.burstN = 0;
    }
    if (this.burstN >= BURST_MAX) return false;
    this.burstN += 1;
    return true;
  }

  // ── 对外 ──────────────────────────────────────────────

  /**
   * 换音色。空串 / 未知 id → 经典黏土（见 `voiceFor`）。
   *
   * 会重建混响 IR，但**不会**发声 —— 想试听用 `preview` / `probe`。
   */
  setVoice(themeId: string | undefined): void {
    const v = voiceFor(themeId);
    if (v.id === this.voice.id) return;
    this.voice = v;
    this.step = 0;
    this.irFor = '';
    if (this.ctx) this.buildIR();
  }

  /** 当前音色 id（调试 / 测试用）。 */
  get voiceId(): string {
    return this.voice.id;
  }

  /** 总开关。关掉时 master 增益归零，节点还在（复用不重建）。 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.85 : 0;
  }

  /** 顺序点亮一格（推进连击乐句）。 */
  light(): void {
    if (!this.budget()) return;
    const v = this.voice;
    // 音高微抖 ±2.5%。
    //
    // 设计稿对落子声的要求是"重复敲击频率微抖 ±5%，不像机器"。
    // 一只真瓷碗被连敲 20 下，每一下都不在同一个赫兹上；
    // 而采样的引擎会给出一模一样的波形 —— 连击到十几下就是机关枪。
    // 抖动放在**引擎**而不是 `step()` 里：音色定义是纯数据（要能单测），
    // 随机性属于演奏，不属于谱子。
    const j = 1 + (Math.random() - 0.5) * 0.05;
    const notes = v.step(this.step).map((n) =>
      n.wave === 'noise' ? n : { ...n, freq: n.freq * j, to: n.to === undefined ? undefined : n.to * j },
    );
    this.fire(notes);
    // 封顶 64：再往上音阶早就撞了八度上限，计数只用于噪声亮度
    if (this.step < 64) this.step += 1;
  }

  /** 界面轻触。**不推进乐句** —— 点个页签不该把旋律推高一格。 */
  tap(): void {
    this.fire(this.voice.tap());
  }

  /** 断线。乐句在这里断掉，这是「断了有代价」的听觉表达。 */
  break(): void {
    this.step = 0;
    this.fire(this.voice.break());
  }

  /**
   * 无效落子：撞石头 / 没钥匙 / 逆单向门。
   *
   * **不推进乐句，也不重置乐句** —— 玩家只是"点错了一格"，
   * 不是"走错了路"。重置在这里等于把他已经铺好的一段白白作废的听觉暗示。
   */
  blocked(): void {
    this.fire(this.voice.blocked?.() ?? BLOCKED_DEFAULT);
  }

  /**
   * 通关。`perfect` = 一次没撤销。
   *
   * `at` = 整套往后推多少毫秒。铺满级联会长达一秒多（48ms × 格数），
   * 土埙必须等**末粒**落地才响（设计稿：`setTimeout(sfx('xun'), N*48+120)`）——
   * 通关那一帧就把整套音频排进时间线，比挂一串 `setTimeout` 准得多：
   * 定时器会被主线程的渲染帧挤偏，而这个偏移在"埙接在沙雨尾巴上"时听得出来。
   */
  win(perfect = false, at = 0): void {
    this.step = 0;
    const notes = this.voice.win(perfect);
    this.fire(at > 0 ? notes.map((n) => ({ ...n, delay: (n.delay ?? 0) + at })) : notes);
  }

  /**
   * 铺满级联：`count` 粒，每粒间隔 `stepMs`。
   *
   * 一次排完整段，不在每粒上挂定时器 —— 同一段沙雨，26 个 `setTimeout`
   * 在低端机上会各自偏 10~30ms，听起来就是节奏散了。
   * 音色不给（玻璃 / 瓷这类不会落沙的主题）就**一声都不发**。
   */
  settle(count: number, stepMs: number): void {
    if (count <= 0) return;
    const delays: number[] = [];
    for (let i = 0; i < count; i++) delays.push(i * stepMs);
    this.settleAt(delays);
  }

  /**
   * 逐格音：按**给定时刻表**排一整段（每格一记）。
   *
   * 进场揭幕用这个 —— 格子的落定不是等距的（行内 `step`、行间 `row`，
   * 大盘还要按 `sweep` 等比压缩），`settle` 那种等距排法排不出行序的拍子，
   * 音和画就散了。时刻由 kit 的 `enterCellDelay` 给（音画同源）。
   *
   * 时刻表里的相同时刻只发**一记**：`prefers-reduced-motion` 降级时
   * 整行同时淡亮（`step: 0`），一行 8 格就是 8 个同刻的 delay ——
   * 不去重会叠成一声炸音，而去重后正好"一行一记"，行序节奏还在。
   */
  settleAt(delays: readonly number[]): void {
    this.settleStop();
    if (delays.length === 0) return;
    const grain = this.voice.settle?.();
    if (!grain || grain.length === 0) return;
    const all: SoundNote[] = [];
    for (const d of new Set(delays)) {
      for (const n of grain) all.push({ ...n, delay: (n.delay ?? 0) + d });
    }
    this.settleNodes = this.fire(all);
  }

  /**
   * 停掉还没响的逐格音。
   *
   * 跳过开场时用（设计稿「动画中再点 = 跳过：所有格直接落定、沙光照播，
   * **不回放过程**」）—— 逐格音是 WebAudio 里排好的时间线，
   * 不停掉的话跳完之后沙雨还在下，又变成"动画完了音效还没结束"。
   */
  settleStop(): void {
    for (const src of this.settleNodes) {
      // 已经停过的节点再 `stop()` 在个别老实现里会抛 —— 停声这种事不值得炸游戏
      try {
        src.stop();
      } catch {
        /* 已停 */
      }
    }
    this.settleNodes = [];
  }

  /**
   * 一声玉磬（铺满末格 / 开局揭幕末格）。
   *
   * 主题不给 `chime` 就退回 `win` 的第一声磬？不 —— **一声不发**。
   * 磬是"东西落定"的听觉标签，玻璃那一套没有这层语言；
   * 强行拿 `win` 顶上会把"通关"和"开盘"混成一件事。
   */
  chime(): void {
    const c = this.voice.chime?.();
    if (!c || c.length === 0) return;
    this.fire(c);
  }

  /** 解锁皮肤 / 主题。 */
  unlock(): void {
    this.fire(this.voice.unlock());
  }

  /**
   * 试听：切到该主题的音色并播签名动机。
   *
   * 装备时调 —— 1.2 秒内玩家就知道「这套是什么味道」，不用进关。
   * 这里**顺带切换音色**是有意的：装备和换音色本来就是同一件事，
   * 拆成两步一定会有人忘了调第二步。
   */
  preview(themeId: string | undefined): void {
    this.setVoice(themeId);
    this.fire(this.voice.signature());
  }

  /**
   * 点选试探：切音色，只播一声。
   *
   * 挑主题时玩家会在展台上连点好几套，播完整签名动机太吵也太长。
   */
  probe(themeId: string | undefined): void {
    this.setVoice(themeId);
    this.step = 0;
    this.fire(this.voice.step(0));
  }
}

/** 全局单例。 */
export const audio = new Audio();

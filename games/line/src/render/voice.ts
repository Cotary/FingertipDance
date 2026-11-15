/**
 * 主题音色（Theme Voice）。
 *
 * ## 为什么要有这一层
 *
 * 八套典藏主题换了背景、格子、图标、路线、UI 配色 —— 玩家**看到的**是八个世界，
 * 听到的还是同一句 `tone(880, 30, 'square', 0.15)`。耳朵没换皮，画面就白换了：
 * 人判断「一个东西是不是真的换了」时，听觉的权重比视觉高，而且更不容易被细节骗过。
 *
 * ## 判据沿用画面的那一条
 *
 * > 抽掉音高、只留**音色与包络**，还认得出是哪一套吗？
 *
 * 如果只是把 880 改成 1046，那是换音高，不是换音色 —— 和「只换色板」是同一个错误。
 * 所以每套只占**一条轴**，和 `themes/index.ts` 里那张表严格对齐：
 *
 * | 主题 | 轴 | 声音上换掉了什么 |
 * |---|---|---|
 * | 水墨山河 | 媒介 | 丝弦 + 笔尖擦纸的沙沙声，起音 6ms（「按」下去） |
 * | 玻璃穹顶 | 材质 | 非谐波 FM（3.52 倍）→ 敲玻璃杯，不是敲音叉 |
 * | 像素街机 | 分辨率 | 方波 + 双音和音，**几乎没有混响**（0.18s） |
 * | 圆格罗盘 | 几何 | 短拨奏 + 音高**往返**，像珠子被绳拉回来 |
 * | 赛博霓虹 | 平面 | 锯齿上扫 110ms，起音 1.5ms（电子振荡器是瞬时的） |
 * | 黑曜熔岩 | 光源 | 下扫次低频 + 噪声，**起音是软的**（8ms） |
 * | 金线装饰 | 秩序 | 钟的模态比 1:2.76，每步两响，奇偶步错开 |
 * | 深海荧光 | 形态 | 双正弦失谐 0.8% 出拍频，起音 12ms（八套里最慢） |
 *
 * ## 为什么返回「音符数据」而不是自己操作 AudioContext
 *
 * 这一层是**纯函数**：给定第几步，吐出一组 `SoundNote`。好处有三：
 *
 * 1. 能在 node 里单测（`test/voice.test.ts` 断言「熔岩首音必须下扫」「八套主频两两不同」），
 *    而 `AudioContext` 在测试环境根本不存在；
 * 2. 换引擎（比如以后上真采样）不用重写八套音色；
 * 3. 音色可以被**静态审阅** —— 八套的差异在代码里是并排的八段数据，不是八段过程。
 *
 * ## 混响是「高级」的门槛，不是装饰
 *
 * 干声听起来永远是「掌机蜂鸣器」。四个 `space` 的衰减时间差了三倍
 * （熔岩 0.85s 洞穴 / 玻璃 2.6s 大厅），这才是同一个音高听上去属于两个世界的原因。
 */

/** 波形。`noise` 走白噪缓冲，`freq` 被忽略。 */
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

/**
 * 一个音符。
 *
 * 故意做成**扁平数据 + 少量可选段**：合成器的参数是有限的，
 * 一旦允许嵌套（比如 `filter: { type, freq, q, env }`），八套音色就会各写各的，
 * 审阅时再也对不齐。
 */
export interface SoundNote {
  wave: Wave;
  /** 起始频率（Hz） */
  freq: number;
  /** 扫频终点；省略 = 定频 */
  to?: number;
  /** 时长（ms），从起音算到静音 */
  dur: number;
  /** 峰值增益（0..1，进 master 前） */
  gain: number;
  /** 延迟（ms），用于琶音 */
  delay?: number;
  /**
   * 起音时间（ms）。
   *
   * 这一项就是「材质」的一半：玻璃 1.5ms（硬、脆），熔岩 8ms（粘、厚）。
   * 默认 3ms —— 比 3 更短会爆音，比 3 更长会失去打击感。
   */
  attack?: number;
  /** 低通截止（Hz） */
  lp?: number;
  /** 高通截止（Hz） */
  hp?: number;
  /** 送入混响的比例 0..1；省略 = 0.3 */
  wet?: number;
  /**
   * FM：调制器频率 = `freq * ratio`，深度 = `freq * depth`（即调制指数）。
   *
   * 非整数 ratio 才出金属味（玻璃 3.52、钟 2.76）；整数比会退化成另一个谐波音。
   */
  fm?: { ratio: number; depth: number; decay?: number };
}

/** 空间。四个参数决定「这个声音在多大的房间里」。 */
export interface VoiceSpace {
  /** 混响衰减到 -60dB 的秒数 */
  decay: number;
  /** 混响高频阻尼（Hz）。越低越暗、越像石头洞 */
  damp: number;
  /** 湿声总线的基础比例 */
  wet: number;
}

/** 一套主题音色。 */
export interface ThemeVoice {
  /** 与 `BoardTheme.id` 对齐；`clay` 是经典盘面的兜底 */
  id: string;
  name: string;
  /** 一句话音色说明，展台上会显示（「玻璃钟 · 2.6s 大厅」） */
  desc: string;
  space: VoiceSpace;
  /** 顺序点亮第 `n` 步（n 从 0 起，断线归零）。**这是整套音色的主角** */
  step(n: number): SoundNote[];
  /** 界面轻触（点页签、点陶片）。和玩法声分开：它不该推进连击乐句 */
  tap(): SoundNote[];
  /** 断线 */
  break(): SoundNote[];
  /** 通关。`perfect` = 一次没撤销 */
  win(perfect: boolean): SoundNote[];
  /** 解锁 */
  unlock(): SoundNote[];
  /** 签名动机：装备主题时播，1.2 秒内听完一整套的世界观 */
  signature(): SoundNote[];
}

// ── 音阶工具 ────────────────────────────────────────────────

/** 音名比 → 频率。 */
function semis(base: number, n: number): number {
  return base * Math.pow(2, n / 12);
}

/**
 * 在音阶上取第 `n` 级，超过 `octaveSpan` 个八度就封顶。
 *
 * 封顶是必须的：`step` 在长连击里能到 30+，不封顶会一路爬到 20kHz ——
 * 不但听不见，还会在手机上扬声器上变成刺耳的电流声。
 */
function scaleAt(base: number, scale: readonly number[], n: number, octaveSpan = 2): number {
  const len = scale.length;
  const i = ((n % len) + len) % len;
  const oct = Math.min(Math.floor(n / len), octaveSpan);
  return semis(base, oct * 12 + scale[i]);
}

/**
 * 0,1,2,3,2,1,0,1… 的往返索引。
 *
 * 罗盘用它：珠子被绳穿过去，走到头会被**拉回来**，不会无限往上飘。
 */
function pingpong(n: number, len: number): number {
  const period = len * 2 - 2;
  const i = ((n % period) + period) % period;
  return i < len ? i : period - i;
}

// ── 音阶 ───────────────────────────────────────────────────

/** 利底亚六声（含 #4）。#4 是「通透」的来源，大调五声给不出这个味道。 */
const GLASS_SCALE = [0, 2, 4, 6, 7, 9] as const;

/** 五声宫。圆格罗盘是绳与珠，不需要半音的紧张感。 */
const ORBIT_SCALE = [0, 2, 4, 7, 9] as const;

/** 弗里吉亚六声（含 b2）。b2 贴着主音，那种「地底下的压迫」就来自它。 */
const BURN_SCALE = [0, 1, 3, 5, 7, 8] as const;

/** 大调五声。金线是秩序，秩序不需要意外。 */
const GILDED_SCALE = [0, 2, 4, 7, 9] as const;

// ── 经典（兜底） ────────────────────────────────────────────

/**
 * 经典黏土盘面。
 *
 * **刻意保留旧音色**（880 方波 30ms）：这是玩家已经形成条件反射的声音，
 * 换主题才该换耳朵，不换主题不该动它。
 */
const CLAY: ThemeVoice = {
  id: 'clay',
  name: '经典黏土',
  desc: '方波 · 干声',
  space: { decay: 0.5, damp: 3200, wet: 0.10 },
  step: () => [{ wave: 'square', freq: 880, dur: 30, gain: 0.15, wet: 0.12 }],
  tap: () => [{ wave: 'square', freq: 660, dur: 24, gain: 0.07, wet: 0.08 }],
  break: () => [
    { wave: 'square', freq: 220, dur: 120, gain: 0.18, lp: 1800 },
    { wave: 'square', freq: 200, dur: 60, gain: 0.12, delay: 40, lp: 1600 },
  ],
  win: (perfect) => [
    { wave: 'triangle', freq: 523, dur: 100, gain: 0.2 },
    { wave: 'triangle', freq: 659, dur: 100, gain: 0.2, delay: 100 },
    { wave: 'triangle', freq: 784, dur: 180, gain: 0.22, delay: 200 },
    ...(perfect ? [{ wave: 'triangle' as Wave, freq: 1046, dur: 260, gain: 0.18, delay: 300 }] : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 1046, dur: 150, gain: 0.18 },
    { wave: 'sine', freq: 1568, dur: 200, gain: 0.2, delay: 120 },
  ],
  signature: () => [
    { wave: 'square', freq: 880, dur: 60, gain: 0.12 },
  ],
};

// ── 玻璃穹顶 · 材质轴 ────────────────────────────────────────

/**
 * 玻璃。
 *
 * 敲玻璃杯的频谱是**非谐波**的（管体振动，不是弦），所以必须用 FM，
 * 调制比取 3.52 —— 一个是整数比（3 或 4），出来的就是普通泛音，像玩具琴。
 *
 * 第二层是 2 倍频的纯正弦、只有 90ms：那是指甲划过杯口的「咝」，
 * 少了它，钟声会很闷，不在玻璃上。
 */
const GLASS: ThemeVoice = {
  id: 'glass',
  name: '玻璃穹顶',
  desc: '玻璃钟 · 2.6s 大厅',
  // 2.6 秒、7kHz 阻尼：大厅。玻璃主题的空间感比音高更像它自己
  space: { decay: 2.6, damp: 7000, wet: 0.44 },
  step: (n) => {
    // 封顶一个八度（2093 → 4186）。玻璃再往上就超出成人听觉的舒适区，
    // 手机小喇叭上也只剩刺耳的电流味 —— 而玻璃的「贵」恰恰在它不刺。
    const f = scaleAt(2093, GLASS_SCALE, n, 1);
    return [
      {
        wave: 'sine', freq: f, dur: 420, gain: 0.15,
        attack: 1.5, wet: 0.55,
        fm: { ratio: 3.52, depth: 1.6, decay: 0.30 },
      },
      { wave: 'sine', freq: f * 2, dur: 90, gain: 0.045, attack: 1, wet: 0.7 },
    ];
  },
  tap: () => [{ wave: 'sine', freq: 3200, dur: 40, gain: 0.05, attack: 1, wet: 0.4 }],
  break: () => [
    // 碎：高通噪声 + 极快衰减。不加混响的话听起来像撕纸
    { wave: 'noise', freq: 0, dur: 150, gain: 0.13, attack: 1, hp: 2800, wet: 0.5 },
    { wave: 'sine', freq: 1200, to: 380, dur: 180, gain: 0.09, attack: 2, wet: 0.45 },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 2093, dur: 700, gain: 0.14, attack: 1.5, wet: 0.6, fm: { ratio: 3.52, depth: 1.4, decay: 0.5 } },
    { wave: 'sine', freq: 2637, dur: 700, gain: 0.13, attack: 1.5, wet: 0.6, delay: 110, fm: { ratio: 3.52, depth: 1.3, decay: 0.5 } },
    { wave: 'sine', freq: 3136, dur: 900, gain: 0.15, attack: 1.5, wet: 0.65, delay: 220, fm: { ratio: 3.52, depth: 1.2, decay: 0.7 } },
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 4186, dur: 600, gain: 0.07, attack: 1, wet: 0.7, delay: 340 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 3136, dur: 320, gain: 0.11, attack: 1, wet: 0.6, fm: { ratio: 3.52, depth: 1.2, decay: 0.25 } },
    { wave: 'sine', freq: 4186, dur: 420, gain: 0.09, attack: 1, wet: 0.65, delay: 130 },
  ],
  signature: () => [
    { wave: 'sine', freq: 2093, dur: 600, gain: 0.13, attack: 1.5, wet: 0.6, fm: { ratio: 3.52, depth: 1.5, decay: 0.4 } },
    { wave: 'sine', freq: 2637, dur: 600, gain: 0.12, attack: 1.5, wet: 0.6, delay: 130, fm: { ratio: 3.52, depth: 1.4, decay: 0.4 } },
    { wave: 'sine', freq: 3136, dur: 800, gain: 0.12, attack: 1.5, wet: 0.68, delay: 260, fm: { ratio: 3.52, depth: 1.2, decay: 0.6 } },
  ],
};

// ── 圆格罗盘 · 几何轴 ───────────────────────────────────────

/**
 * 罗盘。
 *
 * 三角波 + 140ms 拨奏：谐波少、衰减快，像竖琴/钟琴。
 * 八度上叠一个 45ms 的正弦，是「拨弦的起振」，不是第二个音。
 *
 * 音高走 **往返**（0,1,2,3,4,3,2,1），每 8 步升一个八度 ——
 * 玩家听到的是「走远了又被拉回来」，而不是「一路爬楼梯」。
 * 这是唯一一套**不往上走**的：几何是闭合的。
 */
const ORBIT: ThemeVoice = {
  id: 'orbit',
  name: '圆格罗盘',
  desc: '拨弦 · 1.9s 木厅',
  // 木厅：比玻璃短、比熔岩亮。干声占比大 → 听起来近，"珠子就在手边"
  space: { decay: 1.9, damp: 5000, wet: 0.28 },
  step: (n) => {
    const oct = Math.min(Math.floor(n / 8), 1);
    const f = semis(523.25, oct * 12 + ORBIT_SCALE[pingpong(n, ORBIT_SCALE.length)]);
    return [
      { wave: 'triangle', freq: f, dur: 150, gain: 0.16, attack: 2, wet: 0.34 },
      { wave: 'sine', freq: f * 2, dur: 45, gain: 0.05, attack: 1, wet: 0.30 },
    ];
  },
  tap: () => [{ wave: 'triangle', freq: 784, dur: 60, gain: 0.07, attack: 2, wet: 0.24 }],
  break: () => [
    // 弦松了：小二度下行，两个音咬着，不要混响
    { wave: 'triangle', freq: 415, dur: 110, gain: 0.12, attack: 3, wet: 0.2 },
    { wave: 'triangle', freq: 392, dur: 150, gain: 0.11, attack: 3, delay: 70, wet: 0.2 },
  ],
  win: (perfect) => [
    { wave: 'triangle', freq: 523, dur: 180, gain: 0.16, attack: 2, wet: 0.34 },
    { wave: 'triangle', freq: 659, dur: 180, gain: 0.16, attack: 2, wet: 0.34, delay: 100 },
    { wave: 'triangle', freq: 784, dur: 240, gain: 0.17, attack: 2, wet: 0.36, delay: 200 },
    { wave: 'triangle', freq: 1046, dur: 380, gain: 0.16, attack: 2, wet: 0.4, delay: 300 },
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 1568, dur: 300, gain: 0.06, attack: 2, wet: 0.45, delay: 380 }]
      : []),
  ],
  unlock: () => [
    { wave: 'triangle', freq: 1046, dur: 200, gain: 0.11, attack: 2, wet: 0.34 },
    { wave: 'triangle', freq: 1568, dur: 260, gain: 0.09, attack: 2, delay: 120, wet: 0.38 },
  ],
  signature: () => [
    { wave: 'triangle', freq: 523, dur: 160, gain: 0.14, attack: 2, wet: 0.32 },
    { wave: 'triangle', freq: 784, dur: 160, gain: 0.13, attack: 2, wet: 0.32, delay: 110 },
    { wave: 'triangle', freq: 659, dur: 260, gain: 0.13, attack: 2, wet: 0.36, delay: 220 },
  ],
};

// ── 黑曜熔岩 · 光源轴 ───────────────────────────────────────

/**
 * 熔岩。
 *
 * 这套唯一的规则是**不唱**：主音在 110~180Hz 之间，只做下扫，
 * 靠噪声层的亮度变化（900 → 2400Hz）表达「越烧越旺」。
 *
 * 起音 8ms 是刻意的：这是八套里第二慢的（最慢是深海 12ms）。玻璃和金属都可以瞬时起振，
 * 岩浆不行 —— 它会先鼓起来再破。这一个参数就把它和「低音版玻璃」分开了。
 *
 * 音量整体压到 0.13 以下：手机小喇叭回放 46Hz 只有位移没有声音，
 * 推高了只会让外放的整段旋律变糊。
 */
const BURN: ThemeVoice = {
  id: 'obsidian',
  name: '黑曜熔岩',
  desc: '次低频 · 0.85s 洞穴',
  // 0.85s + 1.6kHz 阻尼：洞穴。尾音又短又暗，不能有大厅的余韵
  space: { decay: 0.85, damp: 1600, wet: 0.22 },
  step: (n) => {
    // 弗里吉亚往上爬（b2 贴着主音），封顶一个八度。
    // 不用半音阶：半音阶听起来是「在调音」，b2 听起来才是「地底下有东西在动」。
    const f = scaleAt(110, BURN_SCALE, n, 1);
    const notes: SoundNote[] = [
      { wave: 'sine', freq: f * 2.6, to: f, dur: 220, gain: 0.13, attack: 8, wet: 0.28, lp: 900 },
      { wave: 'sine', freq: 46, dur: 240, gain: 0.10, attack: 12, wet: 0.10 },
      {
        wave: 'noise', freq: 0, dur: 90, gain: 0.05, attack: 4, wet: 0.18,
        // 亮度的爬升就是这个主题的「进度条」：越连越旺
        lp: Math.min(900 + n * 190, 2400),
      },
    ];
    // 每三步一记爆裂，长连击才有「噼啪」的颗粒
    if (n > 0 && n % 3 === 2) {
      notes.push({ wave: 'noise', freq: 0, dur: 45, gain: 0.035, attack: 1, hp: 1800, wet: 0.25, delay: 30 });
    }
    return notes;
  },
  tap: () => [
    { wave: 'noise', freq: 0, dur: 60, gain: 0.05, attack: 3, lp: 520, wet: 0.12 },
  ],
  break: () => [
    // 岩石崩：一个冲击 + 一段下扫。这是全作唯一允许「吵」的地方
    { wave: 'noise', freq: 0, dur: 280, gain: 0.16, attack: 3, lp: 700, wet: 0.3 },
    { wave: 'sine', freq: 200, to: 48, dur: 320, gain: 0.14, attack: 5, wet: 0.18 },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 110, to: 110, dur: 400, gain: 0.13, attack: 8, wet: 0.3, lp: 800 },
    { wave: 'sine', freq: 147, dur: 400, gain: 0.12, attack: 8, wet: 0.3, delay: 140, lp: 900 },
    { wave: 'sine', freq: 220, dur: 600, gain: 0.13, attack: 6, wet: 0.34, delay: 280, lp: 1400 },
    // 唯一一次「亮」—— 通关是这套主题里唯一的光
    { wave: 'sine', freq: 1760, dur: 500, gain: 0.07, attack: 2, wet: 0.5, delay: 420 },
    ...(perfect
      ? [{ wave: 'noise' as Wave, freq: 0, dur: 220, gain: 0.05, attack: 2, hp: 2400, wet: 0.4, delay: 460 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 120, to: 240, dur: 260, gain: 0.11, attack: 6, wet: 0.25, lp: 1200 },
    { wave: 'noise', freq: 0, dur: 140, gain: 0.05, attack: 2, hp: 2200, wet: 0.3, delay: 180 },
  ],
  signature: () => [
    { wave: 'sine', freq: 260, to: 70, dur: 520, gain: 0.14, attack: 10, wet: 0.3, lp: 900 },
    { wave: 'noise', freq: 0, dur: 180, gain: 0.05, attack: 8, lp: 1100, wet: 0.25, delay: 60 },
    { wave: 'sine', freq: 55, dur: 600, gain: 0.11, attack: 14, wet: 0.12, delay: 220 },
  ],
};

// ── 金线装饰 · 秩序轴 ───────────────────────────────────────

/**
 * 金线。
 *
 * 钟的模态比是 1 : 2.76 : 5.40（自由振动板的实测值），取前两个做 FM，
 * 长尾 900ms。这是八套里尾音最长的单音（和深海并列）—— 金线是「保留」，不是「划过」。
 *
 * 每一步都是**两响**：主钟 + 五度上方的弱钟（18ms 后）。
 * 奇偶步再叠一个八度 sparkle。三响的步子是「节点」，两响的是「线」——
 * 金线主题的画面就是「线 + 节点」，声音必须同构。
 */
const GILDED: ThemeVoice = {
  id: 'gilded',
  name: '金线装饰',
  desc: '金钟 · 2.2s 石厅',
  // 石厅：亮、长，但阻尼比玻璃低一档，避免 2.76 倍频的金属味变刺
  space: { decay: 2.2, damp: 4500, wet: 0.36 },
  step: (n) => {
    const f = scaleAt(1568, GILDED_SCALE, n, 2);
    const notes: SoundNote[] = [
      {
        wave: 'sine', freq: f, dur: 900, gain: 0.12,
        attack: 2, wet: 0.5,
        fm: { ratio: 2.76, depth: 1.0, decay: 0.55 },
      },
      { wave: 'sine', freq: semis(f, 7), dur: 700, gain: 0.045, attack: 2, wet: 0.55, delay: 18 },
    ];
    if (n % 2 === 1) {
      notes.push({ wave: 'sine', freq: semis(f, 12), dur: 500, gain: 0.03, attack: 1, wet: 0.6, delay: 34 });
    }
    return notes;
  },
  tap: () => [
    { wave: 'sine', freq: 2093, dur: 120, gain: 0.05, attack: 1.5, wet: 0.35, fm: { ratio: 2.76, depth: 0.8, decay: 0.1 } },
  ],
  break: () => [
    // 金器落地：闷，不是碎。低通 900 才不会有玻璃感
    { wave: 'noise', freq: 0, dur: 80, gain: 0.10, attack: 2, lp: 900, wet: 0.3 },
    { wave: 'sine', freq: 320, dur: 260, gain: 0.09, attack: 3, wet: 0.35, fm: { ratio: 2.76, depth: 0.8, decay: 0.15 } },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 1568, dur: 900, gain: 0.12, attack: 2, wet: 0.55, fm: { ratio: 2.76, depth: 1.0, decay: 0.6 } },
    { wave: 'sine', freq: 1976, dur: 900, gain: 0.11, attack: 2, wet: 0.55, delay: 140, fm: { ratio: 2.76, depth: 0.9, decay: 0.6 } },
    { wave: 'sine', freq: 2349, dur: 1100, gain: 0.12, attack: 2, wet: 0.6, delay: 280, fm: { ratio: 2.76, depth: 0.9, decay: 0.8 } },
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 3136, dur: 800, gain: 0.05, attack: 1, wet: 0.65, delay: 400 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 1568, dur: 500, gain: 0.10, attack: 2, wet: 0.5, fm: { ratio: 2.76, depth: 0.9, decay: 0.3 } },
    { wave: 'sine', freq: 2349, dur: 600, gain: 0.08, attack: 2, wet: 0.55, delay: 130 },
  ],
  signature: () => [
    { wave: 'sine', freq: 1568, dur: 800, gain: 0.11, attack: 2, wet: 0.55, fm: { ratio: 2.76, depth: 1.0, decay: 0.5 } },
    { wave: 'sine', freq: 2093, dur: 800, gain: 0.09, attack: 2, wet: 0.55, delay: 150 },
    { wave: 'sine', freq: 2349, dur: 1000, gain: 0.09, attack: 2, wet: 0.6, delay: 300, fm: { ratio: 2.76, depth: 0.9, decay: 0.7 } },
  ],
};

// ── 水墨山河 · 媒介轴 ────────────────────────────────────────

/** 五声宫。水墨不需要半音：它是「写」出来的，不是「算」出来的。 */
const INK_SCALE = [0, 2, 4, 7, 9] as const;

/**
 * 水墨。
 *
 * 这张画的材质是**纸和墨**，声音也只能是这两样：
 * 正弦是「弦」（古琴的丝弦，谐波少、尾音软），
 * 那 70ms 的高通噪声是「笔尖擦过纸」的沙沙声 —— 两样缺一样都不成立。
 *
 * 起音 6ms：毛笔落纸不是敲，是「按」下去。比玻璃（1.5ms）慢得多，
 * 比熔岩（8ms）快一点 —— 这个中间值就是它自己的位置。
 *
 * 每三步一次「吟」：主音微微下滑（古琴的按音），这是这套唯一的装饰，
 * 也是水墨和「低音版钢琴」的分界线。
 */
const INK: ThemeVoice = {
  id: 'ink',
  name: '水墨山河',
  desc: '丝弦 · 1.6s 书房',
  space: { decay: 1.6, damp: 3600, wet: 0.30 },
  step: (n) => {
    const f = scaleAt(330, INK_SCALE, n, 1);
    const notes: SoundNote[] = [
      {
        wave: 'sine', freq: f, dur: 520, gain: 0.14,
        attack: 6, lp: 2200, wet: 0.34,
        // 吟：每三步一次轻微的按音滑动。不滑的那两步是「写」，滑的是「顿」
        ...(n % 3 === 2 ? { to: f * 0.94 } : {}),
      },
      { wave: 'noise', freq: 0, dur: 70, gain: 0.032, attack: 3, hp: 1400, lp: 4200, wet: 0.18 },
    ];
    return notes;
  },
  tap: () => [{ wave: 'noise', freq: 0, dur: 40, gain: 0.05, attack: 2, hp: 1800, wet: 0.15 }],
  break: () => [
    // 墨滴落在纸上：闷、短，没有金属味的「碎」
    { wave: 'sine', freq: 196, to: 150, dur: 220, gain: 0.12, attack: 5, lp: 900, wet: 0.28 },
    { wave: 'noise', freq: 0, dur: 90, gain: 0.05, attack: 4, lp: 1100, wet: 0.2 },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 330, dur: 600, gain: 0.13, attack: 6, lp: 2400, wet: 0.36 },
    { wave: 'sine', freq: 440, dur: 600, gain: 0.12, attack: 6, lp: 2400, wet: 0.36, delay: 130 },
    { wave: 'sine', freq: 587, dur: 800, gain: 0.13, attack: 6, lp: 2600, wet: 0.4, delay: 280 },
    ...(perfect
      ? [{ wave: 'noise' as Wave, freq: 0, dur: 260, gain: 0.035, attack: 8, hp: 2200, wet: 0.35, delay: 380 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 587, dur: 400, gain: 0.11, attack: 5, lp: 2400, wet: 0.34 },
    { wave: 'noise', freq: 0, dur: 120, gain: 0.03, attack: 4, hp: 2000, wet: 0.25, delay: 120 },
  ],
  signature: () => [
    { wave: 'sine', freq: 330, dur: 500, gain: 0.13, attack: 6, lp: 2200, wet: 0.34, to: 311 },
    { wave: 'noise', freq: 0, dur: 80, gain: 0.03, attack: 3, hp: 1500, wet: 0.2 },
    { wave: 'sine', freq: 440, dur: 700, gain: 0.11, attack: 7, lp: 2000, wet: 0.4, delay: 240 },
  ],
};

// ── 像素街机 · 分辨率轴 ─────────────────────────────────────

/** 大调五声。8-bit 时代的主旋律几乎都是这个 —— 它最容易被「记住」。 */
const PIXEL_SCALE = [0, 2, 4, 7, 9] as const;

/**
 * 像素。
 *
 * 8-bit 的声音有两个物理事实：**方波**、**没有混响**。
 * 所以这一套是本作里唯一「干声」的 —— `decay 0.18s / wet 0.05`。
 * 加一点点混响只是为了让它在手机上不至于刺耳，不是为了空间。
 *
 * 每步是**两个音**：主音 + 22ms 后的高八度。这是 chiptune 的「和音」手法，
 * 一个声道模拟两个声部。每四步跳一个八度（`n % 4 === 3`），
 * 这是老游戏里「过了一小节」的听觉标记。
 */
const PIXEL: ThemeVoice = {
  id: 'pixel',
  name: '像素街机',
  desc: '方波 · 0.18s 干声',
  space: { decay: 0.18, damp: 9000, wet: 0.05 },
  step: (n) => {
    // 基频 659 而不是 523：523 是圆格罗盘的基频，撞了会让两套的
    // 第 1 步听起来是同一个音（虽然音色不同，但第一印象会混）
    const f = scaleAt(659, PIXEL_SCALE, n, 2) * (n % 4 === 3 ? 2 : 1);
    return [
      { wave: 'square', freq: f, dur: 70, gain: 0.11, attack: 1, hp: 320, wet: 0.04 },
      { wave: 'square', freq: f * 2, dur: 40, gain: 0.045, attack: 1, hp: 600, delay: 22, wet: 0.03 },
    ];
  },
  tap: () => [{ wave: 'square', freq: 1319, dur: 26, gain: 0.06, attack: 1, hp: 500, wet: 0.03 }],
  break: () => [
    // 掉命：快速下行的四连音，chip 音乐里最经典的一记
    { wave: 'square', freq: 494, dur: 60, gain: 0.10, attack: 1, hp: 200, wet: 0.04 },
    { wave: 'square', freq: 370, dur: 60, gain: 0.10, attack: 1, hp: 200, delay: 60, wet: 0.04 },
    { wave: 'square', freq: 247, dur: 120, gain: 0.11, attack: 1, hp: 180, delay: 120, wet: 0.04 },
  ],
  win: (perfect) => [
    { wave: 'square', freq: 523, dur: 80, gain: 0.10, attack: 1, hp: 300, wet: 0.05 },
    { wave: 'square', freq: 659, dur: 80, gain: 0.10, attack: 1, hp: 300, delay: 90, wet: 0.05 },
    { wave: 'square', freq: 784, dur: 80, gain: 0.10, attack: 1, hp: 300, delay: 180, wet: 0.05 },
    { wave: 'square', freq: 1046, dur: 220, gain: 0.11, attack: 1, hp: 300, delay: 270, wet: 0.06 },
    // 完美通关多一记「1UP」：两个八度上的一短一长，chip 音乐里的加分音效
    ...(perfect
      ? [{ wave: 'square' as Wave, freq: 2093, dur: 60, gain: 0.06, attack: 1, hp: 500, wet: 0.06, delay: 300 },
         { wave: 'square' as Wave, freq: 2637, dur: 180, gain: 0.06, attack: 1, hp: 500, wet: 0.07, delay: 370 }]
      : []),
  ],
  unlock: () => [
    { wave: 'square', freq: 1046, dur: 60, gain: 0.09, attack: 1, hp: 400, wet: 0.04 },
    { wave: 'square', freq: 1568, dur: 120, gain: 0.08, attack: 1, hp: 400, delay: 70, wet: 0.05 },
  ],
  signature: () => [
    { wave: 'square', freq: 659, dur: 70, gain: 0.10, attack: 1, hp: 300, wet: 0.04 },
    { wave: 'square', freq: 784, dur: 70, gain: 0.10, attack: 1, hp: 300, delay: 80, wet: 0.04 },
    { wave: 'square', freq: 988, dur: 70, gain: 0.09, attack: 1, hp: 300, delay: 160, wet: 0.04 },
    { wave: 'square', freq: 1319, dur: 180, gain: 0.10, attack: 1, hp: 300, delay: 240, wet: 0.05 },
  ],
};

// ── 赛博霓虹 · 平面轴 ───────────────────────────────────────

/** 和声小调。增二度是「未来感」的来源 —— 自然小调太熟悉，五声太温柔。 */
const NEON_SCALE = [0, 2, 3, 5, 7, 8, 11] as const;

/**
 * 赛博。
 *
 * 电子乐器最硬的两个特征：**锯齿波**（谐波全满）和**上扫**（激光）。
 * 所以每一步都是一记 110ms 的上扫 —— 不是「叮」，是「咻」。
 *
 * 起音 1.5ms：电子振荡器是瞬时的，没有「按下去」的过程。
 * 混响 0.7s / 高阻尼：机房、金属墙，短而亮。
 *
 * 第二层是 3 倍频的方波、只有 40ms —— 那是「显示器的高压吱声」，
 * 很轻，但去掉之后整串音会突然变得像玩具电子琴。
 */
const NEON: ThemeVoice = {
  id: 'neon',
  name: '赛博霓虹',
  desc: '锯齿上扫 · 0.7s 机房',
  space: { decay: 0.7, damp: 6500, wet: 0.18 },
  step: (n) => {
    const f = scaleAt(440, NEON_SCALE, n, 1);
    return [
      { wave: 'sawtooth', freq: f * 0.5, to: f, dur: 110, gain: 0.10, attack: 1.5, lp: 2600, wet: 0.16 },
      { wave: 'square', freq: f * 3, dur: 40, gain: 0.028, attack: 1, lp: 5200, delay: 6, wet: 0.10 },
    ];
  },
  tap: () => [{ wave: 'square', freq: 2093, dur: 24, gain: 0.05, attack: 1, lp: 6000, wet: 0.08 }],
  break: () => [
    // 断电：一路下扫 + 一声爆音。赛博的「失败」必须干脆，不能抒情
    { wave: 'sawtooth', freq: 440, to: 40, dur: 260, gain: 0.13, attack: 1, lp: 2200, wet: 0.2 },
    { wave: 'noise', freq: 0, dur: 70, gain: 0.07, attack: 1, hp: 1600, wet: 0.15 },
  ],
  win: (perfect) => [
    { wave: 'sawtooth', freq: 440, to: 880, dur: 160, gain: 0.10, attack: 1, lp: 3000, wet: 0.2 },
    { wave: 'sawtooth', freq: 554, to: 1109, dur: 160, gain: 0.09, attack: 1, lp: 3000, wet: 0.2, delay: 120 },
    { wave: 'sawtooth', freq: 659, to: 1319, dur: 320, gain: 0.10, attack: 1, lp: 3400, wet: 0.24, delay: 240 },
    ...(perfect
      ? [{ wave: 'noise' as Wave, freq: 0, dur: 160, gain: 0.04, attack: 1, hp: 4000, wet: 0.3, delay: 320 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sawtooth', freq: 880, to: 1760, dur: 140, gain: 0.09, attack: 1, lp: 3600, wet: 0.2 },
    { wave: 'square', freq: 2637, dur: 100, gain: 0.04, attack: 1, lp: 6000, delay: 60, wet: 0.2 },
  ],
  signature: () => [
    { wave: 'sawtooth', freq: 220, to: 440, dur: 140, gain: 0.10, attack: 1, lp: 2600, wet: 0.18 },
    { wave: 'sawtooth', freq: 330, to: 660, dur: 140, gain: 0.09, attack: 1, lp: 2800, wet: 0.18, delay: 150 },
    { wave: 'sawtooth', freq: 440, to: 880, dur: 300, gain: 0.09, attack: 1, lp: 3200, wet: 0.22, delay: 300 },
  ],
};

// ── 深海荧光 · 形态轴 ───────────────────────────────────────

/** 全音阶。没有半音、没有主属关系 —— 它「不落地」，正好是漂浮的感觉。 */
const ABYSS_SCALE = [0, 2, 4, 6, 8, 10] as const;

/**
 * 深海。
 *
 * 水下听觉的三件事：**低通**（水吸高频）、**拍频**（两个相近频率互相推挤）、
 * **长尾**（声音在池子里绕）。
 *
 * 所以主音用**两个相差 0.8% 的正弦**叠在一起 —— 这会每分钟产生几次
 * 音量起伏（拍频），听起来像「什么东西在慢慢移动」。
 * 这不是和声，是一个声源被水面搅动。
 *
 * 起音 12ms 是八套里最慢的：水下没有「打击」，只有「涌上来」。
 */
const ABYSS: ThemeVoice = {
  id: 'abyss',
  name: '深海荧光',
  desc: '拍频正弦 · 3.4s 水底',
  space: { decay: 3.4, damp: 2400, wet: 0.55 },
  step: (n) => {
    const f = scaleAt(196, ABYSS_SCALE, n, 1);
    return [
      { wave: 'sine', freq: f, dur: 900, gain: 0.13, attack: 12, lp: 1400, wet: 0.55 },
      // 失谐 0.8%：不是第二个音，是同一个音被水搅动
      { wave: 'sine', freq: f * 1.008, dur: 900, gain: 0.075, attack: 14, lp: 1400, wet: 0.5 },
      { wave: 'noise', freq: 0, dur: 180, gain: 0.018, attack: 20, hp: 180, lp: 620, wet: 0.4 },
    ];
  },
  tap: () => [{ wave: 'noise', freq: 0, dur: 70, gain: 0.04, attack: 8, hp: 300, lp: 1400, wet: 0.3 }],
  break: () => [
    // 气泡破裂：上扫的小正弦 + 一段水声。不是「碎」，是「泄气」
    { wave: 'sine', freq: 320, to: 720, dur: 180, gain: 0.10, attack: 6, lp: 1800, wet: 0.45 },
    { wave: 'noise', freq: 0, dur: 220, gain: 0.05, attack: 10, hp: 240, lp: 900, wet: 0.4 },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 196, dur: 1200, gain: 0.12, attack: 14, lp: 1500, wet: 0.6 },
    { wave: 'sine', freq: 294, dur: 1200, gain: 0.10, attack: 16, lp: 1500, wet: 0.6, delay: 200 },
    { wave: 'sine', freq: 392, dur: 1400, gain: 0.10, attack: 16, lp: 1700, wet: 0.62, delay: 420 },
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 784, dur: 900, gain: 0.035, attack: 12, lp: 2200, wet: 0.65, delay: 600 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 392, dur: 700, gain: 0.10, attack: 10, lp: 1800, wet: 0.5 },
    { wave: 'sine', freq: 588, dur: 900, gain: 0.08, attack: 12, lp: 1800, wet: 0.55, delay: 180 },
  ],
  signature: () => [
    { wave: 'sine', freq: 196, dur: 1100, gain: 0.12, attack: 14, lp: 1400, wet: 0.58 },
    { wave: 'sine', freq: 197.6, dur: 1100, gain: 0.07, attack: 16, lp: 1400, wet: 0.55 },
    { wave: 'sine', freq: 294, dur: 1100, gain: 0.09, attack: 16, lp: 1500, wet: 0.6, delay: 320 },
  ],
};

// ── 金缮瓷盘 · 器物轴 ──────────────────────────────────────

/** 羽调式（A C D E G）。比五声大调「文」一档：小三度的暧昧感，是文人气的来源。 */
const KIN_SCALE = [0, 3, 5, 7, 10] as const;

/**
 * 瓷。
 *
 * 最容易撞的是玻璃（同为「硬而亮的敲击」），所以刻意走另一条路：
 *
 * | | 玻璃穹顶 | 金缮瓷盘 |
 * |---|---|---|
 * | 发声体 | FM 非谐波（3.52 比） | 正弦基频 + **2.76 比**的泛音 |
 * | 长度 | 2.6 秒，大厅 | 1.4 秒，房间 |
 * | 高音 | 一路亮到 12kHz | 阻尼 4.2kHz，亮的只有那一下 |
 *
 * **2.76** 是瓷磬的实测泛音比（不是整数倍）—— 这是「瓷」和「钟」的物理区别，
 * 换成 3.0 或 2.0 立刻变成管钟或木琴。
 *
 * 另外每一下都带 8ms 的噪声：瓷器是「敲」响的，有硬物接触的那一瞬。
 * 去掉它，再准的泛音也只是「电子琴的 sine」。
 */
const KINTSUGI: ThemeVoice = {
  id: 'kintsugi',
  name: '金缮瓷盘',
  desc: '瓷磬 2.76 比 · 1.4s 房间',
  space: { decay: 1.4, damp: 4200, wet: 0.18 },
  step: (n) => {
    const f = scaleAt(587, KIN_SCALE, n, 1);
    return [
      // 瓷体：正弦。三角波太「木」，方波太「电」
      { wave: 'sine', freq: f, dur: 520, gain: 0.115, attack: 1, hp: 180, wet: 0.2 },
      // 2.76 比的泛音：短、亮 —— 这一层决定「这是瓷」
      { wave: 'sine', freq: f * 2.76, dur: 110, gain: 0.032, attack: 1, wet: 0.13 },
      // 敲击的那一瞬
      { wave: 'noise', freq: 0, dur: 8, gain: 0.042, attack: 1, hp: 4200, wet: 0.1 },
    ];
  },
  tap: () => [{ wave: 'noise', freq: 0, dur: 10, gain: 0.038, attack: 1, hp: 5200, wet: 0.07 }],
  break: () => [
    // 瓷盘裂开：一串宽噪 + 裂片下落的高频 + 一记闷响
    { wave: 'noise', freq: 0, dur: 95, gain: 0.075, attack: 1, hp: 2200, lp: 9000, wet: 0.16 },
    { wave: 'sine', freq: 1480, to: 430, dur: 190, gain: 0.048, attack: 1, wet: 0.14 },
    { wave: 'sine', freq: 230, to: 88, dur: 210, gain: 0.052, attack: 2, lp: 620, wet: 0.1 },
  ],
  win: (perfect) => [
    { wave: 'sine', freq: 659, dur: 420, gain: 0.105, attack: 1, wet: 0.24 },
    { wave: 'sine', freq: 880, dur: 420, gain: 0.092, attack: 1, wet: 0.24, delay: 120 },
    { wave: 'sine', freq: 1319, dur: 640, gain: 0.088, attack: 1, wet: 0.26, delay: 240 },
    // 收尾那一记金漆的「叮」：2.76 比的高泛音，很轻
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 1319 * 2.76, dur: 200, gain: 0.026, attack: 1, wet: 0.28, delay: 400 }]
      : []),
  ],
  unlock: () => [
    { wave: 'sine', freq: 880, dur: 200, gain: 0.092, attack: 1, wet: 0.2 },
    { wave: 'noise', freq: 0, dur: 9, gain: 0.035, attack: 1, hp: 4600, wet: 0.1 },
    { wave: 'sine', freq: 1319, dur: 300, gain: 0.07, attack: 1, delay: 80, wet: 0.24 },
  ],
  signature: () => [
    { wave: 'noise', freq: 0, dur: 10, gain: 0.042, attack: 1, hp: 4000, wet: 0.12 },
    { wave: 'sine', freq: 587, dur: 380, gain: 0.10, attack: 1, wet: 0.22 },
    { wave: 'sine', freq: 587 * 2.76, dur: 120, gain: 0.028, attack: 1, wet: 0.14 },
    { wave: 'sine', freq: 988, dur: 300, gain: 0.06, attack: 1, delay: 150, wet: 0.24 },
  ],
};

// ── 秘色天青 ────────────────────────────────────────────────

/** 宫五声。雅乐不需要意外，和金线同一族——但音色把它们分开了。 */
const MISE_SCALE = [0, 2, 4, 7, 9] as const;

/**
 * 秘色天青：瓷的清 + 磬的余。
 *
 * 音色纲和金缮相反：金缮是「瓷磬 2.76 比的暖」，天青是**瓷叩的清脆**——
 * 主能量在中高频，三角波起音 1ms（玻璃的硬），泛音比 1.35 / 1.81
 * （实测青瓷敲击的非谐成分），通关才放一记玉磬的长余韵。
 */
const MISE: ThemeVoice = {
  id: 'mise',
  name: '秘色天青',
  desc: '瓷叩玉磬 · 1.2s 展柜',
  space: { decay: 1.2, damp: 5200, wet: 0.16 },
  step: (n) => {
    const f = scaleAt(784, MISE_SCALE, n, 1);
    return [
      // 瓷体：三角波。正弦太暖（那是金缮的瓷），三角带棱才是「叩」
      { wave: 'triangle', freq: f, dur: 95, gain: 0.105, attack: 1, hp: 220, wet: 0.13 },
      // 非谐泛音两层：1.35 / 1.81 —— 决定「这是青瓷不是玻璃」
      { wave: 'triangle', freq: f * 1.35, dur: 72, gain: 0.034, attack: 1, wet: 0.10 },
      { wave: 'triangle', freq: f * 1.81, dur: 52, gain: 0.021, attack: 1, wet: 0.08 },
      // 叩击的那一瞬
      { wave: 'noise', freq: 0, dur: 8, gain: 0.036, attack: 1, hp: 5200, wet: 0.08 },
    ];
  },
  tap: () => [
    { wave: 'triangle', freq: 1174, dur: 42, gain: 0.052, attack: 1, hp: 300, wet: 0.08 },
    { wave: 'noise', freq: 0, dur: 7, gain: 0.028, attack: 1, hp: 5600, wet: 0.06 },
  ],
  break: () => [
    // 瓷裂：宽噪一记 + 两片碎瓷的下落音
    { wave: 'noise', freq: 0, dur: 80, gain: 0.068, attack: 1, hp: 2600, lp: 9500, wet: 0.14 },
    { wave: 'triangle', freq: 1568, to: 523, dur: 160, gain: 0.044, attack: 1, wet: 0.12 },
    { wave: 'triangle', freq: 2093, to: 784, dur: 120, gain: 0.030, attack: 1, delay: 40, wet: 0.12 },
  ],
  win: (perfect) => [
    // 玉磬余韵：非谐泛音列 1 / 2.76 / 5.4 / 8.93，长衰减是留白
    { wave: 'sine', freq: 524, dur: 1450, gain: 0.115, attack: 1, wet: 0.30 },
    { wave: 'sine', freq: 524 * 2.76, dur: 520, gain: 0.034, attack: 1, wet: 0.24 },
    { wave: 'sine', freq: 524 * 5.4, dur: 260, gain: 0.018, attack: 1, wet: 0.20 },
    // 一气呵成：印落纸 —— 全音色里唯一一记低频
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 110, to: 58, dur: 210, gain: 0.058, attack: 2, lp: 420, wet: 0.12 }]
      : []),
  ],
  unlock: () => [
    // 金石细响：描金笔划过瓷面的一丝亮
    { wave: 'triangle', freq: 1046, dur: 110, gain: 0.062, attack: 1, wet: 0.12 },
    { wave: 'triangle', freq: 1318, dur: 110, gain: 0.058, attack: 1, delay: 70, wet: 0.14 },
    { wave: 'triangle', freq: 1760, dur: 220, gain: 0.052, attack: 1, delay: 140, wet: 0.18 },
    { wave: 'noise', freq: 0, dur: 10, gain: 0.028, attack: 1, hp: 5200, wet: 0.08 },
  ],
  signature: () => [
    // 世界观一秒说完：一叩 + 一磬
    { wave: 'triangle', freq: 784, dur: 95, gain: 0.095, attack: 1, hp: 220, wet: 0.12 },
    { wave: 'noise', freq: 0, dur: 8, gain: 0.032, attack: 1, hp: 5200, wet: 0.08 },
    { wave: 'sine', freq: 524, dur: 700, gain: 0.082, attack: 1, delay: 130, wet: 0.28 },
    { wave: 'sine', freq: 524 * 2.76, dur: 240, gain: 0.022, attack: 1, delay: 130, wet: 0.22 },
  ],
};

// ── 注册表 ─────────────────────────────────────────────────

/** 全部音色。顺序无关，索引靠 `VOICE_MAP`。 */
export const VOICES: readonly ThemeVoice[] = [
  CLAY, MISE, INK, GLASS, PIXEL, ORBIT, NEON, BURN, GILDED, ABYSS, KINTSUGI,
];

const VOICE_MAP = new Map(VOICES.map((v) => [v.id, v]));

/**
 * 按主题 id 取音色。空串 / 未知 id → 经典黏土。
 *
 * **未知 id 不抛错**：这个值来自本地存储，玩家可能装过一个已经下线的主题，
 * 抛错会让整个页面白屏 —— 退化成经典音才是对的。
 */
export function voiceFor(themeId: string | undefined): ThemeVoice {
  if (!themeId) return CLAY;
  return VOICE_MAP.get(themeId) ?? CLAY;
}

/** 是否有专属音色（用于皮肤页标记「这套还带一套音」）。 */
export function hasOwnVoice(themeId: string | undefined): boolean {
  if (!themeId) return false;
  const v = VOICE_MAP.get(themeId);
  return v !== undefined && v.id !== 'clay';
}

/** 供测试与文档使用。 */
export const CLAY_VOICE = CLAY;

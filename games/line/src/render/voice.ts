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
  /**
   * 带通中心频率（Hz）。
   *
   * 给了它就**取代** `hp`/`lp`：砂纸、石屑、掐沙这一族声音的全部性格都在
   * "一条窄带"上。用 hp+lp 夹出来的只是一片宽噪声，听着像"风"，
   * 而它要的是"砂"。
   */
  bp?: number;
  /** 带通扫频终点（Hz）；省略 = 定频 */
  bpTo?: number;
  /**
   * 扫频（`to` / `bpTo`）走完要多久（ms）。省略 = `dur × 0.85`。
   *
   * 绝大多数音里"扫频和包络同步"是对的：砂从指间磨过去，亮度跟着声音一起消失。
   * 但**石章**不是 —— 设计稿 `playStamp` 里
   * `112 → 58` 的扫频 **90ms 就走完**，而增益衰减到 **220ms**。
   *
   * 这两件事本来是分开的：音高"砸下去"是瞬间的（墙被撞了），
   * 余响"收干净"是之后的事（墙在回响）。绑在一起会让低频
   * 一路滑到 58Hz 才收尾，听感变成"一个下滑的长音"，
   * 而设计稿要的是"一记闷响然后静下来"。
   */
  sweep?: number;
  /** 带通 Q（默认 1）。Q 越高越"尖"，4 以上就变成口哨了 */
  q?: number;
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
  /**
   * 无效落子（点石头 / 没钥匙开门 / 逆着单向门走）。
   *
   * 不实现就退化成引擎里的一记通用闷响 —— 这一声必须**比落子低、比断线短**：
   * 它是"不行"，不是"你错了"。断线（break）才是要付代价的那个。
   */
  blocked?(): SoundNote[];
  /**
   * 铺满级联的**每一粒**（通关波次，48ms 一粒）。
   *
   * 设计稿：`cells.forEach((c,i) => setTimeout(() => sfx('grind', 0.35), i*48))`
   * —— 每粒都是「落子」的压缩版，音量压到三分之一。
   * 这一族音色（不实现 = 级联只有画面没有声）只给"东西真的会落下去"的主题：
   * 玻璃不会发出沙粒声，硬加一层就是贴音效。
   */
  settle?(): SoundNote[];
  /**
   * 「一声磬」：铺满末格 / 开局揭幕末格那一下。
   *
   * 和 `win` 分开，因为这两件事只共用**一半**：磬都是同一记玉磬，
   * 但通关还要接"印落纸"。进场不能顺带砸一枚印 —— 那是"结束了"的声音，
   * 而开局恰恰是"开始了"。
   */
  chime?(): SoundNote[];
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

/**
 * 秘色天青：瓷的清 + 磬的余。
 *
 * 音色纲和金缮相反：金缮是「瓷磬 2.76 比的暖」，天青是**瓷叩的清脆**——
 * 主能量在中高频，三角波起音 1ms（玻璃的硬），泛音比 1.35 / 1.81
 * （实测青瓷敲击的非谐成分），通关才放一记玉磬的长余韵。
 */
/**
 * 秘色天青：瓷的清 + 磬的余。
 *
 * ## 五声照 `2026-11-16-秘色天青-图标动效音效.html` 逐条对
 *
 * 那是这一套的**听觉定稿**，五个音各自有明确的频谱纪律：
 *
 * | 声 | 动作 | 配方 |
 * |---|---|---|
 * | 瓷轻叩 | 落子 | tri 2350/3170/4260 **三重泛音** 90ms + 4.2kHz 高通噪点 |
 * | 金石细响 | 连径 | sine 1760/2640/3960/5280 四层 + bp 5.2k Q1.6 |
 * | 玉磬余韵 | 铺满末格 | 524 × 1/2.76/5.40/8.93，1.45s 自然散 |
 * | 印落纸 | 盖印 | sine 110→55 110ms + 520Hz 低通纸声 + 2.4k 摩擦 |
 * | 釉息轻点 | 按钮 | tri 2900 28ms |
 *
 * ## 和旧版差在哪
 *
 * 旧版是"一个音阶往上爬"（scaleAt 784 起，`step` 每步换音高）。
 * 设计稿不要音阶 —— **每次落子都是同一声**，只有频率微抖 ±5%。
 * 这不一样：音阶是"旋律"，瓷叩是"材质"。连走十步时，旋律会变成一段
 * 谁也没写的曲子；而同一声微抖才是"这十下敲的是同一只碗"。
 *
 * 所以 `step` 现在落在**同一个音高**上，靠 `n` 只调一点亮度。
 */
/** 玉磬的四层泛音。`chime` 与 `win` 共用同一记磬 —— 只写一次。 */
const MISE_CHIME: SoundNote[] = [
  { wave: 'sine', freq: 524, dur: 1450, gain: 0.170, attack: 10, wet: 0.30 },
  { wave: 'sine', freq: 524 * 2.76, dur: 950, gain: 0.085, attack: 10, wet: 0.26 },
  { wave: 'sine', freq: 524 * 5.40, dur: 550, gain: 0.045, attack: 8, wet: 0.22 },
  { wave: 'sine', freq: 524 * 8.93, dur: 350, gain: 0.022, attack: 6, wet: 0.20 },
];

const MISE: ThemeVoice = {
  id: 'mise',
  name: '秘色天青',
  desc: '瓷叩玉磬 · 1.2s 展柜',
  space: { decay: 1.2, damp: 5200, wet: 0.16 },
  step: (n) => {
    // 设计稿：2350 / 3170 / 4260 三个**三角波泛音** + 4.2k 以上的噪点。
    // 三次泛音不是谐波（2350×1.35=3172、×1.81=4253）—— 青瓷的实测非谐成分，
    // 整数比会变成"电子琴的哆"，非整数才是"瓷"。
    //
    // `n` 只让第一层微微变亮（每 8 步一个台阶，封顶 4%）：
    // 连击时耳朵要听出"越走越顺"，但不能真的变成旋律。
    const lift = 1 + Math.min(0.04, n * 0.005);
    return [
      { wave: 'triangle', freq: 2350 * lift, dur: 90, gain: 0.13, attack: 2, wet: 0.13 },
      { wave: 'triangle', freq: 3170 * lift, dur: 90, gain: 0.060, attack: 2, wet: 0.12 },
      { wave: 'triangle', freq: 4260 * lift, dur: 90, gain: 0.025, attack: 2, wet: 0.10 },
      // 叩击的接触帧：4.2k 以上的一粒噪点，30ms
      { wave: 'noise', freq: 0, dur: 30, gain: 0.050, attack: 1, hp: 4200, wet: 0.08 },
    ];
  },
  // 按钮：2900Hz 三角波 28ms。两片瓷轻碰的一点声音。
  // **禁止**电子哔声、禁止水滴音 —— 这个音只负责"我收到了"
  tap: () => [{ wave: 'triangle', freq: 2900, dur: 28, gain: 0.12, attack: 1, wet: 0.10 }],
  // 铺满逐粒：瓷叩的 0.3 压缩版（设计稿 `sfx('tap', 0.3)`）
  settle: () => [
    { wave: 'triangle', freq: 2350, dur: 60, gain: 0.042, attack: 2, wet: 0.12 },
    { wave: 'triangle', freq: 3170, dur: 48, gain: 0.020, attack: 2, wet: 0.10 },
    { wave: 'noise', freq: 0, dur: 16, gain: 0.016, attack: 1, hp: 4200, wet: 0.06 },
  ],
  break: () => [
    // 瓷裂：宽噪一记 + 两片碎瓷的下落音
    { wave: 'noise', freq: 0, dur: 80, gain: 0.068, attack: 1, hp: 2600, lp: 9500, wet: 0.14 },
    { wave: 'triangle', freq: 1568, to: 523, dur: 160, gain: 0.044, attack: 1, wet: 0.12 },
    { wave: 'triangle', freq: 2093, to: 784, dur: 120, gain: 0.030, attack: 1, delay: 40, wet: 0.12 },
  ],
  // 撞在墨石上：一记被闷住的低叩，没有余韵。
  // 高频一概不给 —— 高频＝"清脆＝可以" ，而这一下恰恰是"不行"
  blocked: () => [
    { wave: 'triangle', freq: 233, to: 174, dur: 90, gain: 0.058, attack: 1, lp: 900, wet: 0.06 },
    { wave: 'noise', freq: 0, dur: 34, gain: 0.030, attack: 1, lp: 700, wet: 0.05 },
  ],
  /**
   * 通关：玉磬 → 印落纸。
   *
   * 设计稿的两声是**串起来**的（`playChime()` 在 `N*48+120`，`playStamp()`
   * 在落印那一刻，`+175`）。这里用 `delay` 一次排好：
   * 磬在 0，印在 175 —— 与 `drawSealStamp` 的 55% 触底同帧。
   */
  // 玉磬：524Hz 的**非谐泛音钟**（×1 / 2.76 / 5.40 / 8.93）。
  // 四层各自衰减 1.45 / 0.95 / 0.55 / 0.35 —— 高泛音先散，尾巴只剩基音。
  // 「尾音是留白，不加任何和声垫」
  chime: () => MISE_CHIME,
  win: (perfect) => [
    ...MISE_CHIME,
    // 印落纸：110→55Hz 下滑 110ms + 520 低通纸声 + 2.4k 的纸面摩擦。
    // 低频一击收干净，**没有任何欢庆尾音** —— 它是"落款"，不是"胜利"
    { wave: 'sine', freq: 110, to: 55, dur: 300, gain: 0.240, attack: 4, lp: 420, wet: 0.12, delay: 175 },
    { wave: 'noise', freq: 0, dur: 130, gain: 0.140, attack: 2, lp: 520, wet: 0.08, delay: 175 },
    { wave: 'noise', freq: 0, dur: 70, gain: 0.045, attack: 4, hp: 2400, wet: 0.06, delay: 200 },
    // 一气呵成：磬的最高泛音多一记（8.93 那一层加亮），
    // 只改音色不改音高 —— 奖励"干净"不该是另一段旋律
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 524 * 8.93, dur: 420, gain: 0.030, attack: 4, wet: 0.28 }]
      : []),
  ],
  unlock: () => [
    // 金石细响：描金笔划过瓷面的一丝亮（1760 / 2640 / 3960 / 5280 四层 + bp 5.2k）
    { wave: 'sine', freq: 1760, dur: 200, gain: 0.090, attack: 3, wet: 0.14 },
    { wave: 'sine', freq: 2640, dur: 165, gain: 0.055, attack: 3, wet: 0.13 },
    { wave: 'sine', freq: 3960, dur: 130, gain: 0.032, attack: 3, wet: 0.12 },
    { wave: 'sine', freq: 5280, dur: 95, gain: 0.018, attack: 3, wet: 0.11 },
    { wave: 'noise', freq: 0, dur: 220, gain: 0.038, attack: 12, bp: 5200, q: 1.6, wet: 0.10 },
  ],
  signature: () => [
    // 世界观一秒说完：一叩 + 一磬
    { wave: 'triangle', freq: 2350, dur: 90, gain: 0.120, attack: 2, wet: 0.12 },
    { wave: 'triangle', freq: 3170, dur: 80, gain: 0.055, attack: 2, wet: 0.11 },
    { wave: 'noise', freq: 0, dur: 30, gain: 0.045, attack: 1, hp: 4200, wet: 0.08 },
    { wave: 'sine', freq: 524, dur: 700, gain: 0.100, attack: 8, delay: 130, wet: 0.28 },
    { wave: 'sine', freq: 524 * 2.76, dur: 420, gain: 0.050, attack: 8, delay: 130, wet: 0.24 },
  ],
};

// ── 鸣沙丹青 ────────────────────────────────────────────────

/**
 * 羽五声，而且压在低音区。
 *
 * 土埙的调式不能往上跑 —— 一爬八度就变成笛子，"壁"立刻变"竹"。
 * 所以主音取 D3（147），`octaveSpan` 只给一个八度。
 */
const SAND_SCALE = [0, 3, 5, 7, 10] as const;

/**
 * 鸣沙丹青：土的钝 + 石的沉。
 *
 * ## 和天青的关系
 *
 * 同一句话（短促、克制、不拖泥），换掉了**材质**：天青主能量在中高频
 * （瓷是硬的，敲下去有一串亮泛音），这一套把主能量全部压到中低频，
 * 高频只留一点噪声颗粒做"砂"。所以两套放在一起听，是"瓷"和"土"的差别，
 * 而不是"高一点"和"低一点"的差别。
 *
 * ## 五声对应五个动作（照设计稿）
 *
 * | 动作 | 声音 | 做法 |
 * |---|---|---|
 * | 落子 | 矿物研磨 | 带通噪声（hp 780 / lp 2500 夹出中频带）+ 160→95 的三角低钝垫 |
 * | 连径 | 沥粉细响 | 3180 / 4720 双三角 —— 全主题**唯一**允许到 4kHz 以上的声 |
 * | 铺满 | 土埙一记 | 196 正弦 + 194.6 微失谐（气感）+ 极弱二倍频，0.95s |
 * | 盖印 | 石章落壁 | 112→58 一记 + 石屑 + 300Hz 壁体共鸣 |
 * | 按钮 | 掐起一撮沙 | 1150 带通噪声 35ms |
 *
 * 混响是**石壁**：1.6s、阻尼 2600（比展柜暗一档）—— 土墙吸高频，
 * 同一个音高在天青里是"叩在瓷上"，在这里是"砸进墙里"。
 */
const MINGSHA: ThemeVoice = {
  id: 'mingsha',
  name: '鸣沙丹青',
  desc: '土埙石章 · 1.6s 石壁',
  space: { decay: 1.6, damp: 2600, wet: 0.20 },
  step: (n) => {
    const f = scaleAt(147, SAND_SCALE, n, 1);
    return [
      // 矿物研磨：**带通扫落** 2400→850（设计稿 `playGrind`）。
      // 这一条扫频就是全部的性格 —— 砂从指间磨过去，亮度是往下掉的；
      // 用固定 hp+lp 夹出来的"中频带"听着像一阵风，不像砂
      // `sweep: 85` —— 设计稿 `bp.frequency.exponentialRampToValueAtTime(850, t + 0.085)`。
      // 包络 90ms、扫频 85ms：最后 5ms 是尾巴，已经在 850Hz 附近稳住了
      { wave: 'noise', freq: 0, dur: 90, gain: 0.085, attack: 3, bp: 2400, bpTo: 850, q: 1.1, wet: 0.10, sweep: 85 },
      // 低钝垫：160→95 的一记，落地感就靠它（设计稿是同一条三角波）
      // 低钝垫 `160→95 @ +0.07`（设计稿），包络 80ms
      { wave: 'triangle', freq: 160, to: 95, dur: 80, gain: 0.045, attack: 3, lp: 900, wet: 0.08, sweep: 70 },
      // 极轻的一层土音：只为了让"第几步"有反馈，不许变成旋律
      { wave: 'sine', freq: f, dur: 110, gain: 0.018, attack: 4, lp: 1100, wet: 0.10 },
    ];
  },
  tap: () => [
    // 掐起一撮沙：**1150Hz 带通** 35ms（设计稿 `playTap`，Q 1.4）
    { wave: 'noise', freq: 0, dur: 35, gain: 0.042, attack: 2, bp: 1150, q: 1.4, wet: 0.06 },
  ],
  break: () => [
    // 墙皮崩落：一片宽噪 + 一记闷到底的低音。没有"碎瓷"那种高频
    { wave: 'noise', freq: 0, dur: 100, gain: 0.058, attack: 2, hp: 500, lp: 3200, wet: 0.14 },
    { wave: 'triangle', freq: 190, to: 96, dur: 150, gain: 0.048, attack: 2, lp: 700, wet: 0.10 },
  ],
  // 撞在石障上：比落子低、比断线短 —— 是"不行"，不是"你错了"
  blocked: () => [
    { wave: 'triangle', freq: 150, to: 100, dur: 80, gain: 0.052, attack: 2, lp: 560, wet: 0.05 },
    { wave: 'noise', freq: 0, dur: 30, gain: 0.026, attack: 2, lp: 600, wet: 0.05 },
  ],
  // 铺满级联的每一粒：落子那一下的压缩版（设计稿 `sfx('grind', 0.35)`）。
  // **不带音高层** —— 级联是"一盘沙同时落定"，不是一段旋律；
  // 48ms 一粒、每粒 80ms，前后必然叠在一起，叠出来的就是一片沙雨
  settle: () => [
    { wave: 'noise', freq: 0, dur: 80, gain: 0.031, attack: 2, bp: 2600, bpTo: 1000, q: 1.2, wet: 0.06, sweep: 68 },
    { wave: 'triangle', freq: 150, to: 100, dur: 62, gain: 0.016, attack: 2, lp: 720, wet: 0.04 },
  ],
  /**
   * 一记**土埙**（铺满末粒 / 开局揭幕末格）。
   *
   * 天青那一声是玉磬，鸣沙"玉磬位换土埙"（设计稿 TOIL 表原话）——
   * 同一个位置、同一个功能（"东西都落定了"），但换成了这一套的材质。
   * 只给埙，不带石章：石章是"盖住这段路"，那是 `win` 的后半段。
   */
  chime: () => [
    // 196 / 194.6 等幅 —— 1.4Hz 拍频就是"埙的气"
    { wave: 'sine', freq: 196, dur: 950, gain: 0.105, attack: 12, lp: 1400, wet: 0.26 },
    { wave: 'sine', freq: 194.6, dur: 950, gain: 0.100, attack: 14, lp: 1200, wet: 0.26 },
    // 极弱二倍频
    { wave: 'sine', freq: 392.8, dur: 300, gain: 0.014, attack: 8, lp: 1600, wet: 0.20 },
  ],
  win: (perfect) => [
    // 铺满：土埙。**两条正弦等幅**（196 / 194.6）—— 设计稿里它们接在同一个
    // 增益上，1.4Hz 的拍频就是"埙的气"。副音压到一半就拍不起来了
    { wave: 'sine', freq: 196, dur: 950, gain: 0.105, attack: 12, lp: 1400, wet: 0.26 },
    { wave: 'sine', freq: 194.6, dur: 950, gain: 0.100, attack: 14, lp: 1200, wet: 0.26 },
    // 二倍频极弱（设计稿 0.05 的支路）
    { wave: 'sine', freq: 392.8, dur: 300, gain: 0.014, attack: 8, lp: 1600, wet: 0.20 },
    // 620Hz 低通气声（见 `chime` 的说明）—— 没有它这声是电子音，不是埙
    { wave: 'noise', freq: 0, dur: 700, gain: 0.020, attack: 10, lp: 620, wet: 0.16 },
    // 盖印：石章落壁。112→58 一记 + 石屑带通 + 300Hz 壁体共鸣，收得干干净净。
    //
    // 175 而不是 130：这一声必须落在**印砸到墙上的那一帧**。石章 320ms 的
    // 落体在 55%（176ms）触底（见 `drawSealStamp`），墙体抖动也定在 175 ——
    // 早 45ms 会被读成"印还没落稳就响了"
    // `sweep: 90` —— 设计稿 `playStamp` 的 `112→58Hz exponentialRamp @ +0.09`。
    // 不写 sweep 时扫频会跟着包络走 187ms（220×0.85），听感变成"下滑的长音"；
    // 90ms 才是"砸下去"——音高瞬间到底，之后 220ms 只是余响在散。
    { wave: 'sine', freq: 112, to: 58, dur: 220, gain: 0.075, attack: 3, lp: 420, wet: 0.12, delay: 175, sweep: 90 },
    // 石屑 `1400→420 @ +0.12`（设计稿），包络 160ms
    { wave: 'noise', freq: 0, dur: 160, gain: 0.040, attack: 3, bp: 1400, bpTo: 420, q: 0.9, wet: 0.10, delay: 175, sweep: 120 },
    { wave: 'noise', freq: 0, dur: 300, gain: 0.026, attack: 4, lp: 300, wet: 0.14, delay: 181 },
    // 一气呵成：多一记高八度的土音，只多这一层
    ...(perfect
      ? [{ wave: 'sine' as Wave, freq: 392, dur: 420, gain: 0.026, attack: 6, lp: 1600, wet: 0.22, delay: 300 }]
      : []),
  ],
  unlock: () => [
    // 连径 · 沥粉细响：金泥从笔尖挤出来的一丝亮（全主题唯一允许的 4kHz 以上）
    //
    // 三个数值照设计稿 `playGilt` 逐个对：
    // - 3180 主音 `exponentialRampTo 0.001 @ +55ms`，但 `o.stop(t + 70)` ——
    //   设计稿是"衰减到 55、振膜留到 70"，这里 60 是折中（见下）
    // - 4720 副音同样 55ms，**晚 12ms 起**（`o.start(t + i*0.012)`）——
    //   这一错峰是"挤压"的读法：两片金箔不是同时亮，是被一起挤出来的
    // - 高通噪 `hp 5200` 的增益衰减到 **75ms**（`exponentialRampTo 0.001 @ +0.075`），
    //   早先写 24ms —— 短到在手机扬声器上只剩一声"嗒"，那一丝"亮"就没了
    { wave: 'triangle', freq: 3180, dur: 60, gain: 0.030, attack: 1, wet: 0.10 },
    { wave: 'triangle', freq: 4720, dur: 55, gain: 0.020, attack: 1, delay: 12, wet: 0.10 },
    { wave: 'noise', freq: 0, dur: 75, gain: 0.016, attack: 1, hp: 5200, wet: 0.06, delay: 2 },
  ],
  signature: () => [
    // 世界观一秒说完：一磨 + 一埙
    { wave: 'noise', freq: 0, dur: 90, gain: 0.080, attack: 2, bp: 2400, bpTo: 850, q: 1.1, wet: 0.10 },
    { wave: 'triangle', freq: 160, to: 95, dur: 80, gain: 0.044, attack: 3, lp: 900, wet: 0.08 },
    { wave: 'sine', freq: 196, dur: 560, gain: 0.085, attack: 10, lp: 1400, wet: 0.24, delay: 130 },
  ],
};

// ── 注册表 ─────────────────────────────────────────────────

/** 全部音色。顺序无关，索引靠 `VOICE_MAP`。 */
export const VOICES: readonly ThemeVoice[] = [
  CLAY, MISE, MINGSHA, INK, GLASS, PIXEL, ORBIT, NEON, BURN, GILDED, ABYSS, KINTSUGI,
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

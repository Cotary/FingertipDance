/**
 * 音色自检：在真浏览器里用 `OfflineAudioContext` 把合成结果**算出来**。
 *
 * ## 为什么必须有这个
 *
 * 单测能验「音符数据合法」「振荡器 start 了」，但验不了**到底有没有声音**：
 * 节点连错、混响总线没接上、增益被别处压成 0 —— 这些在 WebAudio 里
 * 大多是静默失败，页面不报错、控制台干净，只是没声。
 * 而「没声」在开发机上用音箱听，很容易被「是不是系统静音了」糊过去。
 *
 * 这里改用离线渲染：把引擎接到 `OfflineAudioContext` 上渲染 2.8 秒，直接读采样。
 *
 * ## 为什么要 `?v=` 分开跑
 *
 * 一次性跑七次渲染（五套 + 混响 + 静音）要好几秒真实 CPU。
 * headless Chrome 的 `--virtual-time-budget` 是**虚拟**时间，跑完预算就退出，
 * 会把还没算完的结果截断成 `running…`（踩过）。所以每套单独开一次页面：
 *
 * ```bash
 * for v in clay glass orbit obsidian gilded; do
 *   chrome --headless=new --dump-dom ".../audio-check.html?v=$v"
 * done
 * ```
 *
 * 三个指标：
 * - **peak**：有没有出声，以及有没有削波（到 1.0 就是爆了）
 * - **rms**：响度够不够（太小 = 手机外放听不见）
 * - **zcr**：过零率，客观的亮度读数。四套之间应当明显不同 ——
 *   如果四套读出来一样，说明 `setVoice` 根本没生效
 */
import { Audio } from '../src/render/audio';
import { VOICES } from '../src/render/voice';

const RATE = 44100;
// 1.4 秒够听到起音 + 一半衰减。
// 别往长里调：headless 的离线渲染是真实 CPU，节点一多就会卡在
// `startRendering()` 上不返回（实测玻璃 / 金线在 2.8s × 6 个音时 5/5 卡死，
// 降到 1.4s × 3 个音就稳定）。这只影响自检，不影响真机。
const DUR = Number(new URLSearchParams(location.search).get('dur') ?? 1.4);

const which = new URLSearchParams(location.search).get('v') ?? 'clay';

/** 渲染一次调用所需的那段音频。 */
async function render(id: string, mute: boolean): Promise<{ peak: number; rms: number; zcr: number }> {
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * DUR), RATE);

  // **把卷积换成直通**。
  //
  // 实测：headless Chrome 的 `OfflineAudioContext` 只要图上挂了 `ConvolverNode`，
  // `startRendering()` 就永不 resolve（同一个图去掉卷积秒过，与时长无关）。
  // 这是环境限制，不是引擎的问题 —— 所以自检只验**干声**出没出来，
  // 湿声（混响总线）的连接关系由 `test/voice.test.ts` 的假 ctx 保证。
  (offline as unknown as { createConvolver: () => AudioNode }).createConvolver = () =>
    offline.createGain();

  // 引擎的 `ensure()` 走 `new window.AudioContext()`，把它指向离线上下文
  (window as unknown as { AudioContext: unknown }).AudioContext = function () {
    return offline;
  };

  const a = new Audio();
  a.setVoice(id);
  if (mute) a.setEnabled(false);
  // 连点几格：比单音更接近实战的叠加情况（也就是最容易削波的情况）
  const q = new URLSearchParams(location.search);
  // 默认 2 个音：金线每步 2~3 个音 + 900ms 长尾，叠到 3 步就会把 headless
  // 的离线渲染（真实 CPU）压过超时线。2 个音已经足够证明「出声 + 音色对」。
  const n = Number(q.get('n') ?? 2);
  for (let i = 0; i < n; i++) a.light();
  // 默认**不加通关琶音**：四音同时起振是最重的一帧，headless 的离线渲染会超时
  // （实测只有金线会挂）。要一起验就加 `?nowin=0`。
  if (q.get('nowin') === '0') a.win(true);

  mark(`${id} 建图完成，开始渲染`);
  const buf = await offline.startRendering();
  mark(`${id} 渲染完成，读采样`);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);

  let peak = 0;
  let sum = 0;
  for (let i = 0; i < l.length; i++) {
    const v = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (v > peak) peak = v;
    sum += v * v;
  }

  // 过零率：客观的「亮度」读数。四套的基频区间差得远，
  // 这个数能挡掉「以为是换了音色，其实只换了音高」之外的另一种错 ——
  // 四套渲染出来一模一样（比如 setVoice 根本没生效）。
  let zc = 0;
  for (let i = 1; i < l.length; i++) if ((l[i] < 0) !== (l[i - 1] < 0)) zc += 1;

  return {
    peak,
    rms: Math.sqrt(sum / l.length),
    zcr: zc / (l.length / RATE),
  };
}

const el = document.getElementById('out');
const mark = (t: string): void => { if (el) el.textContent = t; };

/** 跑一次并输出一行结论。 */
async function run(): Promise<string> {
  if (which === 'mute') {
    const s = await render('glass', true);
    return `${s.peak < 1e-6 ? 'ok  ' : 'FAIL'} 静音 peak=${s.peak.toExponential(2)}`;
  }
  const known = VOICES.some((v) => v.id === which);
  if (!known) {
    return `FAIL 未知音色 ${which}；可用：${VOICES.map((v) => v.id).join(', ')}、mute`;
  }
  const s = await render(which, false);
  // 削波线：peak 到 1.0 说明已经爆了
  const ok = s.peak > 0.02 && s.peak <= 1.0 && s.rms > 0.002;
  return (
    `${ok ? 'ok  ' : 'FAIL'} ${which.padEnd(9)} peak=${s.peak.toFixed(3)} ` +
    `rms=${s.rms.toFixed(4)} zcr=${Math.round(s.zcr)}Hz`
  );
}

try {
  mark(await run());
} catch (e) {
  mark(`EXC ${e instanceof Error ? e.message : String(e)}`);
}

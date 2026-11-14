/**
 * 移动端适配探针：在指定设备尺寸下打开游戏，读回真实几何数据。
 *
 * 想知道的事：
 *   1. 设计稿 750×1334 在目标屏幕上被缩放到多少（等比 contain 会留黑边）
 *   2. 画布上「有内容的区域」占屏幕多少 → 也就是上下/左右留白多少
 *   3. 关键可点元素的实际 CSS 尺寸（触控目标是否 ≥44px）
 *
 * 为什么不在页面里读 `viewport`：它是模块作用域变量，外部拿不到。
 * 所以改为直接读 canvas 像素 —— 没被绘制的地方 alpha=0。
 *
 * 用法：node tools/probe-mobile.mjs [width] [height] [dpr]
 */
import { spawn } from 'node:child_process';

const [, , wArg = '390', hArg = '844', dprArg = '3'] = process.argv;
const width = Number(wArg);
const height = Number(hArg);
const dpr = Number(dprArg);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const URL_GAME = 'http://127.0.0.1:50002/';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:/Users/Tupss/AppData/Local/Temp/probe-${Date.now()}`,
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* 等 */ }
    await sleep(100);
  }
  throw new Error('CDP 未就绪');
}

const PROBE = `(() => {
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const at = (x, y) => {
    const d = ctx.getImageData(Math.min(x, W - 1), Math.min(y, H - 1), 1, 1).data;
    return d[3];
  };
  // 从四边向内找第一个 alpha>0 的位置 → 内容边界
  const step = 1;
  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < H; y += step) { if (at(Math.floor(W / 2), y) > 0) { top = y; break; } }
  for (let y = H - 1; y >= 0; y -= step) { if (at(Math.floor(W / 2), y) > 0) { bottom = y; break; } }
  for (let x = 0; x < W; x += step) { if (at(x, Math.floor(H / 2)) > 0) { left = x; break; } }
  for (let x = W - 1; x >= 0; x -= step) { if (at(x, Math.floor(H / 2)) > 0) { right = x; break; } }
  const prof = [];
  for (let i = 0; i <= 20; i++) {
    const x = Math.round((W - 1) * i / 20);
    prof.push([i * 5, at(x, Math.floor(H / 2))]);
  }
  return JSON.stringify({
    screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    canvas: { w: W, h: H },
    cssToDev: W / innerWidth,
    contentDev: { top, bottom, left, right },
    contentCss: {
      top: +(top / (W / innerWidth)).toFixed(1),
      bottom: +((H - 1 - bottom) / (W / innerWidth)).toFixed(1),
      left: +(left / (W / innerWidth)).toFixed(1),
      right: +((W - 1 - right) / (W / innerWidth)).toFixed(1),
    },
    // 横向 alpha 轮廓：每 5% 取一处，验证「空白边」到底有没有被画过
    profile: prof,
  });
})()`;

async function main() {
  await wsUrl();
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
  await send('Page.navigate', { url: URL_GAME });
  await sleep(4000);

  const r = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  const data = JSON.parse(r.result.value);
  const pad = data.contentCss;
  const shownH = height - pad.top - pad.bottom;
  const shownW = width - pad.left - pad.right;
  console.log(JSON.stringify({
    ...data,
    fill: {
      widthPct: +((shownW / width) * 100).toFixed(1),
      heightPct: +((shownH / height) * 100).toFixed(1),
    },
  }, null, 2));

  ws.close();
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => { await sleep(200); chrome.kill(); process.exit(process.exitCode ?? 0); });

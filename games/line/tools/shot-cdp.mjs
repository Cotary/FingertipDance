/**
 * 用 Chrome DevTools Protocol 截图。
 *
 * ## 为什么不用 `chrome --screenshot`
 *
 * `--screenshot` 在 load 事件就拍，而游戏是 canvas + 常驻 requestAnimationFrame，
 * 第一帧往往还没画出来，拍到的只是一层背景渐变。
 * 加 `--virtual-time-budget` 本该等一会儿，但页面里 rAF 一直在排帧，虚拟时钟
 * 永远等不到 idle，进程直接挂住不退出。
 *
 * 所以走 CDP：真实时间 sleep 一段时间，再 Page.captureScreenshot。
 *
 * 用法：
 *   node tools/shot-cdp.mjs <url> <out.png> [waitMs] [width] [height] [scale]
 *   node tools/shot-cdp.mjs http://127.0.0.1:50002/ out/shots/a.png 4000 750 1334 2
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , url, out, waitArg = '4000', wArg = '750', hArg = '1334', dprArg = '2'] = process.argv;
if (!url || !out) {
  console.error('usage: node tools/shot-cdp.mjs <url> <out.png> [waitMs] [width] [height] [dpr]');
  process.exit(2);
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333 + Math.floor(Math.random() * 400);
const waitMs = Number(waitArg);
const width = Number(wArg);
const height = Number(hArg);
const dpr = Number(dprArg);

const userDir = `C:/Users/Tupss/AppData/Local/Temp/cdp-shot-${Date.now()}`;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 CDP 端口起来。 */
async function targetUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const v = await res.json();
        return v.webSocketDebuggerUrl;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(100);
  }
  throw new Error('CDP 端口没有响应');
}

async function main() {
  const wsUrl = await targetUrl();

  // 新建一个页面而不是复用 about:blank，避免拿到不稳定的 target
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  // 收集页面异常与 console.error。
  //
  // 截图拍到一片空白时，最常见的原因不是「没渲染」而是**运行时抛异常**——
  // 而 CDP 截图本身不会告诉我们。这两类事件默认不订阅，
  // 一旦订阅就能在 stderr 看到真实原因，省掉一轮「猜是不是加载慢」。
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push(`[exception] ${d.text} ${d.exception?.description ?? ''}`.slice(0, 400));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      pageErrors.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400));
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  // 在页面脚本之前注入错误收集。
  //
  // `Runtime.exceptionThrown` 抓不到 **未处理的 Promise 拒绝**（例如 `void boot()` 里
  // 抛错），而那正是「画面停在背景、控制台干干净净」的典型成因。
  // 这里在最早期挂两个监听，把原因记到 `window.__errs`，供 `EVAL` 读取。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs = [];
      window.__logs = [];
      addEventListener('error', (e) => window.__errs.push('error: ' + (e.message || '') + ' @ ' + (e.filename || '')));
      addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        window.__errs.push('rejection: ' + ((r && (r.stack || r.message)) || String(r)));
      });
      // 全量转发 console：只看 error 时，「点了没反应」这类静默失败完全看不见
      for (const lv of ['log', 'info', 'warn', 'debug']) {
        const orig = console[lv].bind(console);
        console[lv] = (...a) => { try { window.__logs.push(lv + ': ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); } catch {} orig(...a); };
      }`,
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(waitMs);

  // 可选：在页面里求值一段表达式，用来诊断「画面为什么是空的」。
  //   EVAL="JSON.stringify({w:document.querySelector('canvas')?.width})" node tools/shot-cdp.mjs ...
  if (process.env.EVAL) {
    const r = await send('Runtime.evaluate', {
      expression: process.env.EVAL,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log('EVAL', JSON.stringify(r.result?.value ?? r.result?.description ?? r.exceptionDetails));
  }

  // 可选：打印真实 CSS 视口尺寸。
  // headless 的 `--window-size` 会被系统缩放改写，猜坐标前先看这里的数。
  if (process.env.PRINT) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, cw: document.querySelector("canvas")?.width, ch: document.querySelector("canvas")?.height })',
      returnByValue: true,
    });
    console.log('viewport', r.result.value);
  }

  // 可选：先点一下再拍（用 CSS 像素坐标），用来进关卡 / 切 Tab。
  //   TAP="195,623" node tools/shot-cdp.mjs ...
  const tap = process.env.TAP;
  if (tap) {
    // 支持多次点击：TAP="195,657;195,430"
    for (const pair of tap.split(';')) {
      const [tx, ty] = pair.split(',').map(Number);
      if (Number.isNaN(tx)) continue;
      // 用触摸事件而不是鼠标事件：Canvas 上绑的是 pointerdown/up，
      // 而 touchStart 在 Chrome 里会合成 pointer 事件（pointerType=touch），
      // 更接近真机路径；鼠标事件在某些页面状态下会被合成器吞掉。
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
      await sleep(90);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(Number(process.env.TAP_WAIT ?? 1200));
    }
    // 最后一次点击之后的额外等待：进关卡要等接口回来，
    // 而中间几次点击只需要一帧。用 TAP_WAIT 统一设成 13 秒会让整条链路白白多等半分钟。
    if (process.env.AFTER_TAP) await sleep(Number(process.env.AFTER_TAP));
  }

  // 可选：用 `Runtime.evaluate` 直接在 canvas 上派发 PointerEvent。
  //   TAPJS="195,614;195,430" node tools/shot-cdp.mjs ...
  // 与 TAP 的区别：TAP 走 CDP 的合成触摸/鼠标，跨进程时可能被吞；
  // TAPJS 走页面内 dispatchEvent，用来区分「坐标错」和「事件没到」。
  const tapJs = process.env.TAPJS;
  if (tapJs) {
    for (const pair of tapJs.split(';')) {
      const [tx, ty] = pair.split(',').map(Number);
      if (Number.isNaN(tx)) continue;
      await send('Runtime.evaluate', {
        expression: `(() => {
          const c = document.querySelector('canvas');
          if (!c) return 'no canvas';
          const mk = (t) => new PointerEvent(t, {
            clientX: ${tx}, clientY: ${ty}, bubbles: true, cancelable: true,
            pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: t === 'pointerdown' ? 1 : 0,
          });
          c.dispatchEvent(mk('pointerdown'));
          c.dispatchEvent(mk('pointerup'));
          return 'ok';
        })()`,
        returnByValue: true,
      }).then((r) => {
        if (process.env.LOG) console.log('tap', tx, ty, '->', r.result?.value ?? r.exceptionDetails?.text ?? '?');
      });
      await sleep(Number(process.env.TAP_WAIT ?? 1200));
    }
  }

  // 可选：模拟一次连续拖动（一串 CSS 坐标，逗号分隔），用来验证划格交互。
  //   DRAG="55,293,120,293,185,293" node tools/shot-cdp.mjs ...
  const drag = process.env.DRAG;
  if (drag) {
    const pts = drag.split(',').map(Number);
    const first = { x: pts[0], y: pts[1] };
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: first.x, y: first.y, button: 'left', buttons: 1, clickCount: 1,
    });
    for (let i = 2; i < pts.length; i += 2) {
      const tx = pts[i];
      const ty = pts[i + 1];
      if (tx === undefined || ty === undefined) break;
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: tx, y: ty, button: 'left', buttons: 1,
      });
      await sleep(60);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: pts[pts.length - 2], y: pts[pts.length - 1], button: 'left', buttons: 0, clickCount: 1,
    });
    // 通关有约 1.2 秒的波次动画，结算页还没出来就拍会拍到一半
    await sleep(Number(process.env.AFTER_DRAG ?? 600));
  }

  // 可选：只截某一块（CSS 像素 `x,y,w,h`）。
  // 设计稿一页摆着七台手机，整页截图在小内存机器上会把渲染进程拍崩；
  // 只截一台就是 375×812，稳得多。
  //   CLIP="1022,803,375,812" node tools/shot-cdp.mjs ...
  const clip = process.env.CLIP;
  const clipArg = clip
    ? (([x, y, cw, ch]) => ({ x, y, width: cw, height: ch, scale: dpr }))(clip.split(',').map(Number))
    : undefined;
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !!clipArg,
    ...(clipArg ? { clip: clipArg } : {}),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  if (process.env.LOG) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__logs || [])',
      returnByValue: true,
    });
    const logs = JSON.parse(r.result?.value || '[]');
    console.log('--- page logs ---');
    for (const l of logs) console.log(l);
    console.log('--- end logs ---');
    const er = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__errs || [])', returnByValue: true });
    const errs = JSON.parse(er.result?.value || '[]');
    if (errs.length) {
      console.log('--- page errors ---');
      for (const e of errs) console.log(e);
      console.log('--- end errors ---');
    }
  }

  console.log(`saved ${out}`);
  if (pageErrors.length) console.error(`PAGE ERRORS:\n${pageErrors.join('\n')}`);

  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(200);
    chrome.kill();
    process.exit(process.exitCode ?? 0);
  });

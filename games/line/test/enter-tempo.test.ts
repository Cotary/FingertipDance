/**
 * 进场揭幕的**音画共用排期**（`enterTempo` / `enterCellDelay`）。
 *
 * 这个文件锁的是一个真实踩过的坑：`main.armEnterCue` 早先自己抄了一套
 * 「锯齿扫掠」公式（`(w−1)·step + (h−1)·(w·step+row)`），和画面的行序模型
 * 对不上 —— 8×8 天青盘上玉磬比落定晚 825ms、逐格音比画面多跑 1.3s，
 * 玩家看到的是"动画完了音效还没结束"。
 *
 * 修复是把排期收敛到 kit 的一份实现（音画同源）。这里的断言因此不测
 * "某个数对不对"，而是测**模型不变量**：谁再把公式抄歪、或把音画拆回两套，
 * 下面就会红。
 */
import { describe, it, expect } from 'vitest';
import { enterTempo, enterCellDelay, enterTotalMs, enterSettleDelays } from '../src/render/themes/kit';

/** 两套有进场语言的主题的 `enter` 参数（照 `mise.ts` / `mingsha.ts`）。 */
const MISE = { ms: 420, step: 45, row: 120, sweep: 2400 };
const MINGSHA = { ms: 420, step: 30, row: 220, sweep: 2400 };

const BOARDS: Array<[number, number]> = [
  [5, 5],
  [6, 6],
  [8, 8],
  [9, 9],
  [11, 11],
  [3, 15],
];

describe('enterTempo / enterCellDelay', () => {
  it('末格落定时刻 = enterTotalMs（音画收尾就按这个点排）', () => {
    for (const en of [MISE, MINGSHA]) {
      for (const [w, h] of BOARDS) {
        const { ms } = enterTempo(en, w, h);
        const lastLand = enterCellDelay(en, w - 1, h - 1, w, h) + ms;
        expect(lastLand).toBe(enterTotalMs(en, w, h));
      }
    }
  });

  it('行序模型：delay = (x·step + y·row)·k —— 不是锯齿扫掠', () => {
    // 锯齿版（历史 bug）是 `(w−1)·step + (h−1)·(w·step+row)`：
    // 每行要等上一行整行走完。行序版行距**不乘行内格数**。
    const en = MINGSHA;
    const [w, h] = [5, 8];
    const { k } = enterTempo(en, w, h);
    // 未压缩时 k=1：直接对齐设计稿的 `start = r*ROW_GAP + c*CHIP_STAGGER`
    expect(k).toBe(1);
    expect(enterCellDelay(en, 3, 2, w, h)).toBe(2 * 220 + 3 * 30);
  });

  it('大盘封顶：扫掠压缩后的 total 不越过 sweep', () => {
    for (const en of [MISE, MINGSHA]) {
      const total = enterTotalMs(en, 30, 30);
      expect(total).toBeLessThanOrEqual(en.sweep);
      // 封顶时末格落定仍等于 total（压缩比 k 作用在起步时刻上）
      const { ms } = enterTempo(en, 30, 30);
      expect(enterCellDelay(en, 29, 29, 30, 30) + ms).toBe(total);
    }
  });

  it('每格落定时刻单调不越界：最早 ≥ ms，最晚 = total', () => {
    for (const en of [MISE, MINGSHA]) {
      for (const [w, h] of BOARDS) {
        const { ms, total } = enterTempo(en, w, h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const land = enterCellDelay(en, x, y, w, h) + ms;
            expect(land).toBeGreaterThanOrEqual(ms);
            expect(land).toBeLessThanOrEqual(total);
          }
        }
      }
    }
  });

  it('sweep 压缩的是**扫掠**预算（扣掉落定段），不是拿 sweep 压整个 sweep0', () => {
    // 历史 bug 之二：`k = sweep / sweep0`，落定段没算进预算。
    // 正确的是 `k = (sweep − ms) / sweep0` —— 20×20 的盘两种算法差出几百毫秒。
    const en = MISE;
    const w = 20;
    const h = 20;
    const { k, ms, total } = enterTempo(en, w, h);
    const sweep0 = (w - 1) * en.step + (h - 1) * en.row;
    expect(k).toBeCloseTo((en.sweep - ms) / sweep0, 10);
    expect(total).toBe(en.sweep); // 预算耗尽时恰好封顶
  });
});

describe('enterSettleDelays（逐格音时刻表）', () => {
  it('最后一粒 = 末格落定 = enterTotalMs —— 沙雨和画面同帧收尾', () => {
    for (const en of [MISE, MINGSHA]) {
      for (const [w, h] of BOARDS) {
        const d = enterSettleDelays(en, w, h);
        expect(d).toHaveLength(w * h);
        expect(Math.max(...d)).toBe(enterTotalMs(en, w, h));
        // 最早一格也不该在 0：每格要落 `ms` 才算落定
        expect(Math.min(...d)).toBeGreaterThanOrEqual(enterTempo(en, w, h).ms);
      }
    }
  });

  it('VOID 格不排音（不画的格子没有落定这一声）', () => {
    const en = MISE;
    const [w, h] = [4, 4];
    const voids = new Set([0, 3, 12]); // 三格挖空
    const d = enterSettleDelays(en, w, h, (x, y) => voids.has(y * w + x));
    expect(d).toHaveLength(w * h - voids.size);
    // 挖掉的是最先落的那几格：最大值（末格）不变
    expect(Math.max(...d)).toBe(enterTotalMs(en, w, h));
  });

  it('行优先排期：行内 30ms 一跳，换行是 row − (w−1)·step', () => {
    const en = MINGSHA;
    const [w, h] = [5, 5];
    const d = enterSettleDelays(en, w, h);
    const jumps = d.slice(1).map((v, i) => v - d[i]);
    // 行内跳 step
    expect(jumps[0]).toBe(en.step);
    // 换行：上行末格 → 下行首格 = row − (w−1)·step（不是 row 本身！）
    // 5×5 上 = 220 − 120 = 100ms
    expect(jumps[w - 1]).toBe(en.row - (w - 1) * en.step);
  });

  it('行间距**不乘行内格数**（历史 bug 就错在这里）', () => {
    // 锯齿版换行是 `row + step`（还要等上一行整行走完加行距），
    // 行序版是 `row − (w−1)·step`。宽盘上两者差别巨大 ——
    // 5 宽差 90ms，9 宽差 240ms，这就是"音比画慢一截"的来源。
    const en = MINGSHA;
    for (const w of [5, 8, 9]) {
      const d = enterSettleDelays(en, w, w);
      const jump = d[w] - d[w - 1];
      // 大盘（9×9）会触发 sweep 压缩，跳跃要乘同一个 k
      const { k } = enterTempo(en, w, w);
      expect(jump).toBeCloseTo((en.row - (w - 1) * en.step) * k, 6);
    }
  });

  it('宽盘上行与行会交叠（相邻行错峰小于行内跨度）—— 这是模型本身，不是 bug', () => {
    // `(w−1)·step > row` 时下一行首格比上一行末格起得早，两行同时在落。
    // 画面用同一个公式，所以音画仍然同步；锁住它只是防止有人
    // "顺手把排期改成行不交叠"，那会让声音和画面分家。
    const en = MINGSHA;
    const w = 12;
    const d = enterSettleDelays(en, w, 3);
    expect((w - 1) * en.step).toBeGreaterThan(en.row);
    expect(d[w]).toBeLessThan(d[w - 1]);
  });
});

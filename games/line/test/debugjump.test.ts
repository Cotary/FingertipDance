/**
 * 调试面板的输入状态机。
 *
 * 这段逻辑的坑都集中在边界上：预填值要不要被第一次输入替换、
 * 越界的那一下是拒绝还是先填进去、退格删一位还是清一段、步进怎么夹紧。
 * 手点验证只能覆盖「我恰好想到的那几条路径」，所以全部钉成用例。
 */
import { describe, it, expect } from 'vitest';
import { applyDebugJumpInput, createDebugJumpState, type DebugJumpState } from '../src/ui/debugjump';

const TOTAL = 1000;
const CUR = 1;

/** 建一个「刚打开」的面板：预填当前关、标记 fresh。 */
function opened(): DebugJumpState {
  const st = createDebugJumpState();
  st.open = true;
  st.input = String(CUR);
  st.fresh = true;
  return st;
}

/** 依次按下一串键。 */
function press(st: DebugJumpState, ids: string[]): void {
  for (const id of ids) applyDebugJumpInput(st, id, TOTAL, CUR);
}

describe('调试面板 · 输入', () => {
  it('初始状态是关闭、无输入', () => {
    const st = createDebugJumpState();
    expect(st.open).toBe(false);
    expect(st.input).toBe('');
    expect(st.fresh).toBe(false);
  });

  it('预填值上第一次敲数字 = 整段替换，而不是往后接', () => {
    const st = opened();
    press(st, ['dj:d:7']);
    expect(st.input).toBe('7');
    expect(st.fresh).toBe(false);

    press(st, ['dj:d:1']);
    expect(st.input).toBe('71');
  });

  it('输入 705 得到 705（不是 1705）', () => {
    const st = opened();
    press(st, ['dj:d:7', 'dj:d:0', 'dj:d:5']);
    expect(st.input).toBe('705');
  });

  it('越界的那一下被拒绝，输入保持不变，并给出提示', () => {
    const st = opened();
    press(st, ['dj:d:9', 'dj:d:9', 'dj:d:9']);   // 999
    expect(st.input).toBe('999');

    press(st, ['dj:d:9']);                        // 9999 > 1000
    expect(st.input).toBe('999');
    expect(st.note).toContain('1000');

    press(st, ['dj:d:0']);                        // 9990 也不行
    expect(st.input).toBe('999');
  });

  it('能以 1000 结尾：先输 100 再按 0 是合法的', () => {
    const st = opened();
    press(st, ['dj:d:1', 'dj:d:0', 'dj:d:0', 'dj:d:0']);
    expect(st.input).toBe('1000');
  });

  it('空输入时按 0 无效（关号从 1 开始）', () => {
    const st = createDebugJumpState();
    applyDebugJumpInput(st, 'dj:d:0', TOTAL, CUR);
    expect(st.input).toBe('');
  });

  it('预填值上按退格 = 清掉整段；已输入时按退格 = 退一位', () => {
    const st = opened();
    applyDebugJumpInput(st, 'dj:back', TOTAL, CUR);
    expect(st.input).toBe('');

    press(st, ['dj:d:7', 'dj:d:0']);
    expect(st.input).toBe('70');
    applyDebugJumpInput(st, 'dj:back', TOTAL, CUR);
    expect(st.input).toBe('7');
  });

  it('清空清掉输入但不关面板', () => {
    const st = opened();
    press(st, ['dj:d:5']);
    applyDebugJumpInput(st, 'dj:clear', TOTAL, CUR);
    expect(st.input).toBe('');
    expect(st.open).toBe(true);
  });

  it('世界胶囊直接填该世界起始关', () => {
    const st = opened();
    applyDebugJumpInput(st, 'dj:w:65', TOTAL, CUR);   // 熔炉
    expect(st.input).toBe('65');
    expect(st.fresh).toBe(false);
  });

  it('步进夹在 1 和总关数之间', () => {
    const st = createDebugJumpState();
    st.input = '1';
    applyDebugJumpInput(st, 'dj:minus', TOTAL, CUR);
    expect(st.input).toBe('1');

    st.input = String(TOTAL);
    applyDebugJumpInput(st, 'dj:plus', TOTAL, CUR);
    expect(st.input).toBe(String(TOTAL));

    st.input = '500';
    applyDebugJumpInput(st, 'dj:plus', TOTAL, CUR);
    expect(st.input).toBe('501');
  });

  it('输入为空时步进以当前关为基准', () => {
    const st = createDebugJumpState();
    applyDebugJumpInput(st, 'dj:plus', TOTAL, 42);
    expect(st.input).toBe('43');
  });

  it('随机落在 1..总关数 之内', () => {
    const st = createDebugJumpState();
    for (let i = 0; i < 200; i++) {
      applyDebugJumpInput(st, 'dj:random', TOTAL, CUR);
      const n = Number(st.input);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(TOTAL);
    }
  });

  it('只有「进入」返回 true，其余按键都不触发进关', () => {
    const st = opened();
    for (const id of ['dj:d:7', 'dj:back', 'dj:clear', 'dj:minus', 'dj:plus', 'dj:random', 'dj:w:153']) {
      expect(applyDebugJumpInput(st, id, TOTAL, CUR)).toBe(false);
    }
    expect(applyDebugJumpInput(st, 'dj:enter', TOTAL, CUR)).toBe(true);
  });
});

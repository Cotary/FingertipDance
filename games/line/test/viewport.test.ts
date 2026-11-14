import { describe, it, expect } from 'vitest';
import { createViewport } from '../src/render/viewport';

const DESIGN_W = 750;
const DESIGN_H = 1334;

/**
 * 视口测试。
 *
 * ## 为什么要单独测这个模块
 *
 * 2026-11-07 出过一个严重的 bug：渲染端用 `ctx.scale(dpr*scale)` +
 * `ctx.translate(offsetX/dpr)`，输入端用另一套公式，
 * 两边不互逆 —— 在 1920×1080 下横向偏 125px（约一整格）。
 * 玩家看到的是「鼠标点 A 格、游戏响应 B 格」。
 *
 * 这些用例锁死的不变量：
 *  1. `toDesign` 与 `toCss` 严格互逆；
 *  2. `toDevice` 与 `applyTo` 产生的变换严格互逆；
 *  3. 渲染变换的平移量是 `offset * dpr`（不是 `offset * scale`）。
 */
describe('viewport', () => {
  /** 典型的桌面尺寸（16:9，与设计稿 9:16 差很多，正是 bug 的触发条件）。 */
  const desktop = createViewport({ width: 1920, height: 1080, dpr: 1, designWidth: DESIGN_W, designHeight: DESIGN_H });
  /** 手机竖屏。 */
  const phone = createViewport({ width: 390, height: 844, dpr: 3, designWidth: DESIGN_W, designHeight: DESIGN_H });

  it('等比缩放：设计稿完整放进画布且不超出', () => {
    expect(desktop.scale).toBeLessThanOrEqual(1920 / DESIGN_W);
    expect(desktop.scale).toBeLessThanOrEqual(1080 / DESIGN_H);
    expect(desktop.offsetX).toBeGreaterThanOrEqual(0);
    expect(desktop.offsetY).toBeGreaterThanOrEqual(0);
  });

  it('设计稿居中：左右留白相等', () => {
    expect(desktop.offsetX).toBeCloseTo((1920 - DESIGN_W * desktop.scale) / 2, 6);
    expect(desktop.offsetY).toBeCloseTo((1080 - DESIGN_H * desktop.scale) / 2, 6);
  });

  it('toCss 与 toDesign 严格互逆', () => {
    for (const vp of [desktop, phone]) {
      for (const [dx, dy] of [[0, 0], [375, 667], [750, 1334], [123, 456]]) {
        const css = vp.toCss(dx, dy);
        const back = vp.toDesign(css.x, css.y);
        expect(back.x).toBeCloseTo(dx, 6);
        expect(back.y).toBeCloseTo(dy, 6);
      }
    }
  });

  it('toDevice 与 applyTo 的变换严格互逆', () => {
    for (const vp of [desktop, phone]) {
      // 假装成一个 2D 上下文，捕获 setTransform 的参数
      let captured: number[] = [];
      const ctx = {
        setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
          captured = [a, b, c, d, e, f];
        },
      };
      vp.applyTo(ctx);

      const [a, b, c, d, e, f] = captured;
      // 矩阵 [[a,c,e],[b,d,f]] → 设备像素
      const toDev = (x: number, y: number) => ({
        x: a * x + c * y + e,
        y: b * x + d * y + f,
      });

      for (const [dx, dy] of [[0, 0], [375, 667], [750, 1334]]) {
        const dev = vp.toDevice(dx, dy);
        const viaMatrix = toDev(dx, dy);
        expect(viaMatrix.x).toBeCloseTo(dev.x, 6);
        expect(viaMatrix.y).toBeCloseTo(dev.y, 6);

        // 反解：设备像素 → 设计坐标（矩阵求逆）
        const inv = (px: number, py: number) => ({
          x: ((px - e) * d - (py - f) * c) / (a * d - b * c),
          y: ((py - f) * a - (px - e) * b) / (a * d - b * c),
        });
        const back = inv(dev.x, dev.y);
        expect(back.x).toBeCloseTo(dx, 6);
        expect(back.y).toBeCloseTo(dy, 6);
      }
    }
  });

  it('渲染变换的平移量是 offset*dpr，不是 offset*scale', () => {
    // 这正是 2026-11-07 那个 bug 的核心断言。
    //
    // 旧写法 `ctx.scale(dpr*scale)` + `ctx.translate(offsetX/dpr)`，
    // 因为变换右乘，实际偏移 = offsetX * scale（而不是 offsetX * dpr）。
    let captured: number[] = [];
    desktop.applyTo({
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        captured = [a, b, c, d, e, f];
      },
    });
    expect(captured[4]).toBeCloseTo(desktop.offsetX * desktop.dpr, 6);
    expect(captured[5]).toBeCloseTo(desktop.offsetY * desktop.dpr, 6);
  });

  it('桌面 16:9 下渲染与命中的棋盘位置一致（回归：曾偏 125px）', () => {
    // 关卡 1 是 5×5，布局见 render/layout.ts 的 computeLayout。
    const cell = Math.floor(Math.min((DESIGN_W - 80) / 5, (1176 - 200) / 5));
    const boardW = cell * 5;
    const originX = Math.round((DESIGN_W - boardW) / 2);
    const originY = Math.round(200 + ((1176 - 200) - boardW) / 2);

    // 棋盘左边缘：渲染位置（设备像素 → CSS 像素）
    const renderLeftCss = desktop.toDevice(originX, originY).x / desktop.dpr;
    // 棋盘左边缘：命中判定位置（设计坐标 → CSS 像素）
    const hitLeftCss = desktop.toCss(originX, originY).x;

    // 两者必须一致 —— 这就是「点哪格中哪格」的前提。
    expect(renderLeftCss).toBeCloseTo(hitLeftCss, 6);
  });

  it('高 dpr 手机上同样一致', () => {
    const cell = Math.floor(Math.min((DESIGN_W - 80) / 5, (1176 - 200) / 5));
    const originX = Math.round((DESIGN_W - cell * 5) / 2);
    const originY = Math.round(200 + ((1176 - 200) - cell * 5) / 2);

    const renderLeftCss = phone.toDevice(originX, originY).x / phone.dpr;
    const hitLeftCss = phone.toCss(originX, originY).x;
    expect(renderLeftCss).toBeCloseTo(hitLeftCss, 6);
  });

  /**
   * resize 后重建视口：点击位置不能偏移。
   *
   * ## 场景
   *
   * 手机端地址栏收缩 / 横竖屏切换 → 画布 CSS 尺寸变了。
   * 如果不重建视口，`toDesign` 仍按旧尺寸反解 → 点击位置整体偏移。
   */
  it('resize 后重建视口：同一 CSS 坐标反解出的设计坐标会变，但新视口是对的', () => {
    // 竖屏：390×844
    const portrait = createViewport({ width: 390, height: 844, dpr: 3, designWidth: DESIGN_W, designHeight: DESIGN_H });
    // 横屏：844×390
    const landscape = createViewport({ width: 844, height: 390, dpr: 3, designWidth: DESIGN_W, designHeight: DESIGN_H });

    const css = { x: 195, y: 400 };
    const before = portrait.toDesign(css.x, css.y);
    const after = landscape.toDesign(css.x, css.y);

    // 尺寸变了 → 反解结果**应该**不同（说明旧视口确实不再适用）
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(1);

    // 但新视口自身必须自洽：toDesign ∘ toCss = 恒等
    for (const [dx, dy] of [[0, 0], [375, 667], [750, 1334], [123, 456]]) {
      const c = landscape.toCss(dx, dy);
      const back = landscape.toDesign(c.x, c.y);
      expect(back.x).toBeCloseTo(dx, 6);
      expect(back.y).toBeCloseTo(dy, 6);
    }
  });

  it('resize 后渲染与命中依然一致（不会「点哪格中哪格」失效）', () => {
    const resized = createViewport({ width: 844, height: 390, dpr: 2, designWidth: DESIGN_W, designHeight: DESIGN_H });
    const cell = Math.floor(Math.min((DESIGN_W - 80) / 5, (1176 - 200) / 5));
    const originX = Math.round((DESIGN_W - cell * 5) / 2);
    const originY = Math.round(200 + ((1176 - 200) - cell * 5) / 2);

    const renderLeftCss = resized.toDevice(originX, originY).x / resized.dpr;
    const hitLeftCss = resized.toCss(originX, originY).x;
    expect(renderLeftCss).toBeCloseTo(hitLeftCss, 6);
  });
});

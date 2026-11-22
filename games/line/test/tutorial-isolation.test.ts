import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 引导关**不能**污染正式进度 —— 用源码断言锁住这条。
 *
 * ## 为什么这类规则要源码断言
 *
 * 「引导关不写 maxLevel / 不给星 / 不上报服务端」是**流程顺序**问题，
 * 纯函数测不出来（它分散在 `enterLevel` / `onWin` / 结算页三条路径上）。
 * 而它一旦被后人改回去，表现是静默的：
 *
 * - 引导第 3 关通关 → `maxLevel` 被写成 -3 → 玩家进正式游戏时
 *   第 1 关变成"已通关"，直接从第 2 关开始；
 * - 或者星级表里多出 `"-1": 3`，地图页画出不存在的关卡。
 *
 * 这些都不会报错，只会在上线后被玩家发现"我的进度怎么怪怪的"。
 */

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(here, '../src/main.ts'), 'utf8');
const TUTORIAL = readFileSync(resolve(here, '../src/game/tutorial.ts'), 'utf8');
const API = readFileSync(resolve(here, '../src/net/api.ts'), 'utf8');

describe('引导关与正式进度隔离', () => {
  it('`enterLevel` 先分流引导关，再走正式的越界检查', () => {
    // 顺序很重要：正式分支第一行就是 `idx < 1` 的越界拦截，
    // 引导关号是负数，分流必须在它**之前**。
    const enter = MAIN.slice(MAIN.indexOf('async function enterLevel'));
    const tutIdx = enter.indexOf('tutorialByIndex(idx)');
    const boundsIdx = enter.indexOf('idx < 1 || idx > totalLevelCount()');
    expect(tutIdx).toBeGreaterThan(-1);
    expect(boundsIdx).toBeGreaterThan(-1);
    expect(tutIdx).toBeLessThan(boundsIdx);
  });

  it('通关回调优先分给引导，且引导分支在挑战/正式之前', () => {
    // 分派点本身没有 `e.type === 'win'` 这行（它在上面更早的分支里），
    // 所以按「三个调用的相对顺序」断言，而不是按某个标记切片。
    const tut = MAIN.indexOf('if (tutorialLevel) onTutorialWin()');
    const chal = MAIN.indexOf('onChallengeWin(e.steps');
    const normal = MAIN.indexOf('onWin(e.steps');
    expect(tut).toBeGreaterThan(-1);
    expect(chal).toBeGreaterThan(-1);
    expect(normal).toBeGreaterThan(-1);
    expect(tut).toBeLessThan(chal);
    expect(tut).toBeLessThan(normal);
  });

  it('引导通关不调用任何上报接口', () => {
    const fn = MAIN.slice(
      MAIN.indexOf('function onTutorialWin'),
      MAIN.indexOf('function advanceTutorial'),
    );
    expect(fn).not.toContain('reportCoverProgress');
    expect(fn).not.toContain('reportCoverSkip');
    expect(fn).not.toContain('reportCoverChallenge');
    // 星级也不能写：引导关不在星级表里
    expect(fn).not.toContain('setStar');
    expect(fn).not.toContain('clearStar');
  });

  it('引导通关不推进 maxLevel / pendingLevel', () => {
    const fn = MAIN.slice(
      MAIN.indexOf('function onTutorialWin'),
      MAIN.indexOf('function advanceTutorial'),
    );
    expect(fn).not.toContain('pendingLevel');
    expect(fn).not.toContain('maxLevel:');
  });

  it('引导关不弹插屏广告（新玩家第一局就弹，体验和收益都亏）', () => {
    const fn = MAIN.slice(
      MAIN.indexOf('function onTutorialWin'),
      MAIN.indexOf('function advanceTutorial'),
    );
    expect(fn).not.toContain('showInterstitial');
  });

  it('结算页把引导排在正式之前', () => {
    const idxTut = MAIN.indexOf("phase === 'result' && tutorialResult && tutorialLevel");
    const idxNormal = MAIN.indexOf("phase === 'result' && resultData");
    expect(idxTut).toBeGreaterThan(-1);
    expect(idxTut).toBeLessThan(idxNormal);
  });

  it('「下一关」不能写成 idx + 1（引导关号是负数递减的）', () => {
    const fn = MAIN.slice(MAIN.indexOf('function advanceTutorial'), MAIN.indexOf('function syncHomeState'));
    expect(fn).not.toMatch(/idx\s*\+\s*1/);
    expect(fn).toContain('nextTutorialIdx');
  });
});

describe('引导关定义', () => {
  it('关号全为负数（与正式关 1..1000 不重叠）', () => {
    expect(TUTORIAL).toContain('TUTORIAL_BASE = -1');
  });

  it('引导完成要落库：本地 + 服务端两份', () => {
    // 服务端
    expect(API).toContain('/api/tutorial/done');
    // 本地
    expect(MAIN).toContain('setTutorialDone()');
  });

  it('登录后把本地与服务端的完成状态取并集，不是覆盖', () => {
    expect(MAIN).toContain('progress.current.tutorialDone || !!loginRes.tutorialDone');
  });

  it('本地已完成但服务端不知道时，登录后补报一次', () => {
    expect(MAIN).toContain('progress.current.tutorialDone && !loginRes.tutorialDone');
  });
});

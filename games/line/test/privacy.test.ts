import { afterEach, describe, it, expect } from 'vitest';
import {
  wechatPrivacy, wechatProfile, installPrivacyWatcher,
} from '../src/platform/privacy';

/**
 * 隐私授权与昵称头像的平台分支。
 *
 * ## 为什么要单测这两段
 *
 * 它们的失败方式是**静默但严重**：
 *
 * - `ensureAuthorized` 返回 `false` 时启动流程不登录 —— 玩家看起来只是
 *   「进度不同步」，而真因是一个分支判错；
 * - 反过来，**该弹窗却没弹**（拿不到 API 时返回 false）会把老设备玩家
 *   永远拦在启动页，那是最严重的一类回归；
 * - `request` 把「用户拒绝」当成错误抛出，会让「我的」页弹一个报错提示，
 *   而拒绝授权是完全正常的行为。
 *
 * 所以这里把所有分支都钉住，包括「老基础库缺 API 时放行」。
 */

type G = { wx?: unknown };

const SAVED_WX = Object.getOwnPropertyDescriptor(globalThis, 'wx');

afterEach(() => {
  if (SAVED_WX) Object.defineProperty(globalThis, 'wx', SAVED_WX);
  else delete (globalThis as G).wx;
});

function withWx(api: unknown): void {
  (globalThis as G).wx = api;
}

describe('privacy · ensureAuthorized', () => {
  it('没有 wx（Web / 抖音）时直接放行', async () => {
    delete (globalThis as G).wx;
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
  });

  it('老基础库没有 getPrivacySetting 时放行（不能把老设备拦在门外）', async () => {
    withWx({ login: () => undefined });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
  });

  it('已同意过（needAuthorization=false）时不再弹窗', async () => {
    let required = 0;
    withWx({
      getPrivacySetting: ({ success }: any) => success({ needAuthorization: false }),
      requirePrivacyAuthorize: () => { required++; },
    });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
    expect(required, '已经同意过就不该再拉弹窗').toBe(0);
  });

  it('需要授权且玩家同意 → true', async () => {
    withWx({
      getPrivacySetting: ({ success }: any) => success({ needAuthorization: true }),
      requirePrivacyAuthorize: ({ success }: any) => success(),
    });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
  });

  it('需要授权但玩家拒绝 → false（调用方据此不登录）', async () => {
    withWx({
      getPrivacySetting: ({ success }: any) => success({ needAuthorization: true }),
      requirePrivacyAuthorize: ({ fail }: any) => fail({ errMsg: 'deny' }),
    });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(false);
  });

  it('查询本身失败时放行（隐私接口挂了不是玩家的错）', async () => {
    withWx({
      getPrivacySetting: ({ fail }: any) => fail({ errMsg: 'boom' }),
    });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
  });

  it('有 getPrivacySetting 但没有 requirePrivacyAuthorize → 放行', async () => {
    withWx({
      getPrivacySetting: ({ success }: any) => success({ needAuthorization: true }),
    });
    expect(await wechatPrivacy.ensureAuthorized()).toBe(true);
  });
});

describe('privacy · openContract', () => {
  it('有 API 时打开隐私协议原文', () => {
    let opened = 0;
    withWx({ openPrivacyContract: () => { opened++; } });
    wechatPrivacy.openContract?.();
    expect(opened).toBe(1);
  });

  it('没有 API 时不抛（Web 端点这一行不该崩）', () => {
    withWx({});
    expect(() => wechatPrivacy.openContract?.()).not.toThrow();
  });
});

describe('privacy · onNeedPrivacyAuthorization', () => {
  it('注册后由平台默认弹窗处理（回调里调用 resolve 且不带参数）', () => {
    let handler: any = null;
    withWx({ onNeedPrivacyAuthorization: (cb: any) => { handler = cb; } });
    installPrivacyWatcher();
    expect(typeof handler, '应该注册了监听').toBe('function');

    let resolved = 0;
    handler((arg?: unknown) => {
      // 不带参数 = 交给平台默认处理，这是文档里的约定
      expect(arg).toBeUndefined();
      resolved++;
    });
    expect(resolved).toBe(1);
  });

  it('没有 API 时不抛', () => {
    withWx({});
    expect(() => installPrivacyWatcher()).not.toThrow();
  });
});

describe('profile · request', () => {
  it('优先用 getUserProfile（一次拿昵称 + 头像）', async () => {
    let usedGetUserInfo = 0;
    withWx({
      getUserProfile: ({ success }: any) => success({ userInfo: { nickName: '阿青', avatarUrl: 'https://x/a.png' } }),
      getUserInfo: () => { usedGetUserInfo++; },
    });
    expect(await wechatProfile.request()).toEqual({ nickname: '阿青', avatar: 'https://x/a.png' });
    expect(usedGetUserInfo, '有 getUserProfile 就不该退回 getUserInfo').toBe(0);
  });

  it('没有 getUserProfile 时退回 getUserInfo', async () => {
    withWx({
      getUserInfo: ({ success }: any) => success({ userInfo: { nickName: '阿沙', avatarUrl: '' } }),
    });
    expect(await wechatProfile.request()).toEqual({ nickname: '阿沙', avatar: '' });
  });

  it('用户拒绝（fail）→ null，不抛', async () => {
    withWx({ getUserProfile: ({ fail }: any) => fail({ errMsg: 'cancel' }) });
    expect(await wechatProfile.request()).toBeNull();
  });

  it('拿到匿名数据（昵称头像都空）→ null，宁可保留首字圆球', async () => {
    withWx({ getUserProfile: ({ success }: any) => success({ userInfo: { nickName: '', avatarUrl: '' } }) });
    expect(await wechatProfile.request()).toBeNull();
  });

  it('没有 wx → null', async () => {
    delete (globalThis as G).wx;
    expect(await wechatProfile.request()).toBeNull();
  });
});

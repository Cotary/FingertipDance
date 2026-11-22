/**
 * 小游戏 appid 解析的测试。
 *
 * 锁的是**「运营手改的 appid 不会被构建脚本改回去」**这条：
 * 抖音脚本以前每次构建都重写 project.config.json，
 * 手改的 appid 在下一次 `build:douyin` 时被悄悄换回占位值 ——
 * 表现是「明明改过了，上传还是说 appid 不对」，且没有任何报错。
 */
import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_APPID,
  isPlaceholderAppId,
  validateAppId,
  resolveAppId,
} from '../scripts/mini-appid.mjs';

const WX_REAL = 'wx1234567890abcdef';
const TT_REAL = 'tt1234567890abcdef';

describe('占位值判定', () => {
  it('游客 appid 认得出', () => {
    expect(isPlaceholderAppId('wx', 'touristappid')).toBe(true);
    expect(isPlaceholderAppId('douyin', 'tt0000000000000000')).toBe(true);
  });

  it('空值算占位（宁可报「还没配」，也不要拿空字符串去构建）', () => {
    expect(isPlaceholderAppId('wx', '')).toBe(true);
    expect(isPlaceholderAppId('wx', undefined)).toBe(true);
  });

  it('真实 appid 不算占位', () => {
    expect(isPlaceholderAppId('wx', WX_REAL)).toBe(false);
    expect(isPlaceholderAppId('douyin', TT_REAL)).toBe(false);
  });

  it('两端的占位值不互认 —— 微信的占位不能当抖音的合法值', () => {
    expect(isPlaceholderAppId('douyin', 'touristappid')).toBe(true);
    expect(isPlaceholderAppId('wx', 'tt0000000000000000')).toBe(true);
  });
});

describe('格式校验', () => {
  it('合法格式返回空串', () => {
    expect(validateAppId('wx', WX_REAL)).toBe('');
    expect(validateAppId('douyin', TT_REAL)).toBe('');
  });

  it('少一位 / 前缀错 / 带非十六进制字符都判不合法', () => {
    expect(validateAppId('wx', 'wx1234567890abcde')).not.toBe('');
    expect(validateAppId('wx', 'tt1234567890abcdef')).not.toBe('');
    expect(validateAppId('wx', 'wx1234567890abcdeg')).not.toBe('');
  });

  it('错误信息里带环境变量名，运营知道该设哪个', () => {
    expect(validateAppId('wx', 'bad')).toContain('WX_APPID');
    expect(validateAppId('douyin', 'bad')).toContain('DY_APPID');
  });
});

describe('resolveAppId 的优先级', () => {
  it('① 环境变量优先于文件里的值', () => {
    const r = resolveAppId('wx', WX_REAL, 'wxaaaaaaaaaaaaaaaa');
    expect(r.appid).toBe(WX_REAL);
    expect(r.warning).toBe('');
  });

  it('② 没给环境变量时**保留文件里已有的真实 appid**（这条是本次修复的核心）', () => {
    const r = resolveAppId('douyin', '', TT_REAL);
    expect(r.appid).toBe(TT_REAL);
    expect(r.warning).toBe('');
  });

  it('③ 都没有 → 占位值 + 警告（构建不失败，本地游客预览是合法用法）', () => {
    const r = resolveAppId('wx', '', 'touristappid');
    expect(r.appid).toBe(PLACEHOLDER_APPID.wx);
    expect(r.warning).toContain('提审');
  });

  it('环境变量格式错 → 退回占位并警告，不带着畸形 appid 构建成功', () => {
    const r = resolveAppId('wx', 'wx-oops', '');
    expect(r.appid).toBe(PLACEHOLDER_APPID.wx);
    expect(r.warning).toContain('格式不对');
  });

  it('环境变量前面有空格也算给了（trim 掉，不静默忽略）', () => {
    const r = resolveAppId('wx', `  ${WX_REAL}  `, '');
    expect(r.appid).toBe(WX_REAL);
  });

  it('文件里存着格式错的 appid 时不沿用', () => {
    const r = resolveAppId('wx', '', 'garbage');
    expect(r.appid).toBe(PLACEHOLDER_APPID.wx);
    expect(r.warning).not.toBe('');
  });
});

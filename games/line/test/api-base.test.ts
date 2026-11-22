import { describe, it, expect } from 'vitest';
import { resolveApiBase, isLoopback, LOCAL_API_BASE } from '../scripts/api-base';

/**
 * 构建期后端地址的校验。
 *
 * ## 为什么这个值得测
 *
 * 小游戏构建漏了 `API_BASE` 时，产出的包会指向 `127.0.0.1:50001`。
 * 线上包连的是**玩家自己手机**的环回地址 → 登录静默失败、
 * 进度不同步、排行榜空白，而 `boot()` 的 try/catch 把错误全兜住了，
 * **日志里一句报错都没有**。
 *
 * 一次发版才发现，排查要半天。所以这里把判据钉死。
 */

describe('isLoopback：环回地址识别', () => {
  it('认得常见的环回写法', () => {
    expect(isLoopback('http://127.0.0.1:50001')).toBe(true);
    expect(isLoopback('http://localhost:50001')).toBe(true);
    expect(isLoopback('http://0.0.0.0:8080')).toBe(true);
    expect(isLoopback('https://LOCALHOST/')).toBe(true);
  });

  it('认得带端口的环回（端口不影响主机名）', () => {
    expect(isLoopback('https://127.0.0.1:8443')).toBe(true);
  });

  it('真实域名不是环回', () => {
    expect(isLoopback('https://api.example.com')).toBe(false);
    expect(isLoopback('http://192.168.1.10:50001')).toBe(false);
  });

  it('「像环回但不是」不算 —— 主机名要整个匹配', () => {
    // 主机名是 localhost.evil.com，不是 localhost
    expect(isLoopback('https://localhost.evil.com')).toBe(false);
    expect(isLoopback('https://not127.0.0.1.example.com')).toBe(false);
  });

  it('不是合法 URL 时不判成环回（那是别处的校验要管的）', () => {
    expect(isLoopback('随便写的')).toBe(false);
    expect(isLoopback('')).toBe(false);
  });
});

describe('resolveApiBase：小游戏构建必须给真实地址', () => {
  it('没给 API_BASE → 构建失败，并说清后果', () => {
    const r = resolveApiBase('wx', undefined);
    expect(r.error).not.toBe('');
    expect(r.base).toBe('');
    // 错误信息要提到「静默」这个关键点，否则没人知道严重性
    expect(r.error).toContain('静默');
  });

  it('给了环回地址 → 构建失败', () => {
    const r = resolveApiBase('wx', 'http://127.0.0.1:50001');
    expect(r.error).not.toBe('');
    expect(r.error).toContain('环回');
  });

  it('抖音端同样要求真实地址', () => {
    expect(resolveApiBase('douyin', '').error).not.toBe('');
    expect(resolveApiBase('douyin', 'http://localhost:50001').error).not.toBe('');
  });

  it('给了真实地址 → 通过，尾部斜杠被去掉', () => {
    const r = resolveApiBase('wx', 'https://api.example.com/');
    expect(r.error).toBe('');
    expect(r.base).toBe('https://api.example.com');
  });

  it('没带协议 → 失败（否则拼出来的地址在微信端是非法 URL）', () => {
    const r = resolveApiBase('wx', 'api.example.com');
    expect(r.error).not.toBe('');
    expect(r.error).toContain('http');
  });

  it('内网地址（真机可达）允许 —— 局域网联调是合法场景', () => {
    const r = resolveApiBase('wx', 'http://192.168.1.10:50001');
    expect(r.error).toBe('');
    expect(r.base).toBe('http://192.168.1.10:50001');
  });
});

describe('resolveApiBase：Web 构建保持宽松', () => {
  it('没给 → 默认本机后端（本地开发要的就是这个）', () => {
    const r = resolveApiBase('web', undefined);
    expect(r.error).toBe('');
    expect(r.base).toBe(LOCAL_API_BASE);
  });

  it('显式给了本机地址也行', () => {
    const r = resolveApiBase('web', 'http://127.0.0.1:50001');
    expect(r.error).toBe('');
    expect(r.base).toBe('http://127.0.0.1:50001');
  });

  it('给了真实地址 → 照用', () => {
    const r = resolveApiBase('web', 'https://api.example.com');
    expect(r.error).toBe('');
    expect(r.base).toBe('https://api.example.com');
  });
});

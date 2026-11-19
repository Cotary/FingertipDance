import { describe, it, expect } from 'vitest';
import { buildShareQuery } from '../src/game/challenge';

describe('challenge', () => {
  it('分享 query 含关号与重来次数', () => {
    const q = buildShareQuery({ levelIdx: 27, undos: 3 });
    expect(q).toContain('l=27');
    expect(q).toContain('undos=3');
  });

  it('重来次数为 0 时也要带上（0 次 = 三星，是有意义的成绩）', () => {
    // 早期版本写的是 `if (challenge.steps)` —— 0 会被当成「没有」丢掉，
    // 而 0 次重来恰恰是最好的成绩，必须传出去。
    expect(buildShareQuery({ levelIdx: 5, undos: 0 })).toBe('l=5&undos=0');
  });

  it('不给重来次数时不带该字段', () => {
    expect(buildShareQuery({ levelIdx: 5 })).toBe('l=5');
  });

  it('分享 query 带 uid 与昵称（好友要知道是谁在挑战）', () => {
    const q = buildShareQuery({ levelIdx: 5, undos: 0, uid: 42, name: '小明' });
    expect(q).toContain('l=5');
    expect(q).toContain('undos=0');
    expect(q).toContain('uid=42');
    // 昵称必须编码 —— 中文直接拼进 query 会破
    expect(q).toContain(`name=${encodeURIComponent('小明')}`);
    expect(decodeURIComponent(new URLSearchParams(q).get('name')!)).toBe('小明');
  });

  it('解析 query 能读回重来次数', () => {
    // Web 平台从 URL search 解析
    const q = 'l=27&undos=3';
    const parsed = new URLSearchParams(q);
    expect(parsed.get('l')).toBe('27');
    expect(parsed.get('undos')).toBe('3');
  });

  it('分享 query 带服务端 token（胜负由服务端判，不靠链接里的 undos）', () => {
    const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const q = buildShareQuery({ levelIdx: 47, undos: 0, token });
    // 必须是 `c=` —— 服务端路由与 parseChallenge 都按这个键读
    expect(new URLSearchParams(q).get('c')).toBe(token);
    // undos 仍然带上：它负责**显示**（横幅写「他重来 0 次」），
    // 但不再是判定依据
    expect(new URLSearchParams(q).get('undos')).toBe('0');
  });

  it('不带 token 时不产生空 c=（老链接兼容）', () => {
    const q = buildShareQuery({ levelIdx: 5, undos: 2 });
    expect(new URLSearchParams(q).has('c')).toBe(false);
  });

  it('token 与 undos 可以同时缺席（纯邀请）', () => {
    const q = buildShareQuery({ levelIdx: 9 });
    expect(new URLSearchParams(q).get('l')).toBe('9');
    expect(new URLSearchParams(q).has('undos')).toBe(false);
    expect(new URLSearchParams(q).has('c')).toBe(false);
  });
});

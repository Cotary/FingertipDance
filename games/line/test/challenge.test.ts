import { describe, it, expect } from 'vitest';
import { buildShareQuery } from '../src/game/challenge';

describe('challenge', () => {
  it('分享 query 含关号', () => {
    const q = buildShareQuery({ levelIdx: 27, steps: 15 });
    expect(q).toContain('l=27');
    expect(q).toContain('steps=15');
  });

  it('无步数时不含 steps', () => {
    expect(buildShareQuery({ levelIdx: 5 })).toBe('l=5');
  });
});

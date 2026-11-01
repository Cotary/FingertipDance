import { describe, it, expect } from 'vitest';
import { Session } from '../src/game/session';
import { generateLevel } from '../src/core/generator';
import { solve } from '../src/core/solver';

describe('session', () => {
  it('按下非起点无效', () => {
    const s = new Session();
    const lv = generateLevel(1, 1);
    s.load(lv);
    s.pointerDown(1000, 1000);
    expect(s.state?.path.length).toBe(0);
  });

  it('沿解法路径拖动可通关', () => {
    const s = new Session();
    const lv = generateLevel(1, 1);
    s.load(lv);
    const res = solve(lv.grid);
    const path = res.paths[0];

    const cell = s.layout!.cell;
    const originX = s.layout!.originX;
    const originY = s.layout!.originY;
    const centerX = (idx: number) => originX + (idx % lv.w) * cell + cell / 2;
    const centerY = (idx: number) => originY + Math.floor(idx / lv.w) * cell + cell / 2;

    let won = false;
    s.on((e) => { if (e.type === 'won') won = true; });

    s.pointerDown(centerX(path[0]), centerY(path[0]));
    for (let i = 1; i < path.length; i++) {
      s.pointerMove(centerX(path[i]), centerY(path[i]));
    }
    s.pointerUp();
    expect(won).toBe(true);
    expect(s.state?.phase).toBe('won');
  });

  it('松手未到终点则路径清空', () => {
    const s = new Session();
    const lv = generateLevel(1, 1);
    s.load(lv);
    const res = solve(lv.grid);
    const path = res.paths[0];

    const cell = s.layout!.cell;
    const originX = s.layout!.originX;
    const originY = s.layout!.originY;
    const centerX = (idx: number) => originX + (idx % lv.w) * cell + cell / 2;
    const centerY = (idx: number) => originY + Math.floor(idx / lv.w) * cell + cell / 2;

    s.pointerDown(centerX(path[0]), centerY(path[0]));
    s.pointerMove(centerX(path[1]), centerY(path[1]));
    s.pointerUp();
    expect(s.state?.path.length).toBe(0);
    expect(s.state?.phase).toBe('idle');
  });
});

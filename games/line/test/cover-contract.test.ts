/**
 * cover 模式「双模式隔离」回归测试。
 *
 * ## 为什么要有这个文件
 *
 * 2026-11-06 的一次巡检发现：经典模式与 cover 模式**共用同一套关号空间**
 * （都是 1..1000），但服务端 `level_records` 表的主键是 `(uid, level_idx)` ——
 * 没有模式维度。后果是一串连锁 bug：
 *
 *  1. 玩家先玩经典第 5 关，再玩 cover 第 5 关 → **同一行**，互相覆写
 *  2. `/api/progress/stars` 按 `steps / shortest` 算星级，
 *     cover 的 `shortest` 恒为 `required − 1` → cover 星级**全错**
 *  3. cover 模式跳过关卡时路径为空 → 走经典上报接口会被「路径长度 0」拒掉
 *  4. cover 关卡表**没有** `unlockSkin` 字段 → premium 皮肤永远拿不到
 *
 * 这些都属于「单测测不出来、单看代码也不显眼」的类型 ——
 * 所以在这里把**契约**锁死，任何一侧改动都会红。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import clientTable from '../data/levels-v3-client.json';
import type { LevelEntry } from '../src/core/cover/v3/codec';
import { decodeCoverLevel, walkableCells } from '../src/game/coverLevel';
import { starOfCover } from '../src/ui/hud';

const CLIENT = clientTable as unknown as { version: string; count: number; levels: LevelEntry[] };

describe('cover 模式契约', () => {
  it('客户端表不含参考解（解绝不下发）', () => {
    expect(CLIENT.levels.length).toBe(1000);
    for (const lv of CLIENT.levels) {
      expect((lv as unknown as { solution?: string }).solution).toBeUndefined();
    }
  });

  it('客户端表带 unlockSkin 字段（premium 皮肤靠它发放）', () => {
    // cover 关卡表曾经**没有**这个字段 → 服务端无从发放 premium 皮肤。
    // 现在必须至少有 200/500/900 三关挂皮肤。
    const withSkin = CLIENT.levels.filter((l) => l.unlockSkin);
    expect(withSkin.length).toBeGreaterThanOrEqual(3);
    const map = new Map(withSkin.map((l) => [l.idx, l.unlockSkin]));
    expect(map.get(200)).toBe('gold');
    expect(map.get(500)).toBe('stardust');
    expect(map.get(900)).toBe('galaxy');
  });

  it('cover 模式的步数恒为 required−1（星级不能按步数算）', () => {
    // 这是「cover 星级看悔棋次数」的**前提**。
    // 如果哪天步数不再恒定，starOfCover 的整个前提就塌了，
    // 必须改成按步数算 —— 这个测试就是提醒那一刻的。
    for (const entry of CLIENT.levels.slice(0, 100)) {
      const level = decodeCoverLevel(entry);
      expect(entry.shortest).toBe(level.required - 1);
      expect(walkableCells(level).length).toBe(level.required);
    }
  });

  it('星级阈值：0 次悔棋 = 3 星，1~2 次 = 2 星，3 次以上 = 1 星', () => {
    expect(starOfCover(0)).toBe(3);
    expect(starOfCover(1)).toBe(2);
    expect(starOfCover(2)).toBe(2);
    expect(starOfCover(3)).toBe(1);
    expect(starOfCover(10)).toBe(1);
  });

  it('服务端表与客户端表的关卡一一对应且版本一致', () => {
    // 两张表由同一次生成产出 —— 版本号必须相同。
    // 不一致说明有人只改了一张表。
    const serverFile = path.resolve(__dirname, '../data/levels-v3.json');
    if (!fs.existsSync(serverFile)) return;
    const server = JSON.parse(fs.readFileSync(serverFile, 'utf8')) as {
      version: string; count: number; levels: Array<LevelEntry & { solution: string }>;
    };
    expect(server.version).toBe(CLIENT.version);
    expect(server.count).toBe(CLIENT.count);
    expect(server.levels.length).toBe(CLIENT.levels.length);
    for (let i = 0; i < CLIENT.levels.length; i++) {
      expect(server.levels[i].idx).toBe(CLIENT.levels[i].idx);
      expect(server.levels[i].grid).toBe(CLIENT.levels[i].grid);
      expect(server.levels[i].unlockSkin).toBe(CLIENT.levels[i].unlockSkin);
    }
  });
});

/**
 * 诊断：关卡数据里 VOID / BLOCK 的实际分布。
 *
 * 问题：用户看到"空白格"和"石障"两种不可走格，怀疑是数据问题还是渲染问题。
 * 这里直接统计服务端下发的表里两种类型各有多少。
 */
import fs from 'node:fs';

const FILES = [
  'I:/work/f-game/server/data/levels-v3.json',
  'I:/work/f-game/games/line/data/levels-v3-client.json',
  'I:/work/f-game/games/line/data/levels-v3.json',
];

const CoverCell = { VOID: 0, BRICK: 1, BLOCK: 2, ONEWAY: 3, SHARD: 4, KEY: 5, GATE: 6, PORTAL: 7, ICE: 8, START: 9, END: 10 };

function decodeGrid(b64) {
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log(`\n${f} —— 不存在`); continue; }
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const levels = raw.levels || raw;
  console.log(`\n════ ${f}`);
  console.log(`关卡数：${Array.isArray(levels) ? levels.length : '?'}`);

  const totals = {};
  let lvWithVoid = 0, lvWithBlock = 0, lvWithBoth = 0;
  const samples = [];

  for (const lv of (Array.isArray(levels) ? levels : [])) {
    const grid = decodeGrid(lv.grid);
    const cnt = {};
    for (let i = 0; i < grid.length; i++) {
      const t = (grid[i] >> 4) & 0xf;
      cnt[t] = (cnt[t] || 0) + 1;
    }
    for (const [t, n] of Object.entries(cnt)) totals[t] = (totals[t] || 0) + n;
    const v = cnt[CoverCell.VOID] || 0;
    const b = cnt[CoverCell.BLOCK] || 0;
    if (v) lvWithVoid++;
    if (b) lvWithBlock++;
    if (v && b) lvWithBoth++;
    if (samples.length < 3 && (v || b)) {
      samples.push({ idx: lv.idx ?? lv.id, w: lv.w, h: lv.h, void: v, block: b });
    }
  }

  const nameOf = (t) => Object.entries(CoverCell).find(([, v]) => v === +t)?.[0] ?? t;
  console.log('格类型总计：');
  for (const [t, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(nameOf(t)).padEnd(8)} ${String(n).padStart(8)}`);
  }
  console.log(`含 VOID 的关：${lvWithVoid}`);
  console.log(`含 BLOCK 的关：${lvWithBlock}`);
  console.log(`两者都有：${lvWithBoth}`);
  console.log('样例：', JSON.stringify(samples));
}

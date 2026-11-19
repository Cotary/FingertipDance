/**
 * 诊断：传送门配对是否成立。
 *
 * 用户反馈「从 a 进、从 b 出」没生效，而是当成普通格直接走过。
 * 这里直接读关卡表，检查：
 *   1. 每组传送门的格子数（必须成偶数，最好正好 2）
 *   2. group 编码是否因为只有 2 bit 而串组
 *   3. portalOf 配对是否成功
 */
import fs from 'node:fs';

const CoverCell = { PORTAL: 7 };
const F = 'I:/work/f-game/server/data/levels-v3.json';
const raw = JSON.parse(fs.readFileSync(F, 'utf8'));
const levels = raw.levels || raw;

let bad = 0, ok = 0;
const groupHist = {};
const samples = [];

for (const lv of levels) {
  const bin = Buffer.from(lv.grid, 'base64');
  const grid = new Uint8Array(bin);
  const w = lv.w, h = lv.h;

  // 收集传送门：type/dir/group 三段位布局
  const portals = [];
  for (let i = 0; i < grid.length; i++) {
    const t = (grid[i] >> 4) & 0xf;
    if (t !== CoverCell.PORTAL) continue;
    const g = grid[i] & 0x3;
    portals.push({ i, g, x: i % w, y: Math.floor(i / w) });
  }
  if (portals.length === 0) continue;

  // 按 group 分组
  const byG = new Map();
  for (const p of portals) {
    const a = byG.get(p.g) ?? [];
    a.push(p);
    byG.set(p.g, a);
  }

  let thisOk = true;
  const sizes = [];
  for (const [g, arr] of byG) {
    sizes.push(`${g}:${arr.length}`);
    groupHist[arr.length] = (groupHist[arr.length] || 0) + 1;
    if (arr.length % 2 !== 0) thisOk = false;
  }
  if (thisOk) ok++; else bad++;

  if (samples.length < 6 && portals.length >= 2) {
    samples.push({
      idx: lv.idx ?? lv.id,
      size: `${w}x${h}`,
      portals: portals.map((p) => `(${p.x},${p.y})g${p.g}`),
      groups: sizes,
      ok: thisOk,
    });
  }
}

console.log(`含传送门的关：${ok + bad}`);
console.log(`  配对正常：${ok}`);
console.log(`  有奇数个（配不上）：${bad}`);
console.log('');
console.log('每组传送门格数分布（格数 -> 出现次数）：');
for (const [n, c] of Object.entries(groupHist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n} 格：${c} 次  ${+n > 2 ? '  ← 一串多对，可能串组' : ''} ${+n % 2 ? '  ← 奇数，配不上' : ''}`);
}
console.log('');
console.log('样例：');
for (const s of samples) console.log(' ', JSON.stringify(s));

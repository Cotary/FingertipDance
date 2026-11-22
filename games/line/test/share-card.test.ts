/**
 * 分享卡片图（5:4）的接线测试。
 *
 * ## 为什么这个测试存在
 *
 * `renderShareCard` 早就写好了，但**没有任何调用方** ——
 * 分享抽屉里那句注释写着「要出真正的 5:4 卡图是另一件事」，
 * 于是 `platform.share()` 一直没传 `imageUrl`，微信卡片用的是默认图。
 *
 * 这类「函数写了但没接上」的问题不会报错、不会崩，
 * 只在分享出去的卡片上看得出差别 —— 所以在这里锁住：
 *
 * 1. `sendInvite` 真的把 `imageUrl` 传给了 `platform.share`
 * 2. 只对「发给朋友」传（朋友圈走系统菜单，微信不接受定制）
 * 3. 出图失败不能挡分享（返回空串就退回默认图）
 * 4. 卡图尺寸是 5:4，不是海报的 9:16
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderShareCard } from '../src/ui/share';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MAIN = readFileSync(resolve(here, '../src/main.ts'), 'utf8');
const SHARE = readFileSync(resolve(here, '../src/ui/share.ts'), 'utf8');

/** 取出 `sendInvite` 函数体（到下一个顶层 `}` 之前大致范围）。 */
function sendInviteBody(): string {
  const start = MAIN.indexOf('async function sendInvite');
  expect(start, 'sendInvite 不见了，测试需要跟着改').toBeGreaterThan(-1);
  const end = MAIN.indexOf('\n/**', start);
  return MAIN.slice(start, end === -1 ? start + 3000 : end);
}

describe('分享卡图接线', () => {
  it('sendInvite 把 imageUrl 传给了 platform.share', () => {
    const body = sendInviteBody();
    expect(body).toContain('imageUrl');
    // 必须落在 share 调用里，而不是算完就扔
    const call = body.slice(body.indexOf('platform.share('));
    expect(call).toContain('...(imageUrl ? { imageUrl } : {})');
  });

  it('只对「发给朋友」出图 —— 朋友圈是系统菜单，传了也用不上', () => {
    const body = sendInviteBody();
    expect(body).toMatch(/channel === 'friend'[\s\S]{0,200}buildShareCardImage/);
  });

  it('出图失败不挡分享（catch 住，退回默认图）', () => {
    const body = sendInviteBody();
    expect(body).toMatch(/try\s*\{[\s\S]{0,200}buildShareCardImage[\s\S]{0,200}\}\s*catch/);
    // 失败时不能把空串塞进 imageUrl —— 微信会把「有字段但值为空」当成无效图
    expect(body).toContain("...(imageUrl ? { imageUrl } : {})");
  });

  it('这端不支持导出时直接跳过（不抛异常）', () => {
    const start = MAIN.indexOf('async function buildShareCardImage');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 1600);
    expect(body).toContain('if (!platform.exportCanvas) return');
  });

  it('同一张卡图会复用 —— 反复点分享不该每次都重画 + 落盘', () => {
    const start = MAIN.indexOf('async function buildShareCardImage');
    const body = MAIN.slice(start, start + 1600);
    expect(body).toContain('shareCardCache');
    expect(body).toMatch(/shareCardCache\.key === key/);
  });

  it('二维码与卡片指向同一份 query（否则扫出来的挑战和链接不是同一次）', () => {
    const start = MAIN.indexOf('async function buildShareCardImage');
    const body = MAIN.slice(start, start + 1600);
    expect(body).toContain('renderShareCard');
    expect(body).toMatch(/shareBaseUrl\(\)[\s\S]{0,120}\$\{base\}\?\$\{query\}/);
  });
});

describe('卡图本身', () => {
  it('尺寸是 5:4（1080×864），不是海报的 9:16', () => {
    // 微信卡片按 5:4 显示，别的比例会被居中裁切
    expect(SHARE).toMatch(/createOffscreenCanvas\(1080,\s*864\)/);
  });

  it('没有可用画布时返回 null，而不是抛异常', () => {
    // node 环境没有 document / wx.createOffscreenCanvas
    expect(renderShareCard({ idx: 7, w: 6, h: 6 }, 0, '零重来')).toBeNull();
  });

  it('二维码只在给了链接时画（空串留白，不画一个黑白方块）', () => {
    const start = SHARE.indexOf('export function renderShareCard');
    const body = SHARE.slice(start, start + 6000);
    expect(body).toMatch(/if\s*\(shareUrl\)\s*\{[\s\S]{0,200}drawQr/);
  });
});

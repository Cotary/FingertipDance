/**
 * 我的页。数据统计 + 皮肤收藏墙 + 功能设置。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { type Button } from './hud';
import { LOBBY_THEME } from './theme';
import { drawAvatar } from './home';
import { SKINS, paintSkin } from '../render/skins';

/** 我的页状态。 */
export interface ProfilePageState {
  nickname: string;
  avatar: string;
  maxLevel: number;
  totalSteps: number;
  totalTimeMs: number;
  adWatchCnt: number;
  unlockedSkins: string[];
  totalSkins: number;
  soundOn: boolean;
  vibrateOn: boolean;
}

/** 功能行行高与行距。 */
const ROW_H = 70;
const ROW_PITCH = 78;

/**
 * 绘制我的页。
 * @returns 可点击按钮列表
 */
export function drawProfilePage(ctx: CanvasRenderingContext2D, st: ProfilePageState, now: number): Button[] {
  const t = LOBBY_THEME;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 顶部头卡
  ctx.fillStyle = t.blue;
  roundRect(ctx, 0, 0, DESIGN_W, 300, 0);
  ctx.fill();
  // 底部圆角盖住矩形下沿
  ctx.fillStyle = t.bg;
  ctx.beginPath();
  ctx.moveTo(0, 300);
  ctx.lineTo(DESIGN_W, 300);
  ctx.lineTo(DESIGN_W, 340);
  ctx.quadraticCurveTo(DESIGN_W, 290, DESIGN_W - 50, 290);
  ctx.lineTo(50, 290);
  ctx.quadraticCurveTo(0, 290, 0, 340);
  ctx.closePath();
  ctx.fill();

  drawAvatar(ctx, 110, 140, 62, st.avatar, st.nickname);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.nickname || '玩家', 200, 118);
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText(`Lv.${st.maxLevel} · 皮肤 ${st.unlockedSkins.length}/${st.totalSkins}`, 200, 164);

  // ── 数据统计卡 ──
  const stats: Array<[string, string]> = [
    ['最高关卡', String(st.maxLevel)],
    ['总步数', String(st.totalSteps)],
    ['总用时', `${Math.floor(st.totalTimeMs / 60000)} 分`],
    ['看广告', `${st.adWatchCnt} 次`],
  ];
  stats.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 40 + col * ((DESIGN_W - 100) / 2 + 10);
    const y = 320 + row * 118;
    const w = (DESIGN_W - 100) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, x, y, w, 100, 20);
    ctx.fill();
    ctx.fillStyle = t.subText;
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + 24, y + 20);
    ctx.fillStyle = t.blue;
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(value, x + 24, y + 50);
  });

  // ── 皮肤收藏墙 ──
  const y = 570;
  ctx.fillStyle = t.text;
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('皮肤收藏', 40, y);

  const cell = 92;
  const cols = 6;
  const owned = new Set(st.unlockedSkins);
  SKINS.forEach((skin, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 40 + col * (cell + 12);
    const cy = y + 30 + row * (cell + 12);
    const has = owned.has(skin.id);

    if (has) {
      // 用真实皮肤画一个小格子做缩略图
      paintSkin(ctx, skin, x, cy, cell, cell, i + 1, now);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    } else {
      ctx.fillStyle = '#D6DEEC';
      roundRect(ctx, x, cy, cell, cell, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    }
    ctx.lineWidth = 2;
    roundRect(ctx, x, cy, cell, cell, 14);
    ctx.stroke();

    if (!has) {
      ctx.fillStyle = '#8B99B0';
      ctx.font = '30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', x + cell / 2, cy + cell / 2);
    }
  });

  // ── 功能行 ──
  const rows: Array<{ id: string; label: string; value?: string; on?: boolean }> = [
    { id: 'shareGame', label: '分享游戏给好友' },
    { id: 'toggleSound', label: '音效', value: st.soundOn ? '开' : '关', on: st.soundOn },
    { id: 'toggleVibrate', label: '震动反馈', value: st.vibrateOn ? '开' : '关', on: st.vibrateOn },
    { id: 'clearCache', label: '清除本地缓存' },
  ];

  const buttons: Button[] = [];
  rows.forEach((r, i) => {
    const ry = 900 + i * ROW_PITCH;
    // 不允许压到底部导航
    if (ry + ROW_H > DESIGN_H - 120) return;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, 40, ry, DESIGN_W - 80, ROW_H, 18);
    ctx.fill();
    ctx.fillStyle = t.text;
    ctx.font = '26px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, 70, ry + ROW_H / 2);
    if (r.value) {
      ctx.fillStyle = r.on ? t.success : t.subText;
      ctx.textAlign = 'right';
      ctx.fillText(r.value, DESIGN_W - 70, ry + ROW_H / 2);
    }
    const btn: Button = { x: 40, y: ry, w: DESIGN_W - 80, h: ROW_H, label: '', kind: 'ghost', id: r.id };
    buttons.push(btn);
  });

  return buttons;
}

/**
 * 我的页。数据统计 + 皮肤收藏墙 + 功能设置。
 * 视觉语言：渐变头卡 + 玻璃统计卡 + 糖果开关。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { type Button } from './hud';
import { CANDY, THEME, type CandyColor } from './theme';
import { drawAvatar } from './hud';
import { glass, halo, pill, strokeText } from './draw';
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
const ROW_PITCH = 82;

/**
 * 绘制我的页。
 * @returns 可点击按钮列表
 */
export function drawProfilePage(ctx: CanvasRenderingContext2D, st: ProfilePageState, now: number): Button[] {
  // ── 顶部头卡：紫→蓝渐变，底部大圆角 ──
  const hg = ctx.createLinearGradient(0, 0, DESIGN_W, 320);
  hg.addColorStop(0, '#6E4BE0');
  hg.addColorStop(0.55, '#4E6BE8');
  hg.addColorStop(1, '#3AA8E8');
  ctx.fillStyle = hg;
  roundRect(ctx, -40, -80, DESIGN_W + 80, 380, 60);
  ctx.fill();

  // 头卡内高光
  ctx.save();
  roundRect(ctx, -40, -80, DESIGN_W + 80, 380, 60);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(150, 24, 260, 110, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  halo(ctx, 110, 140, 96, 'rgba(255,255,255,0.12)');
  drawAvatar(ctx, 110, 140, 62, st.avatar, st.nickname);

  strokeText(ctx, st.nickname || '玩家', 200, 116, 36, {
    align: 'left',
    stroke: 'rgba(30,16,80,0.35)',
    strokeWidth: 3,
  });

  // 等级 + 皮肤数：两颗糖果胶囊
  pill(ctx, 200, 150, 118, 36, CANDY.gold, `Lv.${st.maxLevel}`, 21);
  const skinLabel = `皮肤 ${st.unlockedSkins.length}/${st.totalSkins}`;
  strokeText(ctx, skinLabel, 336, 168, 24, {
    weight: 600,
    fill: 'rgba(255,255,255,0.92)',
    align: 'left',
  });

  // ── 数据统计卡 ──
  const stats: Array<[string, string, CandyColor]> = [
    ['最高关卡', String(st.maxLevel), CANDY.orange],
    ['总步数', String(st.totalSteps), CANDY.green],
    ['总用时', `${Math.floor(st.totalTimeMs / 60000)} 分`, CANDY.blue],
    ['看广告', `${st.adWatchCnt} 次`, CANDY.purple],
  ];
  stats.forEach(([label, value, c], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 40 + col * ((DESIGN_W - 100) / 2 + 10);
    const y = 320 + row * 118;
    const w = (DESIGN_W - 100) / 2;

    glass(ctx, x, y, w, 100, 24, { fill: 'rgba(255,255,255,0.10)' });
    // 左侧糖果圆点
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(x + 30, y + 34, 9, 0, Math.PI * 2);
    ctx.fill();

    strokeText(ctx, label, x + 50, y + 32, 21, {
      weight: 600,
      fill: THEME.subText,
      align: 'left',
    });
    strokeText(ctx, value, x + 26, y + 68, 36, {
      align: 'left',
      stroke: c.dark,
      strokeWidth: 5,
    });
  });

  // ── 皮肤收藏墙（16 个皮肤排成 8×2，避免和下方功能行粘连） ──
  strokeText(ctx, '皮肤收藏', 40, 570, 30, {
    align: 'left',
    stroke: 'rgba(8,4,30,0.5)',
    strokeWidth: 5,
  });

  const cell = 74;
  const cols = 8;
  const stepX = 84;
  const stepY = 88;
  const wallTop = 600;
  const startX = (DESIGN_W - (cols * cell + (cols - 1) * (stepX - cell))) / 2;
  const owned = new Set(st.unlockedSkins);
  SKINS.forEach((skin, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * stepX;
    const cy = wallTop + row * stepY;

    if (owned.has(skin.id)) {
      paintSkin(ctx, skin, x, cy, cell, cell, i + 1, now);
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      roundRect(ctx, x, cy, cell, cell, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    }
    ctx.lineWidth = 2;
    roundRect(ctx, x, cy, cell, cell, 16);
    ctx.stroke();

    if (!owned.has(skin.id)) drawLock(ctx, x + cell / 2, cy + cell / 2, 0.8);
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
    const ry = 812 + i * ROW_PITCH;
    // 不允许压到底部导航
    if (ry + ROW_H > DESIGN_H - 120) return;

    glass(ctx, 40, ry, DESIGN_W - 80, ROW_H, 20, { fill: 'rgba(255,255,255,0.09)', shadow: false });

    strokeText(ctx, r.label, 70, ry + ROW_H / 2, 26, {
      align: 'left',
      stroke: 'rgba(8,4,30,0.45)',
      strokeWidth: 4,
    });

    if (r.value !== undefined) {
      // 糖果开关
      const sw = 84, sh = 40, sx = DESIGN_W - 70 - sw, sy = ry + (ROW_H - sh) / 2;
      const on = r.on === true;
      ctx.fillStyle = 'rgba(8,4,30,0.45)';
      roundRect(ctx, sx, sy + 3, sw, sh, sh / 2);
      ctx.fill();
      const g = ctx.createLinearGradient(0, sy, 0, sy + sh);
      if (on) {
        g.addColorStop(0, CANDY.green.light);
        g.addColorStop(0.5, CANDY.green.base);
        g.addColorStop(1, CANDY.green.base);
      } else {
        g.addColorStop(0, 'rgba(255,255,255,0.28)');
        g.addColorStop(1, 'rgba(255,255,255,0.16)');
      }
      ctx.fillStyle = g;
      roundRect(ctx, sx, sy, sw, sh, sh / 2);
      ctx.fill();
      // 滑块
      const knobX = on ? sx + sw - sh / 2 : sx + sh / 2;
      ctx.fillStyle = 'rgba(8,4,30,0.30)';
      ctx.beginPath();
      ctx.arc(knobX, sy + sh / 2 + 2, sh / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(knobX, sy + sh / 2, sh / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
    }

    const btn: Button = { x: 40, y: ry, w: DESIGN_W - 80, h: ROW_H, label: '', kind: 'ghost', id: r.id };
    buttons.push(btn);
  });

  return buttons;
}

/** 画一把小锁（替代 emoji，跨端一致）。 */
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -6, 11, Math.PI, 0);
  ctx.stroke();
  roundRect(ctx, -16, -4, 32, 24, 6);
  ctx.fill();
  ctx.restore();
}

/**
 * 我的页。数据统计 + 皮肤收藏墙 + 功能设置。
 * 视觉语言：压扁的蓝黏土头卡 + 奶油黏土统计块 + 黏土滑轨开关。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { type Button } from './hud';
import { drawAvatar } from './hud';
import { CLAY, CLAY_UI, clayBlock, clayDisc, clayLock, clayText, rrectPts, tracePts, type ClayColor } from './clay';
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
  // ── 顶部头卡：一整块压扁的蓝黏土，左右圆角藏在屏幕外 ──
  clayBlock(ctx, -40, -80, DESIGN_W + 80, 380, 60, CLAY.blue, 701, { depth: 14, hi: 0.03, jitter: 0.002 });

  // 头卡内的一道暖光（黏土是哑光的，只能大范围低 alpha）
  ctx.save();
  tracePts(ctx, rrectPts(-40, -80, DESIGN_W + 80, 380, 60, 701, 0.002));
  ctx.clip();
  ctx.fillStyle = 'rgba(255,247,229,0.14)';
  ctx.beginPath();
  ctx.ellipse(160, 30, 280, 120, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 头像底座：一枚奶油圆片，把头像「托」在头卡上
  clayDisc(ctx, 110, 140, 70, CLAY.cream, 702, { depth: 8, hi: 0.08 });
  drawAvatar(ctx, 110, 140, 62, st.avatar, st.nickname);

  clayText(ctx, st.nickname || '玩家', 200, 116, 36, {
    align: 'left',
    fill: '#FFF6E9',
    outline: 'rgba(28,42,56,0.45)',
    outlineWidth: 4,
  });

  // 等级徽章：芥末黏土片
  clayBlock(ctx, 200, 150, 118, 38, 19, CLAY.mustard, 703, { depth: 5, hi: 0.10 });
  clayText(ctx, `Lv.${st.maxLevel}`, 259, 169, 21, {
    fill: '#4A3327',
    outlineWidth: 0,
    emboss: false,
  });
  const skinLabel = `皮肤 ${st.unlockedSkins.length}/${st.totalSkins}`;
  clayText(ctx, skinLabel, 336, 169, 24, {
    weight: 600,
    align: 'left',
    fill: 'rgba(255,246,233,0.90)',
    outlineWidth: 0,
    emboss: false,
  });

  // ── 数据统计卡：四块奶油黏土 ──
  const stats: Array<[string, string, ClayColor]> = [
    ['最高关卡', String(st.maxLevel), CLAY.terracotta],
    ['总步数', String(st.totalSteps), CLAY.mint],
    ['总用时', `${Math.floor(st.totalTimeMs / 60000)} 分`, CLAY.blue],
    ['看广告', `${st.adWatchCnt} 次`, CLAY.mustard],
  ];
  const cardW = (DESIGN_W - 80 - 20) / 2;
  stats.forEach(([label, value, c], i) => {
    const x = 40 + (i % 2) * (cardW + 20);
    const y = 320 + Math.floor(i / 2) * 118;

    clayBlock(ctx, x, y, cardW, 100, 24, CLAY.cream, 710 + i, { depth: 8, hi: 0.045, jitter: 0.004 });

    // 左侧色点
    clayDisc(ctx, x + 30, y + 34, 10, c, 720 + i, { depth: 2, hi: 0.16 });

    clayText(ctx, label, x + 50, y + 34, 21, {
      weight: 600,
      align: 'left',
      fill: CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });
    clayText(ctx, value, x + 50, y + 70, 36, {
      align: 'left',
      fill: c.dark,
      outlineWidth: 0,
      emboss: false,
    });
  });

  // ── 皮肤收藏墙（16 个皮肤排成 8×2） ──
  clayText(ctx, '皮肤收藏', 40, 570, 30, {
    align: 'left',
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
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
    const has = owned.has(skin.id);

    // 格子底板：已拥有 = 奶油，未拥有 = 沙色（压暗一档）
    clayBlock(ctx, x, cy, cell, cell, 16, has ? CLAY.cream : CLAY.sand, 730 + i, {
      depth: has ? 5 : 2,
      hi: 0.05,
      jitter: 0.004,
    });

    if (has) {
      // 皮肤纹理半透叠在黏土上（全不透明会把黏土的色阶体积盖掉）
      ctx.save();
      tracePts(ctx, rrectPts(x, cy, cell, cell, 16, 730 + i, 0.004));
      ctx.clip();
      ctx.globalAlpha = 0.88;
      paintSkin(ctx, skin, x, cy, cell, cell, i + 1, now);
      ctx.globalAlpha = 1;
      ctx.restore();
    } else {
      // 锁必须用深色：奶油锁画在沙色格子上等于没有，第一版就是这么翻车的
      clayLock(ctx, x + cell / 2, cy + cell / 2 + 2, 0.92, CLAY.board);
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
    const ry = 812 + i * ROW_PITCH;
    // 不允许压到底部导航
    if (ry + ROW_H > DESIGN_H - 120) return;

    clayBlock(ctx, 40, ry, DESIGN_W - 80, ROW_H, 20, CLAY.cream, 750 + i, { depth: 5, hi: 0.04, jitter: 0.004 });

    clayText(ctx, r.label, 70, ry + ROW_H / 2, 26, {
      align: 'left',
      fill: CLAY_UI.ink,
      outlineWidth: 0,
      emboss: false,
    });

    if (r.value !== undefined) {
      // 黏土滑轨开关
      const sw = 84, sh = 40, sx = DESIGN_W - 70 - sw, sy = ry + (ROW_H - sh) / 2;
      const on = r.on === true;
      clayBlock(ctx, sx, sy, sw, sh, sh / 2, on ? CLAY.mint : CLAY.sand, 760 + i, {
        depth: 3,
        hi: 0.06,
        lit: false,
      });
      // 滑块：一枚压在上面的奶油圆片
      const knobX = on ? sx + sw - sh / 2 : sx + sh / 2;
      clayDisc(ctx, knobX, sy + sh / 2, sh / 2 - 5, CLAY.cream, 770 + i, { depth: 4, hi: 0.14 });
    }

    const btn: Button = { x: 40, y: ry, w: DESIGN_W - 80, h: ROW_H, label: '', kind: 'ghost', id: r.id };
    buttons.push(btn);
  });

  return buttons;
}

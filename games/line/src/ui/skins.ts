/**
 * 皮肤页 UI。全部 Canvas 绘制，零 DOM。
 * `Skin` 接口与皮肤清单从 `../render/skins` 导入（唯一真相源）。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, COLORS, type Button } from './hud';
import { roundRect } from '../render/board';
import { SKINS, paintSkin, type Skin } from '../render/skins';

export interface SkinsPageState {
  /** 当前装备的皮肤 */
  equipped: string;
  /** 已解锁的皮肤 id 集合 */
  unlocked: Set<string>;
  /** 当前页（每页 9 个） */
  page: number;
}

/** 每页显示数量。 */
export const PER_PAGE = 9;

/**
 * 绘制皮肤页。
 * @returns 按钮列表
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
): Button[] {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 标题
  ctx.fillStyle = COLORS.text;
  ctx.font = '700 38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('皮肤', DESIGN_W / 2, 70);
  ctx.fillStyle = COLORS.subText;
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(`已解锁 ${st.unlocked.size} / ${SKINS.length}`, DESIGN_W / 2, 125);

  const buttons: Button[] = [];

  // 皮肤网格 3×3
  const cardW = 200;
  const cardH = 240;
  const gapX = 30;
  const gapY = 30;
  const gridW = cardW * 3 + gapX * 2;
  const startX = (DESIGN_W - gridW) / 2;
  const startY = 190;

  const visible = SKINS.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE);

  visible.forEach((skin, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    const owned = st.unlocked.has(skin.id);
    const isEquipped = st.equipped === skin.id;

    // 卡片
    ctx.fillStyle = isEquipped ? 'rgba(102,146,245,0.18)' : COLORS.panel;
    roundRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();
    ctx.strokeStyle = isEquipped ? COLORS.blue : COLORS.border;
    ctx.lineWidth = isEquipped ? 3 : 1.5;
    roundRect(ctx, x, y, cardW, cardH, 16);
    ctx.stroke();

    // 预览：用真实皮肤画 3×3 小棋盘
    const pv = 150;
    const pvX = x + (cardW - pv) / 2;
    const pvY = y + 16;
    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const size = pv / 3 - 4;
        paintSkin(ctx, skin, pvX + gx * (pv / 3) + 2, pvY + gy * (pv / 3) + 2, size, size, gx * 3 + gy + 1, now);
      }
    }

    // 名字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = owned ? COLORS.text : COLORS.subText;
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(skin.name, x + cardW / 2, y + pv + 26);

    // 状态
    if (isEquipped) {
      ctx.fillStyle = COLORS.blue;
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('使用中', x + cardW / 2, y + pv + 60);
    } else if (owned) {
      ctx.fillStyle = COLORS.subText;
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('点击装备', x + cardW / 2, y + pv + 60);
    } else {
      ctx.fillStyle = COLORS.yellow;
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(unlockLabel(skin), x + cardW / 2, y + pv + 60);
    }

    // 未解锁的遮罩（只盖预览区，条件文案留在卡片下方）
    if (!owned) {
      ctx.fillStyle = 'rgba(10,12,20,0.5)';
      roundRect(ctx, pvX - 2, pvY - 2, pv + 4, pv + 4, 10);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.font = '36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', pvX + pv / 2, pvY + pv / 2);
    }
  });

  // 底部：返回 / 翻页
  const backBtn: Button = { x: 40, y: DESIGN_H - 140, w: 160, h: 72, label: '返回', kind: 'secondary', id: 'back' };
  drawButton(ctx, backBtn, false);
  buttons.push(backBtn);

  const totalPages = Math.ceil(SKINS.length / PER_PAGE);
  if (st.page > 0) {
    const prev: Button = { x: DESIGN_W - 320, y: DESIGN_H - 140, w: 120, h: 72, label: '上一页', kind: 'ghost', id: 'prevPage' };
    drawButton(ctx, prev, false);
    buttons.push(prev);
  }
  if (st.page < totalPages - 1) {
    const next: Button = { x: DESIGN_W - 180, y: DESIGN_H - 140, w: 120, h: 72, label: '下一页', kind: 'ghost', id: 'nextPage' };
    drawButton(ctx, next, false);
    buttons.push(next);
  }

  return buttons;
}

/** 未解锁皮肤的提示文案。 */
function unlockLabel(skin: Skin): string {
  switch (skin.unlockType) {
    case 'level': return `通关第 ${skin.unlockValue} 关`;
    case 'milestone': return `通关 ${skin.unlockValue} 关`;
    case 'ad': return '看广告解锁';
    default: return '未开放';
  }
}

/** 判断点击落在哪个皮肤卡片上。 */
export function pickSkinCard(x: number, y: number, st: SkinsPageState): Skin | null {
  const cardW = 200;
  const cardH = 240;
  const gapX = 30;
  const gapY = 30;
  const gridW = cardW * 3 + gapX * 2;
  const startX = (DESIGN_W - gridW) / 2;
  const startY = 190;
  const visible = SKINS.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE);

  for (let i = 0; i < visible.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = startX + col * (cardW + gapX);
    const cy = startY + row * (cardH + gapY);
    if (x >= cx && x <= cx + cardW && y >= cy && y <= cy + cardH) {
      return visible[i];
    }
  }
  return null;
}

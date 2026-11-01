/**
 * 皮肤页 UI。全部 Canvas 绘制，零 DOM。
 * `Skin` 接口与皮肤清单从 `../render/skins` 导入（唯一真相源）。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { roundRect } from '../render/board';
import { SKINS, paintSkin, type Skin } from '../render/skins';
import { CANDY, THEME, type Theme } from './theme';
import { glass, halo, strokeText } from './draw';

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
 * @param theme 主题（现全应用同一套糖果夜空，参数保留以兼容既有调用）
 * @returns 按钮列表
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme = THEME,
): Button[] {
  // 标题
  strokeText(ctx, '皮肤', DESIGN_W / 2, 92, 42, {
    stroke: 'rgba(8,4,30,0.6)',
    strokeWidth: 7,
  });
  strokeText(ctx, `已解锁 ${st.unlocked.size} / ${SKINS.length}`, DESIGN_W / 2, 142, 24, {
    weight: 600,
    fill: THEME.subText,
  });

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

    // 装备中：糖果光晕 + 亮边
    if (isEquipped) halo(ctx, x + cardW / 2, y + cardH / 2, cardW * 0.85, 'rgba(79,195,247,0.28)');

    glass(ctx, x, y, cardW, cardH, 28, {
      fill: isEquipped ? 'rgba(79,195,247,0.20)' : 'rgba(255,255,255,0.08)',
      edge: isEquipped ? CANDY.blue.base : THEME.glassEdge,
    });
    if (isEquipped) {
      ctx.strokeStyle = CANDY.blue.base;
      ctx.lineWidth = 3;
      roundRect(ctx, x + 1, y + 1, cardW - 2, cardH - 2, 27);
      ctx.stroke();
    }

    // 预览：深色内凹板 + 真实皮肤 3×3 小棋盘
    const pv = 150;
    const pvX = x + (cardW - pv) / 2;
    const pvY = y + 16;
    ctx.fillStyle = 'rgba(8,4,30,0.42)';
    roundRect(ctx, pvX - 6, pvY - 6, pv + 12, pv + 12, 20);
    ctx.fill();

    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const size = pv / 3 - 4;
        paintSkin(ctx, skin, pvX + gx * (pv / 3) + 2, pvY + gy * (pv / 3) + 2, size, size, gx * 3 + gy + 1, now);
      }
    }

    // 名字
    strokeText(ctx, skin.name, x + cardW / 2, y + pv + 36, 25, {
      fill: owned ? '#FFFFFF' : 'rgba(214,210,255,0.62)',
      stroke: owned ? 'rgba(8,4,30,0.5)' : undefined,
      strokeWidth: 4,
    });

    // 状态
    if (isEquipped) {
      strokeText(ctx, '使用中', x + cardW / 2, y + pv + 66, 21, {
        weight: 600,
        fill: CANDY.blue.light,
      });
    } else if (owned) {
      strokeText(ctx, '点击装备', x + cardW / 2, y + pv + 66, 21, {
        weight: 600,
        fill: THEME.subText,
      });
    } else {
      strokeText(ctx, unlockLabel(skin), x + cardW / 2, y + pv + 66, 20, {
        weight: 600,
        fill: CANDY.gold.base,
      });
    }

    // 未解锁：只压暗预览区，条件文案仍可读
    if (!owned) {
      ctx.fillStyle = 'rgba(10,6,35,0.62)';
      roundRect(ctx, pvX - 6, pvY - 6, pv + 12, pv + 12, 20);
      ctx.fill();
      drawLock(ctx, pvX + pv / 2, pvY + pv / 2, 1.15);
    }
  });

  // 底部：翻页（返回由底部导航承担）
  const btnY = DESIGN_H - 300;
  const totalPages = Math.ceil(SKINS.length / PER_PAGE);
  if (st.page > 0) {
    const prev: Button = { x: DESIGN_W - 320, y: btnY, w: 120, h: 72, label: '上一页', kind: 'secondary', id: 'prevPage', tone: 'purple' };
    drawButton(ctx, prev, false, theme);
    buttons.push(prev);
  }
  if (st.page < totalPages - 1) {
    const next: Button = { x: DESIGN_W - 180, y: btnY, w: 120, h: 72, label: '下一页', kind: 'secondary', id: 'nextPage', tone: 'purple' };
    drawButton(ctx, next, false, theme);
    buttons.push(next);
  }

  return buttons;
}

/** 画一把小锁（替代 emoji，跨端一致）。 */
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(0, -7, 12, Math.PI, 0);
  ctx.stroke();
  roundRect(ctx, -17, -5, 34, 26, 7);
  ctx.fill();
  ctx.restore();
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

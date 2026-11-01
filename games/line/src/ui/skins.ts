/**
 * 皮肤页 UI。全部 Canvas 绘制，零 DOM。
 * `Skin` 接口与皮肤清单从 `../render/skins` 导入（唯一真相源）。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { drawButton, type Button } from './hud';
import { SKINS, paintSkin, type Skin } from '../render/skins';
import { THEME, type Theme } from './theme';
import { CLAY, CLAY_UI, clayBlock, clayLock, clayText, rrectPts, tracePts } from './clay';

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
 * @param theme 主题参数保留以兼容既有调用（黏土版内部不读它）
 * @returns 按钮列表
 */
export function drawSkinsPage(
  ctx: CanvasRenderingContext2D,
  st: SkinsPageState,
  now: number,
  theme: Theme = THEME,
): Button[] {
  void theme;

  // 标题
  clayText(ctx, '皮肤', DESIGN_W / 2, 92, 42, {
    fill: CLAY_UI.ink,
    outline: 'rgba(255,251,243,0.55)',
    outlineWidth: 6,
  });
  clayText(ctx, `已解锁 ${st.unlocked.size} / ${SKINS.length}`, DESIGN_W / 2, 142, 24, {
    weight: 600,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });

  const buttons: Button[] = [];

  // 皮肤网格 3×3
  const cardW = 200;
  const cardH = 248;
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

    // 卡片本体：装备中 = 薄荷黏土（最跳）／已拥有 = 奶油／未解锁 = 沙色（压暗一档）
    const cardClay = isEquipped ? CLAY.mint : owned ? CLAY.cream : CLAY.sand;
    clayBlock(ctx, x, y, cardW, cardH, 28, cardClay, 620 + i, {
      depth: isEquipped ? 13 : 8,
      hi: isEquipped ? 0.12 : 0.07,
      jitter: 0.004,
    });

    // 预览：一块深色黏土小棋盘（和游戏内棋盘同色，一眼看出这是真实皮肤）
    const pv = 150;
    const pvX = x + (cardW - pv) / 2;
    const pvY = y + 16;
    ctx.fillStyle = CLAY.boardDark.dark;
    tracePts(ctx, rrectPts(pvX - 7, pvY - 7, pv + 14, pv + 14, 20, 621 + i, 0.003));
    ctx.fill();
    ctx.fillStyle = CLAY.boardDark.base;
    tracePts(ctx, rrectPts(pvX - 6, pvY - 8, pv + 12, pv + 12, 20, 621 + i, 0.003));
    ctx.fill();

    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        const size = pv / 3 - 4;
        paintSkin(ctx, skin, pvX + gx * (pv / 3) + 2, pvY + gy * (pv / 3) + 2, size, size, gx * 3 + gy + 1, now);
      }
    }

    // 名字
    clayText(ctx, skin.name, x + cardW / 2, y + pv + 42, 25, {
      fill: owned ? CLAY_UI.ink : CLAY_UI.inkSoft,
      outlineWidth: 0,
      emboss: false,
    });

    // 状态
    if (isEquipped) {
      clayText(ctx, '使用中', x + cardW / 2, y + pv + 72, 21, {
        weight: 600,
        fill: CLAY.mint.shade,
        outlineWidth: 0,
        emboss: false,
      });
    } else if (owned) {
      clayText(ctx, '点击装备', x + cardW / 2, y + pv + 72, 21, {
        weight: 600,
        fill: CLAY_UI.inkSoft,
        outlineWidth: 0,
        emboss: false,
      });
    } else {
      clayText(ctx, unlockLabel(skin), x + cardW / 2, y + pv + 72, 20, {
        weight: 600,
        fill: CLAY.terracotta.dark,
        outlineWidth: 0,
        emboss: false,
      });
    }

    // 未解锁：压暗预览区 + 压一把锁（条件文案仍在卡外可读）
    if (!owned) {
      ctx.fillStyle = 'rgba(46,32,22,0.52)';
      tracePts(ctx, rrectPts(pvX - 6, pvY - 6, pv + 12, pv + 12, 20, 622 + i, 0.003));
      ctx.fill();
      clayLock(ctx, pvX + pv / 2, pvY + pv / 2, 1.15, CLAY.cream);
    }
  });

  // 底部：翻页（返回由底部导航承担）
  const btnY = DESIGN_H - 300;
  const totalPages = Math.ceil(SKINS.length / PER_PAGE);
  if (st.page > 0) {
    const prev: Button = { x: DESIGN_W - 320, y: btnY, w: 120, h: 72, label: '上一页', kind: 'secondary', id: 'prevPage' };
    drawButton(ctx, prev, false, theme);
    buttons.push(prev);
  }
  if (st.page < totalPages - 1) {
    const next: Button = { x: DESIGN_W - 180, y: btnY, w: 120, h: 72, label: '下一页', kind: 'secondary', id: 'nextPage' };
    drawButton(ctx, next, false, theme);
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
  const cardH = 248;
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

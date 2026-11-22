/**
 * 意见反馈弹层（我的页 →「意见反馈」）。
 *
 * ## 为什么是弹层而不是跳新页面
 *
 * 玩家产生反馈的时机是**刚被卡住**的那一下 —— 这时他最不想看到"页面切换"。
 * 弹层留在原地，关掉就回到原来的位置，心理成本最低。
 *
 * ## 文字为什么走系统键盘
 *
 * Canvas 画得出方框和光标，但画不出输入法（中文要候选词）。自己画的结果是
 * 只能打英文，而反馈恰恰是最需要说清楚的地方。所以点输入框时弹系统键盘，
 * 文字通过 `platform.inputText()` 拿回来，这里只负责显示。
 *
 * ## 截图为什么必须让玩家自己选
 *
 * 与「自动截当前画面」相比，相册选图能覆盖**闪退、支付、错误弹窗**这些
 * 画布上根本不存在的问题。代价是玩家常常没有截图 —— 所以图片**可选**，
 * 不选也能提交。
 *
 * ## 内容安全
 *
 * 玩家上传的图片与文本属于**用户生成内容**。当前只落库给后台看，
 * 不在游戏内展示给其他玩家，所以不构成"公开传播"。
 * 但如果以后要做"反馈广场"，必须先接 `security.msgSecCheck` /
 * `mediaCheckAsync` —— 见 47 文档的说明。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, type Button } from './hud';

const P = {
  ink: '#E4EDE6',
  inkSoft: '#B9B2A4',
  muted: '#7A7468',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  panel: 'rgba(22,36,30,0.98)',
  field: 'rgba(10,18,14,0.55)',
  border: 'rgba(147,179,162,0.20)',
} as const;

const CARD = {
  w: 660,
  /**
   * 卡片高度按内容收口，不留固定值。
   *
   * 76（标题基线）+ 34（副标题）+ 含 220 输入框 + 84 截图行 + 88 按钮 + 间距。
   * 初版写死 760，结果输入框和底部按钮之间空出 100px 的洞 ——
   * 弹层里出现无意义留白，会让玩家以为下半截没加载出来。
   */
  r: 40,
};
const PAD = 44;

/** 输入框高度。 */
const FIELD_H = 220;
/** 截图行高度。 */
const PICK_H = 84;
/** 按钮高度。 */
const BTN_H = 88;

/**
 * 布局常量（相对卡片顶边的偏移）。
 *
 * 抽成一组而不是散在绘制函数里各写一个数：
 * 改一处（比如输入框变高）时下面所有元素要跟着下移，
 * 分散写的话必然漏一个，表现是「截图行压在输入框上」。
 */
const L = {
  titleBase: 82,
  subBase: 116,
  fieldTop: 150,
  /** 输入框 → 截图行的间距 */
  fieldGap: 28,
  /**
   * 截图行 → 按钮行的整段间距。
   *
   * 提示文字画在这一段**中间**（`noticeBase`）。无论有没有提示，卡片高度
   * 都不变 —— 否则提交失败时卡片会长高 40px，界面跳一下，玩家会以为手抖了。
   */
  pickGap: 64,
  /** 提示文字基线（相对截图行底） */
  noticeBase: 34,
  /** 卡片底到按钮底 */
  padBottom: 44,
} as const;

/** 卡片总高（有提示行时也不变 —— 提示画在按钮上方的空隙里）。 */
const CARD_H =
  L.fieldTop + FIELD_H + L.fieldGap + PICK_H + L.pickGap + BTN_H + L.padBottom;

export interface FeedbackState {
  /** 已输入的文字 */
  text: string;
  /** 已选的截图路径（空 = 没选） */
  imagePath: string;
  /** 是否正在提交（提交中禁用按钮，避免重复提交） */
  submitting: boolean;
  /** 提交后的提示（空 = 无） */
  notice: string;
  /** 这端能不能输入文字（拿不到键盘时不显示输入框） */
  canInput: boolean;
  /** 这端能不能选图 */
  canPick: boolean;
}

/** 输入框区域（点击时弹键盘）。 */
function fieldRect(x: number, y: number) {
  return { x, y, w: CARD.w - PAD * 2, h: 220 };
}

/**
 * 画反馈弹层。
 *
 * @returns 按钮（`fbInput` / `fbPick` / `fbSubmit` / `fbCancel` / `fbClose`）
 */
export function drawFeedback(ctx: CanvasRenderingContext2D, st: FeedbackState): Button[] {
  const cx = DESIGN_W / 2;
  const x = cx - CARD.w / 2;
  const y = (DESIGN_H - CARD_H) / 2;
  const innerW = CARD.w - PAD * 2;

  // ── 遮罩 ──
  ctx.fillStyle = 'rgba(6,12,9,0.80)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // ── 卡片 ──
  roundRect(ctx, x, y, CARD.w, CARD_H, CARD.r);
  ctx.fillStyle = P.panel;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const buttons: Button[] = [];

  // ── 标题 ──
  const title = '意 见 反 馈';
  const tw = trackedWidth(ctx, title, 30, 7, 700);
  trackedText(ctx, title, cx - tw / 2, y + L.titleBase, 30, P.ink, 7, 700);

  const sub = '卡住、闪退、看不懂的地方，都告诉我们';
  const sw = trackedWidth(ctx, sub, 18, 2, 400);
  trackedText(ctx, sub, cx - sw / 2, y + L.subBase, 18, P.muted, 2, 400);

  // ── 文本框 ──
  //
  // 固定高度 220：多行输入的内容超出就截断显示（真正的全文在提交时带走）。
  // 不做滚动 —— 弹层里套滚动区，手指会分不清是在滚还是在校准。
  const f = fieldRect(x + PAD, y + L.fieldTop);
  roundRect(ctx, f.x, f.y, f.w, f.h, 22);
  ctx.fillStyle = P.field;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (st.canInput) {
    if (st.text.length === 0) {
      // 占位提示
      trackedText(ctx, '点这里开始写…', f.x + 24, f.y + 52, 20, P.muted, 1, 400);
    } else {
      // 手写换行：按字宽累加，超过框宽换行
      const maxW = f.w - 48;
      let line = '';
      let ly = f.y + 52;
      ctx.font = `400 20px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
      for (const ch of st.text) {
        if (ch === '\n') {
          trackedText(ctx, line, f.x + 24, ly, 20, P.ink, 1, 400);
          line = '';
          ly += 34;
          if (ly > f.y + f.h - 24) break;
          continue;
        }
        const test = line + ch;
        if (trackedWidth(ctx, test, 20, 1, 400) > maxW) {
          trackedText(ctx, line, f.x + 24, ly, 20, P.ink, 1, 400);
          line = ch;
          ly += 34;
          if (ly > f.y + f.h - 24) break;
        } else {
          line = test;
        }
      }
      if (line && ly <= f.y + f.h - 24) trackedText(ctx, line, f.x + 24, ly, 20, P.ink, 1, 400);
    }
    // 整个框都是可点区（点哪都能唤起键盘）
    buttons.push({ x: f.x, y: f.y, w: f.w, h: f.h, label: '', kind: 'ghost', id: 'fbInput' });
  } else {
    trackedText(ctx, '当前环境不能输入文字', f.x + 24, f.y + 52, 20, P.muted, 1, 400);
  }

  // ── 字数 ──
  const count = `${[...st.text].length} / 500`;
  const cw = trackedWidth(ctx, count, 16, 1, 400);
  trackedText(ctx, count, f.x + f.w - cw - 18, f.y + f.h - 18, 16, P.muted, 1, 400);

  // ── 截图行 ──
  const pickY = f.y + f.h + L.fieldGap;
  const picked = st.imagePath.length > 0;
  roundRect(ctx, f.x, pickY, innerW, 84, 20);
  ctx.fillStyle = picked ? 'rgba(79,122,102,0.22)' : P.field;
  ctx.fill();
  ctx.strokeStyle = picked ? P.gold : P.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const pickLabel = picked ? '已选一张截图 · 点这里换一张' : '添加截图（可选）';
  trackedText(ctx, pickLabel, f.x + 24, pickY + 50, 19, picked ? P.goldHi : P.inkSoft, 1, 400);
  if (st.canPick) {
    buttons.push({ x: f.x, y: pickY, w: innerW, h: 84, label: '', kind: 'ghost', id: 'fbPick' });
  }

  // ── 提示 ──
  if (st.notice) {
    const nw = trackedWidth(ctx, st.notice, 18, 1, 500);
    trackedText(ctx, st.notice, cx - nw / 2, pickY + PICK_H + L.noticeBase, 18, P.gold, 1, 500);
  }

  // ── 按钮行 ──
  const bh = BTN_H;
  const gap = 20;
  const halfW = (innerW - gap) / 2;
  const by = y + CARD_H - L.padBottom - bh;

  // 取消
  roundRect(ctx, f.x, by, halfW, bh, bh / 2);
  ctx.fillStyle = 'rgba(58,74,66,0.55)';
  ctx.fill();
  const cLabel = '取 消';
  const clw = trackedWidth(ctx, cLabel, 22, 5, 600);
  trackedText(ctx, cLabel, f.x + (halfW - clw) / 2, by + bh / 2 + 8, 22, P.inkSoft, 5, 600);
  buttons.push({ x: f.x, y: by, w: halfW, h: bh, label: '', kind: 'ghost', id: 'fbCancel' });

  // 提交：提交中降级成灰
  const sx = f.x + halfW + gap;
  const enabled = !st.submitting && st.text.trim().length > 0;
  roundRect(ctx, sx, by, halfW, bh, bh / 2);
  ctx.fillStyle = enabled ? 'rgba(79,122,102,0.95)' : 'rgba(58,74,66,0.45)';
  ctx.fill();
  const sLabel = st.submitting ? '提 交 中' : '提 交';
  const slw = trackedWidth(ctx, sLabel, 22, 5, 600);
  trackedText(ctx, sLabel, sx + (halfW - slw) / 2, by + bh / 2 + 8, 22,
    enabled ? P.goldHi : 'rgba(185,178,164,0.55)', 5, 600);
  if (enabled) {
    buttons.push({ x: sx, y: by, w: halfW, h: bh, label: '', kind: 'ghost', id: 'fbSubmit' });
  }

  return buttons;
}

/** 弹层的卡片矩形（点卡外关闭用）。 */
export function feedbackCardRect() {
  return {
    x: (DESIGN_W - CARD.w) / 2,
    y: (DESIGN_H - CARD_H) / 2,
    w: CARD.w,
    h: CARD_H,
  };
}

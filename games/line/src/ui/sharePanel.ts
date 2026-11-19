/**
 * 分享面板（我的页「分享挑战」点开）—— 底部抽屉。
 *
 * ## 为什么是抽屉而不是直接调起分享
 *
 * 设计稿（`2026-11-20-秘色天青-分享挑战.html` 01 屏）把它做成一个**可预览、
 * 可修改**的中间层：玩家先看到海报长什么样、文案可以换一条、再选渠道发出去。
 * 直接 `wx.shareAppMessage` 的问题是没有「反悔」和「确认」——
 * 卡片的文案玩家一眼都没看过就被发出去了，而文案正是这条链路里最影响点击率的东西。
 *
 * ## 版式来源
 *
 * 全部数值来自设计稿 01 屏的 CSS，375×812 CSS → 750×1334 画布（×2）。
 * 抽屉从底部升起，高度刚好装下「把手 + 标题 + 海报/文案 + 四渠道 + 取消」。
 */
import { DESIGN_W, DESIGN_H } from '../render/layout';
import { roundRect } from '../render/board';
import { trackedText, trackedWidth, SERIF_FONT, type Button } from './hud';

/** 面板状态。 */
export interface SharePanelState {
  /** 关号 */
  levelIdx: number;
  /** 重来次数（成绩） */
  undos: number;
  /** 昵称 */
  nickname: string;
  /** 玩家 ID（空则不显示） */
  uid: number;
  /** 当前文案（已替换占位符） */
  copy: string;
  /** 文案游标（「换一条」+1 取模） */
  copyIndex: number;
  /** 链接 query（展示用，`?l=47&undos=0&uid=88214`） */
  query: string;
  /** 分享完的反馈文案（空 = 无） */
  toast?: string;
}

/** 色板（照抄设计稿 :root）。 */
const P = {
  gold100: '#FFF3D6',
  gold200: '#F2DCA8',
  gold300: '#D4AF6A',
  gold400: '#B8945A',
  gold500: '#8A6B3C',
  c050: '#E4EDE6',
  c200: '#B8CFC0',
  c500: '#4F7A66',
  c700: '#1D3A2E',
  i050: '#F2EEE6',
  i300: '#B9B2A4',
  i500: '#7A7468',
  i700: '#454038',
} as const;

/** 四个渠道，顺序即从左到右。 */
const CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'shareWechat', label: '微 信' },
  { id: 'shareTimeline', label: '朋 友 圈' },
  { id: 'shareCopyLink', label: '复 制 链 接' },
  { id: 'shareSavePoster', label: '保 存 海 报' },
];

/**
 * 抽屉几何。
 *
 * ## 高度怎么定的（踩过一次坑）
 *
 * 初版按「设计稿 376 CSS 高 × 2 = 752」算，结果四渠道和取消键被挤出屏幕底部 ——
 * 因为设计稿是 812 高的手机，我们的画布是 1334/2 = **667** CSS。
 * 设计稿里那 376 是「812 里的 376」，占了 46%；照搬到 667 的画布里就是 376 CSS，
 * 但**内容**（把手+标题+海报228+渠道46+取消44+各段间隙）加起来已经超过 376 了
 * —— 设计稿能装下是因为它的海报缩样只有 228 CSS 高且间隙紧。
 *
 * 所以这里不复用 CSS 数值，直接按**内容累加**反推高度（见各段 Y）。
 */
const SHEET = {
  padX: 44,
  /** 顶部留白（距抽屉顶边）到海报缩样顶部 */
  topGap: 166,
  /** 海报缩样 */
  posterW: 236,
  posterH: 420,
  /** 海报/信息区底部到渠道行顶 */
  gapToChannels: 44,
  /** 渠道方块边长 */
  chBox: 88,
  /** 渠道方块下方到取消键顶 */
  gapToCancel: 56,
  /** 取消键高 */
  cancelH: 84,
  /** 取消键底部到抽屉底边 */
  bottomPad: 40,
  /**
   * 底部额外留出底栏（nav）的高度。
   *
   * 抽屉画在底栏**之上**，但底栏是 120 高的实体条（nav 顶 1214 / DESIGN_H 1334）。
   * 抽屉内容排到 1334 - 40 时，最后 120 会被底栏压住 ——
   * 所以真正可用的底边是 1334 - 120，这里把它算进高度。
   */
  navSafe: 132,
  /** 抽屉顶部（把手/标题区）总高 */
  headH: 166,
} as const;

/** 抽屉总高（由内容累加，避免手写数字和内容脱节）。 */
const SHEET_H =
  SHEET.headH +
  SHEET.posterH +
  SHEET.gapToChannels +
  SHEET.chBox +
  // 渠道文字下方留出标签高度
  36 +
  SHEET.gapToCancel +
  SHEET.cancelH +
  SHEET.bottomPad +
  SHEET.navSafe;
/**
 * 绘制分享抽屉。
 * @returns 可点击按钮（换一条 / 四渠道 / 取消 / 遮罩兜底）
 */
export function drawSharePanel(ctx: CanvasRenderingContext2D, st: SharePanelState): Button[] {
  const sheetY = DESIGN_H - SHEET_H;
  const x = SHEET.padX;
  const innerW = DESIGN_W - SHEET.padX * 2;
  const right = DESIGN_W - SHEET.padX;

  // ── 遮罩（点它关闭）──
  ctx.fillStyle = 'rgba(6,12,9,0.72)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // ── 抽屉底：三档深釉渐变 ──
  const bg = ctx.createLinearGradient(0, sheetY, 0, DESIGN_H);
  bg.addColorStop(0, '#17271F');
  bg.addColorStop(0.4, '#122019');
  bg.addColorStop(1, '#0F1B15');
  roundRect(ctx, 0, sheetY, DESIGN_W, SHEET_H + 60, 52);
  ctx.fillStyle = bg;
  ctx.fill();

  // 顶边金线
  ctx.fillStyle = 'rgba(212,175,106,0.30)';
  ctx.fillRect(0, sheetY, DESIGN_W, 2);

  // ── 把手 ──
  roundRect(ctx, DESIGN_W / 2 - 38, sheetY + 22, 76, 8, 4);
  ctx.fillStyle = 'rgba(185,178,164,0.28)';
  ctx.fill();

  // ── 标题 ──
  trackedText(ctx, '分 享 挑 战', x, sheetY + 96, 34, P.i050, 10.8, 700);
  trackedText(ctx, '带关卡 + 重来数 · 好友同关竞速', x, sheetY + 132, 18, P.i500, 4.0, 400);

  // ══ 版式全部「自上而下累加」，不用魔法偏移量 ══

  // ① 海报缩样
  const pW = SHEET.posterW;
  const pH = SHEET.posterH;
  const pX = x;
  const pY = sheetY + SHEET.topGap;
  drawPosterMini(ctx, pX, pY, pW, pH, st);

  // ② 右侧信息区
  const rX = pX + pW + 30;
  const rW = right - rX;

  // 文案（左金线 + 正文，最多两行）
  ctx.fillStyle = P.gold400;
  ctx.fillRect(rX, pY + 2, 4, 58);
  drawWrapped(ctx, `「${st.copy}」`, rX + 22, pY + 28, 25, 1.9 * 25, rW - 22, P.gold100, 2);

  // 换一条
  const refreshY = pY + 106;
  const refreshW = 168;
  const refreshH = 50;
  roundRect(ctx, rX, refreshY, refreshW, refreshH, refreshH / 2);
  ctx.fillStyle = 'rgba(212,175,106,0.07)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(212,175,106,0.30)';
  ctx.lineWidth = 2;
  ctx.stroke();
  trackedText(ctx, '换 一 条', rX + 26, refreshY + 33, 18, P.gold200, 4.0, 600);

  // 说明卡（虚线框）
  const noteY = refreshY + refreshH + 20;
  const noteH = 108;
  roundRect(ctx, rX, noteY, rW, noteH, 20);
  ctx.fillStyle = 'rgba(212,175,106,0.05)';
  ctx.fill();
  ctx.save();
  ctx.setLineDash([10, 8]);
  roundRect(ctx, rX, noteY, rW, noteH, 20);
  ctx.strokeStyle = 'rgba(212,175,106,0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  trackedText(ctx, `好友打开即达第 ${st.levelIdx} 关`, rX + 22, noteY + 42, 17, P.i300, 2.0, 400);
  trackedText(ctx, '按重来次数比胜负 · 平手算赢', rX + 22, noteY + 78, 17, P.i300, 2.0, 400);

  // query 小片（过长截断，带中文名的 encodeURIComponent 很长）
  //
  // ## 必须先解码再显示
  //
  // query 里的昵称是 `encodeURIComponent` 过的（中文名会变成
  // `%E7%93%B7%E7%94%9F` 这样一串）。直接画出来玩家只看到乱码，
  // 而且「这是什么」这件事完全传达不到。解码只影响**显示**，
  // 真正发出去的 query 仍是编码后的原串（见 main.ts 的 sendInvite）。
  const chipY = noteY + noteH + 16;
  const chipH = 42;
  let chipText = st.query;
  try {
    chipText = decodeURIComponent(st.query);
  } catch {
    // 非法编码（手动改过的链接）就原样显示，不要抛
  }
  const maxChipTextW = rW - 34;
  if (trackedWidth(ctx, chipText, 15, 1.2, 400) > maxChipTextW) {
    let cut = chipText.length;
    while (cut > 4 && trackedWidth(ctx, chipText.slice(0, cut) + '…', 15, 1.2, 400) > maxChipTextW) cut--;
    chipText = chipText.slice(0, cut) + '…';
  }
  roundRect(ctx, rX, chipY, rW, chipH, 12);
  ctx.fillStyle = 'rgba(212,175,106,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(212,175,106,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  trackedText(ctx, chipText, rX + 16, chipY + 27, 15, P.gold300, 1.2, 400);

  // ③ 四渠道：从「海报底」与「信息区底」里取更低者往下排
  const infoBottom = chipY + chipH;
  const chTop = Math.max(pY + pH, infoBottom) + SHEET.gapToChannels;
  const slotW = innerW / CHANNELS.length;
  const boxS = SHEET.chBox;

  const buttons: Button[] = [];

  CHANNELS.forEach((ch, i) => {
    const slotCx = x + slotW * (i + 0.5);
    const bx = slotCx - boxS / 2;

    roundRect(ctx, bx, chTop, boxS, boxS, 28);
    ctx.fillStyle = 'rgba(22,36,30,0.90)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(147,179,162,0.20)';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawChannelIcon(ctx, ch.id, slotCx, chTop + boxS / 2);

    const lw = trackedWidth(ctx, ch.label, 16, 3.0, 400);
    trackedText(ctx, ch.label, slotCx - lw / 2, chTop + boxS + 30, 16, P.i500, 3.0, 400);

    buttons.push({
      x: slotCx - slotW / 2 + 4,
      y: chTop - 10,
      w: slotW - 8,
      h: boxS + 52,
      label: '',
      kind: 'ghost',
      id: ch.id,
    });
  });

  // ④ 取消
  const cancelY = chTop + boxS + SHEET.gapToCancel;
  const cancelH = SHEET.cancelH;
  roundRect(ctx, x, cancelY, innerW, cancelH, cancelH / 2);
  ctx.strokeStyle = 'rgba(185,178,164,0.34)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const cl = '取 消';
  const clW = trackedWidth(ctx, cl, 22, 5.5, 600);
  trackedText(ctx, cl, x + (innerW - clW) / 2, cancelY + cancelH / 2 + 8, 22, P.i300, 5.5, 600);

  buttons.push({ x, y: cancelY, w: innerW, h: cancelH, label: '', kind: 'ghost', id: 'shareDismiss' });
  buttons.unshift({ x: rX, y: refreshY, w: refreshW, h: refreshH, label: '', kind: 'ghost', id: 'shareNewCopy' });
  // 遮罩**最后**：hitButton 线性判、先入先得，所以渠道/取消/换一条都排在它前面，
  // 空处点击才落到它身上。若放最前会把所有按钮的点击吞掉。
  buttons.push({ x: 0, y: 0, w: DESIGN_W, h: DESIGN_H, label: '', kind: 'ghost', id: 'shareDismiss' });

  return buttons;
}

/**
 * 海报缩样（128×228 CSS → 256×456）。
 *
 * 与 750×1334 大图**同构**：品牌眉 → 大关号 → 成绩 → 文案 → 落款。
 * 不直接缩放 `renderPoster` 的输出：那是另一张 9:16 的图，
 * 缩到 1:1.78 会把文案挤成一行小字，设计稿的缩样本身就是独立版式。
 */
function drawPosterMini(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  st: SharePanelState,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 24);
  ctx.clip();

  // 底：深釉 + 右上金晕
  const bg = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  bg.addColorStop(0, '#1A2B23');
  bg.addColorStop(0.55, '#122019');
  bg.addColorStop(1, '#0D1712');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);

  const glow = ctx.createRadialGradient(x + w * 0.82, y + h * 0.04, 0, x + w * 0.82, y + h * 0.04, w * 0.9);
  glow.addColorStop(0, 'rgba(212,175,106,0.16)');
  glow.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // 品牌眉
  ctx.fillStyle = P.gold300;
  ctx.font = `600 11px ${SERIF_FONT}`;
  ctx.fillText('SHARE CHALLENGE', x + w / 2, y + 34);

  ctx.fillStyle = P.c050;
  ctx.font = `700 17px ${SERIF_FONT}`;
  ctx.fillText('秘色 · 天青', x + w / 2, y + 60);

  // 大关号
  const lv = String(st.levelIdx).padStart(3, '0');
  ctx.fillStyle = P.gold200;
  ctx.font = `900 68px ${SERIF_FONT}`;
  ctx.fillText(lv, x + w / 2, y + 140);
  ctx.fillStyle = P.gold300;
  ctx.font = `600 15px ${SERIF_FONT}`;
  ctx.fillText('关', x + w / 2, y + 166);

  // 细金线
  ctx.fillStyle = P.gold400;
  ctx.fillRect(x + w / 2 - 30, y + 184, 60, 1);

  // 成绩
  const stars = st.undos === 0 ? 3 : st.undos <= 2 ? 2 : 1;
  ctx.fillStyle = P.i300;
  ctx.font = `600 14px ${SERIF_FONT}`;
  ctx.fillText(`重来 ${st.undos} 次 · ${'★'.repeat(stars)}`, x + w / 2, y + 214);

  // 文案（最多两行）。14px/28 行距 —— 16px 时「第 047 关，我不信你过得去」会挤成三行，
  // 第三行顶到落款上，缩样就脏了。
  drawWrapped(ctx, `「${st.copy}」`, x + w / 2, y + 252, 14, 28, w - 34, P.gold100, 2, true);

  // 落款
  ctx.fillStyle = P.c050;
  ctx.font = `600 16px ${SERIF_FONT}`;
  ctx.fillText(st.nickname || '我', x + w / 2, y + 340);

  ctx.fillStyle = P.i700;
  ctx.font = `600 10px ${SERIF_FONT}`;
  ctx.fillText('COVER THE BOARD', x + w / 2, y + 390);

  ctx.restore();

  // 边框
  roundRect(ctx, x, y, w, h, 24);
  ctx.strokeStyle = 'rgba(212,175,106,0.26)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** 渠道图标（线性，照设计稿的 24 viewBox 简化为直接描边）。 */
function drawChannelIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = P.c200;
  ctx.fillStyle = 'none';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = 1.9; // 21px 图标 → 画布约 40

  const L = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + x1 * s, cy + y1 * s);
    ctx.lineTo(cx + x2 * s, cy + y2 * s);
    ctx.stroke();
  };
  const A = (r: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r * s, 0, Math.PI * 2);
    ctx.stroke();
  };

  if (id === 'shareWechat') {
    // 两个交叠对话气泡（简化）
    ctx.beginPath();
    ctx.ellipse(cx - 6 * s, cy - 3 * s, 8 * s, 6.4 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx + 7 * s, cy + 4 * s, 7 * s, 5.6 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 'shareTimeline') {
    A(8.5);
    A(2.2);
    L(0, -8.5, 0, -6.5);
    L(0, 6.5, 0, 8.5);
    L(-8.5, 0, -6.5, 0);
    L(6.5, 0, 8.5, 0);
  } else if (id === 'shareCopyLink') {
    // 两节链环
    ctx.beginPath();
    ctx.arc(cx - 5 * s, cy - 5 * s, 5 * s, Math.PI * 0.25, Math.PI * 1.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 5 * s, cy + 5 * s, 5 * s, Math.PI * 1.25, Math.PI * 0.75);
    ctx.stroke();
    L(-1.4, 1.4, 1.4, -1.4);
  } else {
    // 下载
    L(0, -4, 0, 7.5);
    L(-4.5, 3, 0, 7.5);
    L(4.5, 3, 0, 7.5);
    L(-7, 11, 7, 11);
  }
  ctx.restore();
}

/**
 * 带字距的小折行（面板里用）。
 *
 * @param clamp 最多几行；超出时最后一行尾巴换省略号
 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  lineH: number,
  maxW: number,
  color: string,
  clamp: number,
  centered = false,
): void {
  ctx.font = `${size >= 26 ? 600 : 400} ${size}px ${SERIF_FONT}`;
  ctx.fillStyle = color;
  const spacing = size * 0.12;

  /**
   * 断行点：优先在标点后断。
   *
   * 逐字硬切会把 `「第 047 关，我不信你过得去」` 切成
   * 「…我不信你过得」+「去」—— 最后一行只剩一个字，读起来像排版事故。
   * 中文在这里天然有标点（逗号 / 问号），从能放下的位置往回找最近的
   * 标点即可；实在找不到（没有标点的长句）才退回硬切。
   */
  const BREAK_IDX = new Set(['，', '。', '？', '！', '、', '；', '：', ',', '?', '!', ' ']);

  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width + spacing;
    if (curW + w > maxW && cur) {
      // 在这里往回找最近的标点：把标点及其前面的部分留在本行，
      // 剩下的推到下一行。找不到就照原样硬切。
      let cut = -1;
      for (let i = cur.length; i > 0; i--) {
        if (BREAK_IDX.has(cur[i - 1])) { cut = i; break; }
      }
      if (cut > 0 && cut < cur.length) {
        lines.push(cur.slice(0, cut));
        cur = cur.slice(cut) + ch;
      } else if (cut === cur.length) {
        // 整行刚好停在标点后 —— 最理想，直接断
        lines.push(cur);
        cur = ch;
      } else {
        lines.push(cur);
        cur = ch;
      }
      curW = 0;
      for (const c of cur) curW += ctx.measureText(c).width + spacing;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur) lines.push(cur);

  const shown = lines.slice(0, clamp);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';

  shown.forEach((ln, i) => {
    let line = ln;
    // 被截断的那一行补省略号
    if (i === clamp - 1 && lines.length > clamp) line = ln.slice(0, -1) + '…';

    let total = 0;
    for (const ch of line) total += ctx.measureText(ch).width + spacing;
    total -= spacing;

    let dx = centered ? x - total / 2 : x;
    for (const ch of line) {
      ctx.fillText(ch, dx, y + i * lineH);
      dx += ctx.measureText(ch).width + spacing;
    }
  });
  ctx.textAlign = prevAlign;
}

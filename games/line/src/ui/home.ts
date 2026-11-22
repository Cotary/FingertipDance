/**
 * 主页 —— 按定稿设计稿（`docs/连连看/风格样片/2026-11-15-秘色天青-定稿Demo.html`）
 * 的 01 屏 1:1 复刻。
 *
 * ## 坐标怎么来的
 *
 * 设计稿是 375 × 812 CSS 的手机框，本项目画布是 750 × 1334 设计像素，
 * 正好是 **2 倍**。所以本文件里每个数字都满足：
 *
 *     ours = (designCss − 36) × 2      // y：−36 是设计稿的假状态栏（36 高）
 *     ours = designCss × 2             // x
 *
 * −36 这一步必须做：设计稿的顶部 36px 是画出来的「9:41 / 秘色·天青」假状态栏，
 * 而真机上状态栏在画布之外（或压在画布顶上），画布内不该再复刻一遍。
 * 去掉这 36px 之后，整页内容刚好落进 1334 − 120（底栏）的可用高度里，
 * 底部还剩 42px 的呼吸 —— 和设计稿的留白节奏一致。
 *
 * ## 版式（自上而下，一屏三件事）
 *
 * 1. 问候：左对齐「雨过天青」+ 一行副题（你在第 N 关）；
 * 2. 票券：左「继续 / 大关号」、右「∞ / 无尽」、撕口虚线下一排三格读数；
 * 3. 去向：全宽金 CTA；
 * 4. 两条信息带：无尽征途（里程碑进度）+ 分享挑战（虚线）。
 *
 * 主页**不画头像昵称**：身份属于「我的」页，首页第一眼只回答「我在哪、下一步去哪」。
 */
import { DESIGN_W } from '../render/layout';
import { roundRect } from '../render/board';
import { fillGrain } from '../render/grain';
import { trackedText, trackedTextRight, trackedWidth, type Button } from './hud';

export interface HomePageState {
  /**
   * 最高**已通关**关号（服务端 `users.max_level` 原样值）。
   *
   * 0 = 一关都没通。
   *
   * ## 注意：这不是「当前该打哪一关」
   *
   * 下一关是 `maxLevel + 1`。UI 上的「继续 第 N 关」
   * 都用**下一个可玩关号**，不要直接用这个值。
   */
  maxLevel: number;
  /**
   * 当前该打哪一关（= `maxLevel + 1`）。
   *
   * 从 `main.ts` 传进来，和服务端语义解耦 ——
   * 免得每个渲染点各自做 +1，各自理解错。
   */
  currentLevel: number;
  /** 关卡总数 */
  levelCount: number;
  /** 昵称（本页不展示，身份在「我的」页） */
  nickname: string;
  /** 头像 URL（本页不展示） */
  avatar: string;
  /** 已解锁主题数 */
  skinCount: number;
  /** 主题总数 */
  totalSkins: number;
  /** 星星总数（各关星级之和，票券「星星」格）。 */
  starCount: number;
  /** 累计重来次数（票券「重来累计」格）。 */
  totalRetries: number;
  /**
   * 是否显示「分享挑战」入口（服务端 `features.shareChallenge`）。
   *
   * 缺省 / undefined = 显示。配置没拉到时不能把入口藏了 ——
   * 分享是核心玩法的一部分，不能因为一次网络失败就消失。
   */
  shareOn?: boolean;
}

// ── 版式刻度（设计稿 CSS × 2；y 已减去 36 的假状态栏）──
const M = {
  /** 卡片外边距：22 → 44 */
  pad: 44,
  /** 文字行首：24 → 48 */
  gut: 48,
  /** 卡片宽：331 → 662 */
  cardW: DESIGN_W - 88,

  hello: 56,
  date: 114,

  ticket: 188,
  ticketH: 400,
  /** 票券内边（22+24=46 CSS → 92）：注意它比页级出血 48 更深一档 */
  ticketIn: 92,
  /** 票券右内边（22+331−24=329 → 658） */
  ticketRight: 658,

  cta: 632,
  ctaH: 124,

  world: 788,
  worldH: 220,

  share: 1036,
  shareH: 88,

  tip: 1148,
} as const;

// ── 色（定稿色板：墨石 / 青瓷 / 鎏金 / 素纸）──
const C = {
  jade: '#E4EDE6',
  jadeMid: '#D5E3D8',
  jadeBar: '#B8CFC0',
  muted: '#7A7468',
  mutedSoft: 'rgba(122,116,104,0.85)',
  gold: '#D4AF6A',
  goldHi: '#FFF3D6',
  goldFace: '#F2DCA8',
  goldDeep: '#B8945A',
  goldLine: 'rgba(212,175,106,0.28)',
  goldFaint: 'rgba(212,175,106,0.30)',
  ink: '#2A2114',
} as const;

/** 三位补零：铜牌编号的刻法。 */
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function drawHomePage(ctx: CanvasRenderingContext2D, st: HomePageState, now: number): Button[] {
  const lv = pad3(st.currentLevel);
  const right = M.pad + M.cardW - 44; // 票券右内边 658

  // ── 问候（左对齐：居中会把版心散掉）──
  trackedText(ctx, '雨过天青', M.gut, 97, 44, C.jade, 13.2, 500);
  trackedText(
    ctx,
    `无尽征途 · 从第 1 关起 —— 你在第 ${lv} 关`,
    M.gut, 138, 20, C.muted, 6.4, 500,
  );
  // 右上角品牌字：设计稿里它在假状态栏右侧，这里落在问候的同一基线上
  trackedTextRight(ctx, '秘色 · 天青', DESIGN_W - M.gut, 97, 22, C.gold, 5.2, 600);

  // ── 票券 ──
  drawTicket(ctx, st, now, lv, right);

  // ── 金 CTA：一屏一金 ──
  const btn: Button = {
    x: M.pad, y: M.cta, w: M.cardW, h: M.ctaH,
    label: st.currentLevel > 1 ? `继 续 第 ${lv} 关` : '开 始 游 戏',
    kind: 'primary', id: 'homeStart',
  };
  drawGoldCta(ctx, btn);

  // ── 无尽征途（里程碑进度）──
  drawMilestone(ctx, st);

  // ── 分享挑战（纯信息条，不接按钮 —— 不发明功能）──
  // ── 分享挑战（可点 → 去地图选一关分享）──
  //
  // 首页自己不做选关：一屏只有「当前关」，而分享的乐趣在于挑一关
  // 「我打得漂亮 / 我卡了很久」的关卡。选关交给地图 —— 那里本来就是
  // 全部关卡的列表，不用另造一个选择器。
  //
  // `shareOn === false` 时整条不画（服务端功能开关关掉了分享挑战）：
  // 画出来却被点击拦截，比不画更让人困惑。
  const shareBtn = st.shareOn === false ? null : drawShareStrip(ctx);

  // ── 底注（居中，设计稿全页唯一一条居中文字）──
  const tip = '每关首次「提示」需看激励视频 · 跳过不给星';
  trackedText(
    ctx,
    tip,
    DESIGN_W / 2 - trackedWidth(ctx, tip, 17, 3.74, 500) / 2,
    1167, 17, C.mutedSoft, 3.74, 500,
  );

  return shareBtn ? [btn, shareBtn] : [btn];
}

/** 票券：左「继续 / 047」、右「∞ / 无尽」、撕口下三格读数。 */
function drawTicket(ctx: CanvasRenderingContext2D, st: HomePageState, now: number, lv: string, right: number): void {
  const { pad, cardW, ticket: ty, ticketH: th } = M;

  roundRect(ctx, pad, ty, cardW, th, 40);
  const bg = ctx.createLinearGradient(pad, ty, pad + cardW * 0.37, ty + th * 0.93);
  bg.addColorStop(0, '#1A2B23');
  bg.addColorStop(0.58, '#142219');
  bg.addColorStop(1, '#1C2E24');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = C.goldLine;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 颗粒和柔光都按「圆角矩形」铺，不能铺外接矩形。
  //
  // ## 之前漏了 clip，圆角外会留一块淡色三角
  //
  // `fillGrain` 与径向光都是用 `fillRect(pad, ty, cardW, th)` 铺的 ——
  // 那是圆角矩形的**外接矩形**。四个圆角之外的方形区域也被涂了一层，
  // 上半部分被卡片自己的圆角挡住看不出，但左上角外侧那块
  // 恰好在深色背景上，就成了截图里那块「淡淡的三角形」。
  //
  // 呼吸用的 `arc(pad+46, ty+40, 110)` 更过分：半径 110 从票角伸出卡片外，
  // 不裁剪就会在卡片上方画出一整个半圆的淡光。
  ctx.save();
  roundRect(ctx, pad, ty, cardW, th, 40);
  ctx.clip();

  fillGrain(ctx, pad, ty, cardW, th, 0.055);

  // 票角柔光：左上一盏灯，像票根被台灯照着（设计稿 ::before 的 160px 径向光）
  const glow = ctx.createRadialGradient(pad + 46, ty + 40, 0, pad + 46, ty + 40, 160);
  glow.addColorStop(0, 'rgba(212,175,106,0.14)');
  glow.addColorStop(0.6, 'rgba(212,175,106,0.05)');
  glow.addColorStop(1, 'rgba(212,175,106,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(pad, ty, cardW, th);
  // 极缓的呼吸（幅度小到只在盯着看时才察觉）
  const breath = 0.14 + 0.03 * Math.sin(now / 1400);
  ctx.beginPath();
  ctx.arc(pad + 46, ty + 40, 110, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(212,175,106,${(breath * 0.08).toFixed(3)})`;
  ctx.fill();

  ctx.restore();

  // 左：继续 + 大关号
  trackedText(ctx, '继续', M.ticketIn, ty + 71, 26, C.goldDeep, 7.8, 600);
  trackedText(ctx, lv, M.ticketIn, ty + 197, 128, C.goldFace, 5.12, 900);

  // 右：∞ 无尽
  trackedTextRight(ctx, '∞', right, ty + 159, 60, C.jade, 0, 500);
  trackedTextRight(ctx, '无 尽', right - 10, ty + 206, 26, C.jadeMid, 7.28, 500);

  // 撕口虚线
  ctx.save();
  ctx.setLineDash([7, 9]);
  ctx.beginPath();
  ctx.moveTo(M.ticketIn, ty + 248);
  ctx.lineTo(right, ty + 248);
  ctx.strokeStyle = C.goldFaint;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 三格读数：左起排（设计稿是 gap:26 的紧凑排法，不是均分）
  const cells: Array<[string, string]> = [
    [String(st.starCount), '星星'],
    [String(st.maxLevel), '已通关'],
    [String(st.totalRetries), '重来累计'],
  ];
  let cx = M.ticketIn;
  for (const [v, k] of cells) {
    trackedText(ctx, v, cx, ty + 317, 38, C.goldHi, 2.28, 600);
    trackedText(ctx, k, cx, ty + 352, 18, C.muted, 5.4, 500);
    cx += Math.max(trackedWidth(ctx, v, 38, 2.28, 600), trackedWidth(ctx, k, 18, 5.4, 500)) + 52;
  }
}

/** 全宽金按钮：渐变金面 + 8px 厚底边（与结算页同语言）。 */
export function drawGoldCta(ctx: CanvasRenderingContext2D, b: Button): void {
  // 厚底边：先画整块深金，再把金面压在它上面 8px ——
  // 圆角必须与面同半径，否则方角会从按钮底下露出来（设计稿是 box-shadow 跟随圆角）
  roundRect(ctx, b.x, b.y + 8, b.w, b.h, 32);
  ctx.fillStyle = '#8A6B3C';
  ctx.fill();

  ctx.save();
  ctx.shadowColor = 'rgba(212,175,106,0.22)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, b.x, b.y, b.w, b.h, 32);
  const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
  g.addColorStop(0, C.goldFace);
  g.addColorStop(0.82, C.goldDeep);
  g.addColorStop(1, '#A9853F');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  trackedText(ctx, b.label, b.x + b.w / 2 - trackedWidth(ctx, b.label, 34, 10.2, 700) / 2, b.y + 74, 34, C.ink, 10.2, 700);
}

/**
 * 无尽征途卡：青瓷圆章 + 一段里程碑说明 + 进度条。
 *
 * 文案口径：**每 100 关**一个里程碑（地图上的百关大圈），卡里只报「下一个里程碑」。
 * （旧口径是每 10 关 —— 地图上的朱砂旗删了、里程碑标记换成百关大圈后，
 * 频率跟着走 100，两块界面说的是同一件事。）
 */
function drawMilestone(ctx: CanvasRenderingContext2D, st: HomePageState): void {
  const my = M.world;
  const next = Math.floor(st.currentLevel / 100) * 100 + 100;
  const left = Math.max(1, next - st.currentLevel);

  roundRect(ctx, M.pad, my, M.cardW, M.worldH, 36);
  const mg = ctx.createLinearGradient(M.pad, my, M.pad + M.cardW * 0.5, my + M.worldH * 0.87);
  mg.addColorStop(0, '#24382C');
  mg.addColorStop(1, '#1A2B21');
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(147,179,162,0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 颗粒必须裁在圆角内（理由同 `drawTicket`：铺外接矩形会在圆角外留淡色块）
  ctx.save();
  roundRect(ctx, M.pad, my, M.cardW, M.worldH, 36);
  ctx.clip();
  fillGrain(ctx, M.pad, my, M.cardW, M.worldH, 0.055);
  ctx.restore();

  // 青瓷圆章（52 → 104）
  const ex = M.pad + 42 + 52;
  const ey = my + 110;
  const eg = ctx.createRadialGradient(ex - 18, ey - 20, 4, ex, ey, 54);
  eg.addColorStop(0, C.jadeBar);
  eg.addColorStop(0.58, '#6E9E82');
  eg.addColorStop(1, '#2D5245');
  ctx.beginPath();
  ctx.arc(ex, ey, 52, 0, Math.PI * 2);
  ctx.fillStyle = eg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  trackedText(ctx, '∞', ex - trackedWidth(ctx, '∞', 38, 0, 900) / 2, ey + 14, 38, '#1D332A', 0, 900);

  // 文案块（徽章右缘 ex+52，文字从 ex+84 起）
  const tx = ex + 84;
  const tw = M.pad + M.cardW - 40 - tx;
  trackedText(ctx, '无 尽 征 途', tx, my + 67, 30, C.jade, 7.8, 600);
  // 副题按「·」分段折行：绝不把「距里程碑 100」从中间断开（那是读数，不是句子）
  const segs = ['第 1 关起', '机制渐次登场', `距里程碑 ${pad3(next)}`, `还差 ${left} 关`];
  const lines: string[] = [];
  for (const seg of segs) {
    const last = lines.length - 1;
    const merged = last >= 0 ? `${lines[last]} · ${seg}` : seg;
    if (last >= 0 && trackedWidth(ctx, merged, 19, 2.2, 500) <= tw) lines[last] = merged;
    else lines.push(seg);
  }
  lines.forEach((ln, i) => {
    trackedText(ctx, ln, tx, my + 101 + i * 36, 19, C.muted, 2.2, 500);
  });

  // 进度条（5 → 10 高）
  const bx = tx;
  const bw = tw;
  const by = my + 172;
  roundRect(ctx, bx, by, bw, 10, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  const ratio = st.currentLevel % 100 === 0 ? 1 : (st.currentLevel % 100) / 100;
  roundRect(ctx, bx, by, Math.max(10, bw * ratio), 10, 5);
  const fg = ctx.createLinearGradient(bx, by, bx + bw, by);
  fg.addColorStop(0, '#6E9180');
  fg.addColorStop(1, C.jadeBar);
  ctx.fillStyle = fg;
  ctx.fill();
}

/** 分享挑战条：虚线金框 + 左标题右说明。 */
/** 分享挑战条：虚线金框 + 左标题右说明 —— **可点**，点了去地图选关。 */
function drawShareStrip(ctx: CanvasRenderingContext2D): Button {
  const sy = M.share;
  const btn: Button = {
    x: M.pad, y: sy, w: M.cardW, h: M.shareH,
    label: '', kind: 'ghost', id: 'homeSharePick',
  };

  roundRect(ctx, M.pad, sy, M.cardW, M.shareH, 28);
  ctx.fillStyle = 'rgba(212,175,106,0.05)';
  ctx.fill();
  ctx.save();
  ctx.setLineDash([6, 8]);
  roundRect(ctx, M.pad, sy, M.cardW, M.shareH, 28);
  ctx.strokeStyle = C.goldFaint;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  const baseline = sy + 53;
  trackedText(ctx, '分享挑战', M.pad + 38, baseline, 24, C.goldFace, 7.2, 600);

  // 右箭头：这条现在能点了，必须给一个「可以进去」的视觉线索。
  //
  // 先量箭头的宽度，再从右缘倒推文字右界 —— 早先直接把箭头画在
  // 文字右对齐的位置上，结果箭头压住了「好友」两个字。
  const arrowW = 10;
  const arrowRight = M.pad + M.cardW - 34;
  const arrowX = arrowRight - arrowW;
  const textRight = arrowX - 16;

  trackedTextRight(ctx, '选一关发给好友', textRight, baseline, 18, C.muted, 2.16, 500);

  ctx.strokeStyle = C.goldFaint;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(arrowX, baseline - 13);
  ctx.lineTo(arrowX + arrowW, baseline - 6);
  ctx.lineTo(arrowX, baseline + 1);
  ctx.stroke();

  return btn;
}

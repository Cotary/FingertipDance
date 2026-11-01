import { platform } from './platform';
import { configureAds } from './platform/wechat';
import { fetchFriends, fetchLeaderboard, fetchProfile, fetchStars, login, fetchConfig, reportProgress, reportSkip, reportChallenge, reportEvent, type ServerConfig } from './net/api';
import { Session } from './game/session';
import { LevelStore, ProgressStore } from './game/progressStore';
import { DESIGN_W, DESIGN_H } from './render/layout';
import { drawBoard, drawEndpoints, roundRect } from './render/board';
import { drawTrail } from './render/trail';
import { Fx } from './render/fx';
import { audio } from './render/audio';
import { SKINS, skinById } from './render/skins';
import { drawSkinsPage, pickSkinCard, PER_PAGE, type SkinsPageState } from './ui/skins';
import { ads } from './ads/ads';
import { needsAdForHint, canSkipToday, markSkippedToday } from './ads/rewardRules';
import { tracker } from './analytics/tracker';
import { drawHud, drawProgressBar, drawResult, drawButton, hitButton, type Button } from './ui/hud';
import { drawHomePage, type HomePageState } from './ui/home';
import { drawMapView, createMapState, pickMapNode, scrollToLevel, type MapViewState } from './ui/mapview';
import { drawRankPage, createRankState, type RankPageState } from './ui/leaderboard';
import { drawProfilePage, type ProfilePageState } from './ui/profile';
import { drawNav, pickNavTab, type NavTab } from './ui/nav';
import { LOBBY_THEME } from './ui/theme';
import { nightSky, glass, strokeText } from './ui/draw';
import { CLAY, clayBackdrop } from './ui/clay';
import { CANDY } from './ui/theme';
import { publishProfile } from './platform/openData';
import { parseChallenge, buildShareQuery } from './game/challenge';
import { renderPoster, shareCopy } from './ui/share';
import { findHint } from './core/solver';
import { CellType } from './core/types';
import type { GameState } from './game/state';

const { canvas, width, height, dpr } = platform.getCanvas();
const ctx = canvas.getContext('2d')!;

const scale = Math.min(width / DESIGN_W, height / DESIGN_H);
const offsetX = (width - DESIGN_W * scale) / 2;
const offsetY = (height - DESIGN_H * scale) / 2;

const session = new Session();
const levels = new LevelStore();
const progress = new ProgressStore();
const fx = new Fx();

let lastFrameAt = Date.now();
let winAnimStart = 0;
let waveLit = new Set<number>();

/** 页面状态机。大厅体系 5 页 + 游戏内 2 页 + 加载态。 */
type Phase =
  | 'loading'
  | 'home'
  | 'map'
  | 'skins'
  | 'rank'
  | 'profile'
  | 'playing'
  | 'result';

let config: ServerConfig | null = null;
let phase: Phase = 'loading';
let resultButtons: Button[] = [];
let resultData: { levelIdx: number; steps: number; shortest: number; timeMs: number; unlockedSkin: { id: string; name: string } | null } | null = null;
let pressedBtn: string | null = null;
let pendingLevel = 1;

let skinsPage: SkinsPageState = {
  equipped: 'wood',
  unlocked: new Set(['wood', 'mint']),
  page: 0,
};
let skinButtons: Button[] = [];

/** 主页大厅。 */
let homePage: HomePageState = {
  maxLevel: 1,
  levelCount: 1000,
  nickname: '玩家',
  avatar: '',
  skinCount: 2,
  totalSkins: 16,
};
let homeButtons: Button[] = [];

/** 关卡地图。 */
let mapPage: MapViewState = createMapState(1, 1000, {});
let mapButtons: Button[] = [];
/** 地图拖动会话（区分拖动与点击）。 */
let mapDragStart: { x: number; y: number; scrollY: number; moved: boolean } | null = null;

/** 排行榜。 */
let rankPage: RankPageState = createRankState();
let rankButtons: Button[] = [];

/** 我的页。 */
let profilePage: ProfilePageState = {
  nickname: '玩家',
  avatar: '',
  maxLevel: 1,
  totalSteps: 0,
  totalTimeMs: 0,
  adWatchCnt: 0,
  unlockedSkins: ['wood', 'mint'],
  totalSkins: 16,
  soundOn: true,
  vibrateOn: true,
};
let profileButtons: Button[] = [];

/** 当前挑战上下文（若来自好友分享）。 */
let challenge: ReturnType<typeof parseChallenge> = null;
/** 挑战结算结果。 */
let challengeResult: { win: boolean; mySteps: number; bestSteps: number; fromName: string; isNewBest: boolean } | null = null;

/** 画布坐标 → 设计坐标。 */
function toDesign(clientX: number, clientY: number): { x: number; y: number } {
  if (platform.name === 'wechat') {
    return { x: (clientX - offsetX) / scale, y: (clientY - offsetY) / scale };
  }
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvas.width / rect.width);
  const py = (clientY - rect.top) * (canvas.height / rect.height);
  return { x: (px / dpr - offsetX) / scale, y: (py / dpr - offsetY) / scale };
}

/** 顶部操作按钮。 */
const hintBtn: Button = { x: DESIGN_W - 210, y: 100, w: 90, h: 60, label: '提示', kind: 'ghost', id: 'hint' };
const skipBtn: Button = { x: DESIGN_W - 110, y: 100, w: 90, h: 60, label: '跳过', kind: 'ghost', id: 'skip' };
const backHomeBtn: Button = { x: 40, y: 100, w: 90, h: 60, label: '返回', kind: 'ghost', id: 'backHome' };

/** 需要显示底部导航的页面。 */
const NAV_PAGES: NavTab[] = ['home', 'map', 'skins', 'rank', 'profile'];

/** 当前 phase 是否属于大厅体系（有底部导航）。 */
function isNavPhase(p: Phase): boolean {
  return (NAV_PAGES as string[]).includes(p);
}

/** 当前 phase 对应的导航页签。 */
function navTabOf(p: Phase): NavTab {
  switch (p) {
    case 'map': return 'map';
    case 'skins': return 'skins';
    case 'rank': return 'rank';
    case 'profile': return 'profile';
    default: return 'home';
  }
}

/** 切换到某个导航页。 */
async function gotoTab(tab: NavTab): Promise<void> {
  reportEvent('nav_click', { tab });
  ads.hideBanner();

  switch (tab) {
    case 'home':
      phase = 'home';
      break;
    case 'map': {
      mapPage = createMapState(progress.current.maxLevel, config?.levelCount ?? 1000, progress.current.stars);
      // 首次进入地图聚焦当前关
      mapPage.scrollY = Math.min(mapPage.maxScrollY, scrollToLevel(progress.current.maxLevel));
      mapDragStart = null;
      phase = 'map';
      break;
    }
    case 'skins':
      phase = 'skins';
      ads.showBanner();
      reportEvent('skin_page_view', { owned: skinsPage.unlocked.size, total: SKINS.length });
      break;
    case 'rank':
      phase = 'rank';
      await loadGlobalRank();
      break;
    case 'profile':
      phase = 'profile';
      profilePage = {
        ...profilePage,
        nickname: progress.current.nickname || '玩家',
        avatar: progress.current.avatar || '',
        maxLevel: progress.current.maxLevel,
        totalSteps: progress.current.totalSteps,
        totalTimeMs: progress.current.totalTimeMs,
        adWatchCnt: progress.current.adWatchCnt,
        unlockedSkins: progress.current.unlockedSkins,
        totalSkins: SKINS.length,
      };
      reportEvent('profile_view', { max_level: progress.current.maxLevel });
      break;
  }
}

/** 拉取总榜。 */
async function loadGlobalRank(): Promise<void> {
  rankPage.global.loading = true;
  try {
    const res = await fetchLeaderboard();
    rankPage.global = { list: res.list, myRank: res.myRank, total: res.total, loading: false };
  } catch {
    rankPage.global.loading = false;
  }
}

session.on((e) => {
  if (e.type === 'won') {
    audio.win();
    if (challenge) void onChallengeWin(e.steps, e.timeMs, e.path);
    else void onWin(e.steps, e.timeMs, e.path);
  }
  if (e.type === 'break') { audio.break(); platform.vibrate(); }
  if (e.type === 'moved') {
    audio.light();
    const st = session.state;
    if (st && session.layout) {
      fx.burstAt(e.idx, st.level.w, session.layout.cell, session.layout.originX, session.layout.originY, '#F2C14E');
    }
    reportEvent('tile_light', { level_idx: session.state?.level.idx });
  }
  if (e.type === 'abandoned') reportEvent('level_abandon', { level_idx: session.state?.level.idx });
});

/** 通关处理：上报成绩。 */
async function onWin(steps: number, timeMs: number, path: number[], skipped = false) {
  const level = session.state!.level;
  // 通关波次动画（约 1.2 秒），结算页延后出现
  winAnimStart = Date.now();
  fx.clear();
  reportEvent('level_pass', { level_idx: level.idx, steps, time_ms: timeMs, skipped });

  let unlockedSkin: { id: string; name: string } | null = null;
  try {
    const res = await reportProgress(level.idx, steps, timeMs, path);
    unlockedSkin = res.unlockedSkin;
    if (res.unlockedSkin) {
      progress.unlockSkin(res.unlockedSkin.id);
      audio.unlock();
      platform.vibrate();
    }
    progress.sync({
      maxLevel: res.maxLevel,
      unlockedSkins: res.unlockedSkins,
      totalTimeMs: res.totalTimeMs,
      totalSteps: res.totalSteps,
    });
    // 本地即时更新该关星级，地图页无需等下次拉取
    progress.setStar(level.idx, res.stars);
  } catch (e) {
    console.error('上报成绩失败', e);
  }

  resultData = {
    levelIdx: level.idx,
    steps,
    shortest: level.shortest,
    timeMs,
    unlockedSkin,
  };
  pendingLevel = level.idx + 1;

  // 发布进度到开放数据域（好友榜才准）
  publishMyProfile();

  // 结算页延后出现，让通关波次动画播完；入场后再延迟 500ms 弹插屏
  setTimeout(() => {
    phase = 'result';
    setTimeout(() => { void ads.showInterstitial('result_interstitial'); }, 500);
  }, 1200);
}

/** 挑战模式通关：不推进主线，走 /api/challenge。 */
async function onChallengeWin(steps: number, timeMs: number, path: number[]) {
  const level = session.state!.level;
  let isNewBest = false;
  let best = { steps: level.shortest, timeMs: 0 };
  try {
    const res = await reportChallenge(level.idx, steps, timeMs, path);
    isNewBest = res.isNewBest;
    best = res.best;
  } catch (e) {
    console.error('提交挑战成绩失败', e);
  }

  reportEvent('challenge_result', {
    from_uid: challenge?.fromUid,
    level_idx: level.idx,
    win: steps <= best.steps,
    is_new_best: isNewBest,
  });

  winAnimStart = Date.now();
  fx.clear();
  setTimeout(() => {
    phase = 'result';
    challengeResult = {
      win: steps <= best.steps,
      mySteps: steps,
      bestSteps: best.steps,
      fromName: challenge?.fromName ?? '好友',
      isNewBest,
    };
  }, 1200);
}

/** 进入关卡。 */
async function enterLevel(idx: number) {
  const lv = await levels.ensure(idx, config?.levelVersion ?? '');
  if (!lv) {
    console.error('关卡加载失败', idx);
    return;
  }
  session.load(lv);
  phase = 'playing';
  winAnimStart = 0;
  waveLit = new Set();
  fx.clear();
  reportEvent('level_start', { level_idx: idx, diff: lv.diff, w: lv.w, h: lv.h });
}

/** 使用提示。 */
async function useHint() {
  const st = session.state;
  if (!st || (st.phase !== 'idle' && st.phase !== 'dragging')) return;
  const head = st.path.length ? st.path[st.path.length - 1] : findStartIdx(st);
  const hint = findHint(st.level.grid, { x: head % st.level.w, y: Math.floor(head / st.level.w) }, 2);
  if (hint.length === 0) {
    console.log('当前无法给出提示');
    return;
  }

  // 首次使用需看广告
  let viaAd = false;
  if (needsAdForHint(st.level.idx, st.hintUsed)) {
    const ok = await ads.showRewarded('hint');
    if (!ok) return; // 中途退出 → 不给提示
    viaAd = true;
  }

  session.setHint(hint);
  reportEvent('hint_use', { level_idx: st.level.idx, via_ad: viaAd });
}

/** 跳过关卡。 */
async function useSkip() {
  const st = session.state;
  if (!st) return;
  if (!canSkipToday(st.level.idx)) {
    console.log('本关今天已跳过');
    return;
  }
  const ok = await ads.showRewarded('skip');
  if (!ok) return;

  markSkippedToday(st.level.idx);
  await reportSkip(st.level.idx);
  session.markSkipped();
  reportEvent('skip_use', { level_idx: st.level.idx, via_ad: true });
  void onWin(st.level.shortest, 0, [], true);
}

/** 广告解锁皮肤。 */
async function unlockByAd(skinId: string) {
  const ok = await ads.showRewarded('skin_unlock');
  if (!ok) return;
  progress.unlockSkin(skinId);
  skinsPage.unlocked.add(skinId);
  skinsPage.equipped = skinId;
  progress.equipSkin(skinId);
  audio.unlock();
  reportEvent('skin_unlock', { skin_id: skinId, via: 'ad' });
}

/** 从服务端刷新进度（切后台回前台时）。 */
async function refreshProgress() {
  try {
    const res = await fetchProfile();
    progress.sync({
      maxLevel: res.maxLevel,
      unlockedSkins: res.unlockedSkins,
      totalTimeMs: res.totalTimeMs,
      totalSteps: res.totalSteps,
    });
    skinsPage.unlocked = new Set(progress.current.unlockedSkins);
  } catch { /* 用本地缓存兜底 */ }
}

/** 发布自己的进度到开放数据域（好友榜）。 */
function publishMyProfile() {
  publishProfile({
    maxLevel: progress.current.maxLevel,
    totalTimeMs: progress.current.totalTimeMs,
    totalSteps: progress.current.totalSteps,
    skinCount: progress.current.unlockedSkins.length,
    nickname: progress.current.nickname || '玩家',
    avatar: progress.current.avatar || '',
    updatedAt: Date.now(),
  });
}

/** 分享：生成海报 + 调起分享。 */
function doShare() {
  const st = session.state;
  if (!st) return;
  const query = buildShareQuery({ levelIdx: st.level.idx, steps: st.level.shortest });
  const poster = renderPoster(st.level, progress.current.currentSkin, st.level.shortest, '我');
  if (platform.name === 'web' && poster.toDataURL) {
    const url = poster.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `level-${st.level.idx}.png`;
    a.click();
  }
  void platform.share({ title: shareCopy(st.level.idx, st.level.shortest), query });
  reportEvent('share_click', { level_idx: st.level.idx });
}

/** 绘制挑战结算面板。 */
function drawChallengeResult(ctx: CanvasRenderingContext2D, r: { win: boolean; mySteps: number; bestSteps: number; fromName: string; isNewBest: boolean }): Button[] {
  ctx.fillStyle = 'rgba(6,3,24,0.80)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  const px = 50, py = 380, pw = DESIGN_W - 100, ph = 480;

  // 面板：胜负两种色调
  const accent = r.win ? CANDY.green : CANDY.coral;
  ctx.fillStyle = r.win ? 'rgba(126,217,87,0.20)' : 'rgba(255,107,107,0.20)';
  roundRect(ctx, px - 6, py - 6, pw + 12, ph + 12, 50);
  ctx.fill();

  const pg = ctx.createLinearGradient(0, py, 0, py + ph);
  pg.addColorStop(0, '#3A2E92');
  pg.addColorStop(1, '#1C1658');
  ctx.fillStyle = pg;
  roundRect(ctx, px, py, pw, ph, 44);
  ctx.fill();

  ctx.strokeStyle = accent.base;
  ctx.lineWidth = 3;
  roundRect(ctx, px + 1.5, py + 1.5, pw - 3, ph - 3, 43);
  ctx.stroke();

  strokeText(ctx, r.win ? '挑战成功！' : '惜败', DESIGN_W / 2, py + 66, 48, {
    fill: r.win ? CANDY.green.light : CANDY.coral.light,
    stroke: '#160F45',
    strokeWidth: 7,
  });

  strokeText(ctx, `${r.fromName} 的挑战`, DESIGN_W / 2, py + 140, 26, {
    weight: 600,
    fill: '#D6D2FF',
  });
  strokeText(ctx, `我的步数 ${r.mySteps} · 最佳 ${r.bestSteps}`, DESIGN_W / 2, py + 190, 26, {
    weight: 600,
    fill: '#D6D2FF',
  });

  if (r.isNewBest) {
    glass(ctx, DESIGN_W / 2 - 160, py + 222, 320, 52, 26, { fill: 'rgba(255,213,79,0.22)' });
    strokeText(ctx, '刷新最佳纪录！', DESIGN_W / 2, py + 248, 26, {
      fill: CANDY.gold.light,
      stroke: CANDY.gold.dark,
      strokeWidth: 4,
    });
  }

  const retry: Button = { x: 120, y: py + 300, w: DESIGN_W - 240, h: 80, label: '再试一次', kind: 'primary', id: 'retry', tone: 'green' };
  const shareBtn: Button = { x: 120, y: py + 400, w: DESIGN_W - 240, h: 64, label: '分享', kind: 'secondary', id: 'share', tone: 'blue' };
  drawButton(ctx, retry, false);
  drawButton(ctx, shareBtn, false);
  return [retry, shareBtn];
}

/** 拉取好友榜数据（只拉数据、不切页；好友榜是排行榜页的一个 Tab）。 */
async function openFriends() {
  rankPage.friends.loadingOpenData = true;
  reportEvent('leaderboard_view', { scope: 'friends', my_rank: rankPage.friends.myRank });

  // 服务端好友列表（Web 兜底 + 统计）
  try {
    const res = await fetchFriends();
    rankPage.friends.friends = res.list;
    rankPage.friends.stats = res.stats;
  } catch { /* 忽略 */ }

  // 发布自己的进度到开放数据域
  publishMyProfile();

  // 开放数据域首帧需要时间
  setTimeout(() => { rankPage.friends.loadingOpenData = false; }, 500);
}

/** 找起点索引。 */
function findStartIdx(st: GameState): number {
  for (let y = 0; y < st.level.h; y++) {
    for (let x = 0; x < st.level.w; x++) {
      if (st.level.grid[y][x].type === CellType.START) return y * st.level.w + x;
    }
  }
  return 0;
}

/** 指针按下。 */
function onDown(clientX: number, clientY: number) {
  const d = toDesign(clientX, clientY);

  // ── 大厅体系：先判导航栏（导航栏压在所有页面内容之上）──
  if (isNavPhase(phase)) {
    const tab = pickNavTab(d.x, d.y);
    if (tab) { pressedBtn = 'nav:' + tab; return; }
  }

  if (phase === 'home') {
    for (const b of homeButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }
  if (phase === 'map') {
    for (const b of mapButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    // 命中关卡节点 → 可能是点击，也可能是拖动起点
    const idx = pickMapNode(d.x, d.y, mapPage);
    if (idx > 0) {
      pressedBtn = 'map:' + idx;
      mapDragStart = { x: d.x, y: d.y, scrollY: mapPage.scrollY, moved: false };
    } else {
      // 空白处也可拖动滚动
      mapDragStart = { x: d.x, y: d.y, scrollY: mapPage.scrollY, moved: false };
    }
    return;
  }
  if (phase === 'rank') {
    for (const b of rankButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }
  if (phase === 'profile') {
    for (const b of profileButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }
  if (phase === 'skins') {
    const skin = pickSkinCard(d.x, d.y, skinsPage);
    if (skin) {
      if (skinsPage.unlocked.has(skin.id)) {
        // 装备
        skinsPage.equipped = skin.id;
        progress.equipSkin(skin.id);
        audio.unlock();
        reportEvent('skin_equip', { skin_id: skin.id });
      } else if (skin.unlockType === 'ad') {
        void unlockByAd(skin.id);
      }
      return;
    }
    for (const b of skinButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }
  if (phase === 'result') {
    for (const b of resultButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }

  if (phase !== 'playing') return;
  if (hitButton(backHomeBtn, d.x, d.y)) { pressedBtn = 'backHome'; return; }
  if (hitButton(hintBtn, d.x, d.y)) { pressedBtn = 'hint'; return; }
  if (hitButton(skipBtn, d.x, d.y)) { pressedBtn = 'skip'; return; }
  session.pointerDown(d.x, d.y);
}

/** 指针移动。 */
function onMove(clientX: number, clientY: number) {
  const d = toDesign(clientX, clientY);

  // 地图拖动滚动
  if (phase === 'map' && mapDragStart) {
    const dy = d.y - mapDragStart.y;
    if (Math.abs(dy) > 6) mapDragStart.moved = true;
    if (mapDragStart.moved) {
      const next = mapDragStart.scrollY - dy;
      mapPage.scrollY = Math.max(0, Math.min(mapPage.maxScrollY, next));
    }
    return;
  }

  if (phase !== 'playing') return;
  session.pointerMove(d.x, d.y);
}

/** 指针抬起。 */
function onUp() {
  // 地图拖动结束必须在 pressedBtn 分支之前处理，否则 'map:N' 会先被消费掉
  if (phase === 'map' && mapDragStart) {
    const wasMoved = mapDragStart.moved;
    mapDragStart = null;
    if (wasMoved) { pressedBtn = null; return; }
  }

  if (pressedBtn) {
    const id = pressedBtn;
    pressedBtn = null;

    // 底部导航
    if (id.startsWith('nav:')) { void gotoTab(id.slice(4) as NavTab); return; }

    // 大厅 / 地图
    if (id === 'homeStart') {
      reportEvent('home_start_click', { level_idx: progress.current.maxLevel });
      void enterLevel(progress.current.maxLevel || 1);
      return;
    }
    if (id === 'navHome') { void gotoTab('home'); return; }
    if (id.startsWith('map:')) {
      const idx = parseInt(id.slice(4), 10);
      if (idx <= progress.current.maxLevel) {
        reportEvent('map_level_click', { level_idx: idx });
        void enterLevel(idx);
      } else {
        mapPage.toast = `先通过第 ${progress.current.maxLevel} 关`;
        mapPage.toastAt = Date.now();
      }
      return;
    }

    // 排行榜 Tab
    if (id === 'tabGlobal') { rankPage.tab = 'global'; reportEvent('leaderboard_tab_switch', { tab: 'global' }); return; }
    if (id === 'tabFriends') {
      rankPage.tab = 'friends';
      reportEvent('leaderboard_tab_switch', { tab: 'friends' });
      void openFriends();
      return;
    }

    // 我的页功能行
    if (id === 'toggleSound') { profilePage.soundOn = !profilePage.soundOn; return; }
    if (id === 'toggleVibrate') { profilePage.vibrateOn = !profilePage.vibrateOn; return; }
    if (id === 'shareGame') { void doShare(); return; }
    if (id === 'clearCache') { platform.storage.remove('levels_cache'); return; }

    // 游戏内
    if (id === 'hint') void useHint();
    else if (id === 'skip') void useSkip();
    else if (id === 'backHome') { phase = 'home'; return; }
    else if (id === 'next') void enterLevel(pendingLevel);
    else if (id === 'home') { phase = 'home'; challenge = null; challengeResult = null; return; }
    else if (id === 'retry') { challengeResult = null; void enterLevel(challenge ? challenge.levelIdx : pendingLevel); }
    else if (id === 'share') doShare();
    else if (id === 'skins') { phase = 'skins'; ads.showBanner(); reportEvent('skin_page_view', { owned: skinsPage.unlocked.size, total: SKINS.length }); }
    else if (id === 'back') { phase = 'home'; ads.hideBanner(); }
    else if (id === 'prevPage') skinsPage.page = Math.max(0, skinsPage.page - 1);
    else if (id === 'nextPage') skinsPage.page = Math.min(Math.ceil(SKINS.length / PER_PAGE) - 1, skinsPage.page + 1);
    return;
  }
  if (phase === 'playing') {
    const wasDragging = session.state?.phase === 'dragging';
    session.pointerUp();
    // 松手未通关 → 记一次 level_fail
    if (wasDragging && session.state && session.state.phase !== 'won') {
      reportEvent('level_fail', { level_idx: session.state.level.idx, steps: session.state.path.length - 1 });
    }
  }
}

// 事件绑定（平台分支）
if (platform.name === 'web') {
  canvas.addEventListener('pointerdown', (e) => onDown(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
} else {
  type TouchEvent = { touches: Array<{ clientX: number; clientY: number }> };
  const wx = (globalThis as {
    wx?: {
      onTouchStart?: (cb: (e: TouchEvent) => void) => void;
      onTouchMove?: (cb: (e: TouchEvent) => void) => void;
      onTouchEnd?: (cb: () => void) => void;
      onTouchCancel?: (cb: () => void) => void;
      onHide?: (cb: () => void) => void;
      onShow?: (cb: () => void) => void;
    };
  }).wx;
  wx?.onTouchStart?.((e: TouchEvent) => { const t = e.touches[0]; if (t) onDown(t.clientX, t.clientY); });
  wx?.onTouchMove?.((e: TouchEvent) => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); });
  wx?.onTouchEnd?.(() => onUp());
  wx?.onTouchCancel?.(() => onUp());
  wx?.onHide?.(() => {
    void tracker.flush();   // 补传埋点
    session.abandon();
  });
  wx?.onShow?.(() => { void refreshProgress(); });
}

/** 记录帧时间。 */
function tick() {
  const now = Date.now();
  const dt = Math.min(50, now - lastFrameAt);
  lastFrameAt = now;
  return { now, dt };
}

/** 更新通关波次点亮状态（从终点反向扩散）。 */
function updateWave(now: number) {
  waveLit = new Set();
  const st = session.state;
  if (!st || !winAnimStart) return;
  const elapsed = now - winAnimStart;
  const total = st.path.length;
  for (let i = 0; i < total; i++) {
    const delay = (total - 1 - i) * 60;
    if (elapsed >= delay) waveLit.add(st.path[i]);
  }
}

/** 渲染循环。 */
function frame() {
  const { now, dt } = tick();
  updateWave(now);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr * scale, dpr * scale);
  ctx.translate(offsetX / dpr, offsetY / dpr);

  // 背景分两套，按页面切换（黏土改造进行中，见 docs/23-UI风格方案.md）：
  // 已迁移 → 陶土桌面；未迁移 → 夜空。全量迁移完成后只留 clayBackdrop。
  if (phase === 'home' || phase === 'playing' || phase === 'result') {
    clayBackdrop(ctx);
  } else {
    nightSky(ctx, now);
  }

  const st = session.state;
  if (st && session.layout && (phase === 'playing' || phase === 'result')) {
    const lit = new Set(st.lit);
    for (const idx of waveLit) lit.add(idx);

    drawBoard(ctx, st.level, session.layout, {
      lit,
      path: st.path,
      hint: st.hint,
      shakeCell: st.shakeCell,
      shakeAt: st.shakeAt,
    }, skinById(progress.current.currentSkin), now);

    drawTrail(ctx, st.path, st.level.w, session.layout, CLAY.terracotta);
    // 端点圆片必须在连线之后，否则线头会横穿圆片、把「起」「终」压成一团
    drawEndpoints(ctx, st.level, session.layout);

    drawHud(ctx, st.level.idx, progress.current.currentSkin, progress.current.unlockedSkins.length, config?.skins?.length ?? 13);
    drawProgressBar(ctx, progress.current.maxLevel, config?.levelCount ?? 1000);

    // 顶部按钮
    drawButton(ctx, hintBtn, pressedBtn === 'hint');
    drawButton(ctx, skipBtn, pressedBtn === 'skip');
    drawButton(ctx, backHomeBtn, pressedBtn === 'backHome');

    // 挑战模式横幅
    if (challenge) {
      glass(ctx, 40, 60, DESIGN_W - 80, 64, 32, { fill: 'rgba(179,136,255,0.85)', edge: 'rgba(255,255,255,0.55)' });
      strokeText(ctx, `${challenge.fromName} 的挑战 · 第 ${challenge.levelIdx} 关`, DESIGN_W / 2, 92, 26, {
        stroke: CANDY.purple.dark,
        strokeWidth: 4,
      });
    }
  }

  // 特效（粒子 + 扩散环）
  fx.update(ctx, dt);

  // ── 大厅体系页面 ──
  if (phase === 'home') {
    homePage = {
      ...homePage,
      maxLevel: progress.current.maxLevel,
      skinCount: progress.current.unlockedSkins.length,
    };
    homeButtons = drawHomePage(ctx, homePage, now);
  }
  if (phase === 'map') {
    // 星级与最高关可能在通关后变化，每帧对齐一次
    mapPage.stars = progress.current.stars;
    mapPage.maxLevel = progress.current.maxLevel;
    mapButtons = drawMapView(ctx, mapPage, now);
  }
  if (phase === 'rank') {
    rankButtons = drawRankPage(ctx, rankPage, now);
  }
  if (phase === 'profile') {
    profileButtons = drawProfilePage(ctx, profilePage, now);
  }
  if (phase === 'skins') {
    skinButtons = drawSkinsPage(ctx, skinsPage, now, LOBBY_THEME);
  }

  // ── 底部导航 ──
  if (isNavPhase(phase)) {
    drawNav(ctx, navTabOf(phase), now);
  }

  if (phase === 'result' && challengeResult) {
    resultButtons = drawChallengeResult(ctx, challengeResult);
  } else if (phase === 'result' && resultData) {
    resultButtons = drawResult(
      ctx, resultData.levelIdx, resultData.steps, resultData.shortest,
      resultData.timeMs, resultData.unlockedSkin,
      progress.current.maxLevel / (config?.levelCount ?? 1000),
    );
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** 启动。 */
async function boot() {
  tracker.init();
  progress.restore();
  try {
    const loginRes = await login();
    reportEvent('login_success', { uid: loginRes.uid, is_new: (loginRes.maxLevel || 1) <= 1 });
    progress.sync({
      maxLevel: loginRes.maxLevel || 1,
      unlockedSkins: loginRes.unlockedSkins,
      totalTimeMs: loginRes.totalTimeMs,
      totalSteps: loginRes.totalSteps,
      nickname: loginRes.nickname || '玩家',
      avatar: loginRes.avatar || '',
    });
    skinsPage.equipped = progress.current.currentSkin;
    skinsPage.unlocked = new Set(progress.current.unlockedSkins);
    config = await fetchConfig();
    if (platform.name === 'wechat' && config.ad) {
      configureAds({
        rewardedVideoId: config.ad.rewardedVideoId,
        interstitialId: config.ad.interstitialId,
      });
    }
    await levels.init(config.levelVersion);
    challenge = parseChallenge();
    // 分享挑战 → 直接进关卡；普通启动 → 回大厅
    if (challenge) {
      await enterLevel(challenge.levelIdx);
    } else {
      phase = 'home';
      homePage = {
        ...homePage,
        maxLevel: progress.current.maxLevel,
        levelCount: config?.levelCount ?? 1000,
        nickname: progress.current.nickname || '玩家',
        avatar: progress.current.avatar || '',
        skinCount: progress.current.unlockedSkins.length,
        totalSkins: SKINS.length,
      };
      // 异步拉星级，不阻塞进大厅
      void fetchStars()
        .then((res) => progress.setStars(res.stars))
        .catch(() => { /* 忽略 */ });
    }
    reportEvent('app_start', {});
  } catch (e) {
    console.error('启动失败', e);
    phase = 'loading';
  }
}
boot();

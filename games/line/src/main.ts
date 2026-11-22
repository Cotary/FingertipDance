import { platform, configureAds, configureDouyinAds, ensurePrivacyAuthorized, type ShareChannel } from './platform';
import { ApiError } from './platform/apiError';
import { fetchFriends, fetchLeaderboard, fetchProfile, fetchStars, login, fetchConfig, localPlatformCode, reportCoverProgress, reportCoverSkip, reportCoverChallenge, createShareChallenge, fetchChallengeInfo, fetchCoverHint, reportEvent, debugJump, debugRepairProgress, unlockReward, reportAdWatch, updateProfile, type ServerConfig, type CoverChallengeOutcome } from './net/api';
import { CoverSession } from './game/coverSession';
import { CoverLevelStore } from './game/coverLevelStore';
import { buildCoverRuntime, decodeCoverLevel } from './game/coverLevel';
import { findCoverHint } from './game/coverHint';
import { ProgressStore } from './game/progressStore';
import { DESIGN_W, DESIGN_H, cardOf } from './render/layout';
import { createViewport } from './render/viewport';
import { drawCoverCells, drawCoverEndpoints, drawCoverFreeStartHint, drawCoverHead, drawCoverMarks, drawCoverPlate } from './render/coverBoard';
import { drawCoverTrail } from './render/coverTrail';
import { Fx } from './render/fx';
import { audio } from './render/audio';
import { SKINS, skinById } from './render/skins';
import { drawSkinsPage, pickThemeChip, pickSkinChip, themeIdAt, isThemeOwned, isSkinOwned, ownedSkinCount, unlockedThemeCount, shelfCount, stepThemeScroll, stepSkinScroll, clampShelfScroll, clampSkinScroll, type SkinsPageState } from './ui/skins';
import { themeById, applyThemeUnlocks } from './render/themes';
import { enterTotalMs, enterTempo, enterSettleDelays } from './render/themes/kit';
import { cellType, CoverCell } from './core/cover/v3/types';
import { ads } from './ads/ads';
import { needsAdForHint, markSkippedToday, applyRewardFrequency, skipBlockReason } from './ads/rewardRules';
import { tracker } from './analytics/tracker';
import {
  drawHud, drawPlayFootnote, drawPlayTip, drawPlayLegend, drawPlaySub, drawResult, drawButton, hitButton,
  drawWinSeal, starOfCover as starOfCoverLocal, type Button,
} from './ui/hud';
import { drawHomePage, type HomePageState } from './ui/home';
import {
  createMapState, pickMapNode, scrollToLevel, isLevelPlayable, isLevelCleared, stepMapScroll,
  pickRail, railScrollAt, type MapViewState,
} from './ui/mapview';
import { drawMapView } from './ui/mapdraw';
import { drawRankPage, createRankState, type RankPageState } from './ui/leaderboard';
import { drawProfilePage, type ProfilePageState } from './ui/profile';
import { drawStatsPanel } from './ui/statsPanel';
import { drawAgeGate, KEY_AGE_ACK } from './ui/ageGate';
import { drawSharePanel, type SharePanelState } from './ui/sharePanel';
import { drawNav, pickNavTab, type NavTab } from './ui/nav';
import { LOBBY_THEME } from './ui/theme';
import { drawWallWipe, WIPE_MS } from './ui/wipe';
import { CLAY, CLAY_UI, clayBlock, clayText } from './ui/clay';
import { drawLobbyGround } from './ui/ground';
import { drawBootSplash } from './ui/splash';
import { publishProfile, refreshOpenData } from './platform/openData';
import { parseChallenge, parseChallengeFrom, buildShareQuery, resolveShareBase } from './game/challenge';
import { DEBUG_ENABLED } from './core/debug';
import { applyDebugJumpInput, createDebugJumpState, drawDebugJump, type DebugJumpState } from './ui/debugjump';
import { renderPoster, renderShareCard, shareCopy, shareCopyCount, type PosterCanvas } from './ui/share';

/**
 * 画布的 CSS 尺寸与设备像素比。
 *
 * 必须是 `let` —— 窗口尺寸变了要重新测量（见 `applyResize`）。
 */
const { canvas, width: initWidth, height: initHeight, dpr: initDpr } = platform.getCanvas();
const ctx = canvas.getContext('2d')!;
let width = initWidth;
let height = initHeight;
let dpr = initDpr;

/**
 * 视口：设计坐标系 ↔ 屏幕 ↔ 设备像素。
 *
 * 渲染和输入**必须走同一个视口对象** —— 否则两边各算各的，
 * 就会出现「鼠标点 A 格、游戏响应 B 格」（见 `render/viewport.ts` 的历史 bug 说明）。
 *
 * ## 必须是 `let`
 *
 * 窗口尺寸变了要重建它（见 `applyResize`）——
 * 画布尺寸变了但视口还是旧的，点击位置就会整体偏移。
 */
let viewport = createViewport({
  width,
  height,
  dpr,
  designWidth: DESIGN_W,
  designHeight: DESIGN_H,
});

/**
 * cover 模式会话（v3）。
 *
 * 经典模式（`Session`）已下线 —— cover 模式是现行玩法：
 * 一条路铺满整张图，不交叉、不重复。
 */
const session = new CoverSession();
const levels = new CoverLevelStore();
const progress = new ProgressStore();
const fx = new Fx();

/** 星级总和（主页票券「星星」、我的页统计共用一个口径）。 */
function totalStars(): number {
  return Object.values(progress.current.stars ?? {}).reduce((a, b) => a + (b ?? 0), 0);
}

let lastFrameAt = Date.now();
let winAnimStart = 0;
let waveLit = new Set<number>();

/**
 * 按压反馈的时刻与落点（拍平索引，-1 = 无）。
 *
 * 只记**最近一次**：拖动时一帧可能连亮三格，三圈金环同时扩散会糊成一片光斑。
 * 视觉上"最后一格刚被按下"才是真的，前面几格已经落定了。
 */
let pressCell = -1;
let pressAt = 0;
/**
 * 落子：格 → 落下的时刻。
 *
 * 和 `pressCell` 的区别是**记全部**：拖动时连亮三格，三块色片是依次落下的
 * （每格都有自己的时刻），而"按下"只有最后一格才需要扩散尘环。
 * 一张 11×11 的盘最多 121 条，不用清，重开关卡时整体换掉。
 */
let dropAt = new Map<number, number>();
/** 最近一次延长连线的时刻（沥金从上一格"堆"到这一格）。 */
let trailAt = 0;
/**
 * 棋盘进场时刻：整盘逐格从上往下落。
 *
 * 重开一关也重播 —— 盘面确实是被"重新铺了一遍"，不是接着上一局的盘。
 * 进结算页 / 回大厅时不清：那时根本不画盘面，留着也无害，
 * 反而省掉一处"忘了清 → 下次进关直接从半空开始"的坑。
 */
let enterAt = 0;
/**
 * 进场收尾（玉磬 + 轻震）的定时器。
 *
 * 留着 id 是为了能停：跳过开场时（「不回放过程」）要把没响的收尾掐掉，
 * 否则跳完之后音效还在自顾自播，又变成"动画完了音效还没结束"。
 */
let enterCueTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 用户是否要求减少动效（`prefers-reduced-motion: reduce`）。
 *
 * 设计稿「伍·初始界面 / 亮·沙光收尾」写了降级规则：
 * 「**prefers-reduced-motion** 降级：不做坠落，逐行淡亮 180ms + 60ms 行间，保留行序节奏」。
 *
 * 注意它**不是关掉入场** —— 行序节奏要保留（那是这一屏的叙事：
 * 残片一行一行贴回去），只是把"坠落 + 触底压扁 + 扬尘"换成"淡亮"。
 * 所以这里不设 `enterAt = 0`（那会整盘瞬间出现，连节奏都没了）。
 */
let reduceMotion = false;
try {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  reduceMotion = !!mq?.matches;
  // 运行中改了系统设置也要跟上（用户可能在游戏开着时切换）
  mq?.addEventListener?.('change', (e) => {
    reduceMotion = e.matches;
  });
} catch {
  // 老环境没有 matchMedia：当成"不降级"，比当成降级安全
  reduceMotion = false;
}
/** 通关逐格落定：格 → 亮起时刻（铺满级联）。 */
let waveAt = new Map<number, number>();
/** 波次步进（设计稿 48ms 一粒；天青/黏土管线也吃这个值）。 */
const WAVE_STEP_MS = 48;
/**
 * 通关级联跑完的时刻（相对 `winAnimStart`），以及盖印相对它的等待。
 *
 * 设计稿的顺序是**级联 → 土埙 → 盖印**：`铺满级联` 最后那一粒落定，
 * 才轮到石章砸下来。所以印不能和第一粒同时出现 —— 一格一格还在落的时候
 * 印已经压在盘心，读起来是"还没铺完就宣布结束了"。
 *
 * 这两个数在通关那一帧算一次，音（`audio.win` 的 `at`）、触感（盖印的 40ms）
 * 和画（`winSeal` 的 `elapsed`）全都从同一条时间线出发。
 */
let winCascadeMs = 0;
/** 土埙比末粒再晚一点起（设计稿 `N*48 + 120`，这里以末粒为 0 折算）。 */
const WIN_XUN_GAP = 168;
/** 印落定的时刻（相对盖印开始）。与 `ThemeMotion.seal.at` 同一个数。 */
const WIN_SEAL_HIT = 175;
/** 盖印相对 `winAnimStart` 的延迟（0 = 当场落印，没有级联的主题）。 */
let winSealAt = 0;

/**
 * 当前装备的主题。
 *
 * `frame()` 里那份 `boardTheme` 是**局部**的（只在盘面阶段有值），
 * 而通关时序、切页转场这些事发生在盘面之外 —— 所以这里单独给一个。
 */
/**
 * 当前主题。**渲染层唯一的主题入口** —— 降级覆盖也挂在这里。
 *
 * ## 为什么在入口处改，而不是在每处调用点判断
 *
 * `prefers-reduced-motion` 只影响两件事：进场的**坠落形态**、以及盖印的抖墙。
 * 如果在 `startLevel` / 绘制 / 音画收尾三处各判一次，三处迟早会不一致
 * （一处按坠落算时长、一处按淡亮算，末格沙光就会早到或迟到）。
 * 覆写在入口，下游拿到的就是"这一局真正该用的参数"。
 *
 * 覆盖只改 `enter`，且**只改形态参数**（不删 `pulse`）：设计稿要求
 * 「不做坠落，逐行淡亮 180ms + 60ms 行间，**保留行序节奏**」，
 * 所以行序、错峰、末行沙光都还在，只是每格不再从上方掉下来。
 */
function currentTheme() {
  const th = themeById(progress.current.currentTheme);
  if (!reduceMotion || !th?.motion?.enter) return th;
  // 降级版：每格 180ms 淡亮（`ms`），行内不额外错峰（`step: 0`），
  // 行间 60ms —— 逐行推进的节奏靠 `row` 撑住，而不是靠每格掉落。
  return {
    ...th,
    motion: {
      ...th.motion,
      enter: {
        ...th.motion.enter,
        ms: 180,
        step: 0,
        row: 60,
        lift: 0,
        swell: 1,
        // 淡亮不做"落定"位移，也就不需要大盘压缩（行数 × 60ms 本来就很短）
        sweep: undefined,
        // 画法：`settle` 形态 = 原地淡入，没有坠落位移
        form: 'settle' as const,
      },
    },
  };
}

/**
 * 通关级联要跑多久（ms）。没有 `settle` 动效的主题 = 0（整段跳过）。
 *
 * 这个数决定三件事：土埙什么时候起、印制什么时候砸、结算页什么时候出现。
 * 分散在三处各算一遍迟早会走偏，所以只在这里算一次。
 */
function cascadeMs(): number {
  const n = session.state?.path.length ?? 0;
  if (!currentTheme()?.motion?.settle || n < 2) return 0;
  return (n - 1) * WAVE_STEP_MS;
}

/** 无效落子的抖动（点石头 / 没钥匙开门 / 撞单向门）。 */
let shakeCell = -1;
let shakeAt = 0;

/**
 * 切页 · 剥壁揭示。
 *
 * 只在**进出盘面**时用：大厅是陶土台面，抹一层沙墙就是错的世界。
 * 主题没给 `wipe` 配色（黏土 / 天青）也整段跳过 —— 那几套的页面不是墙。
 *
 * 方向恒定向右退（和设计稿演示同一方向）。不按"前进/后退"翻向：
 * 剥壁是**同一块墙被抹开**，不是空间位移，翻向只会让人以为页面在排队。
 */
let wipeAt = 0;
let wipeSkin: import('./render/themes/types').BoardTheme['wipe'] | null = null;
/** 上一帧的页面；null = 还没跑过第一帧（首帧不该触发转场） */
let peekPhase: Phase | null = null;

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

/**
 * 应用服务端下发的运营配置。
 *
 * ## 为什么集中在一个函数里
 *
 * 这些值分散在广告、分享、提示、跳过、主题五处消费。
 * 各消费点自己去 `config?.xxx` 取值的话，「配置没拉到时用什么」
 * 这个问题就会被回答五遍，而且五遍未必一致 ——
 * 最糟的一种是某一处忘了兜底，界面直接少一个按钮。
 *
 * 这里一次性把配置**推到各模块**，消费点只问模块本身：
 * `ads` 知道自己的频控、`rewardRules` 知道免费次数、主题表知道自己什么时候解锁。
 *
 * 广告位 ID 两端**不共用**（各自后台创建），混填的表现是
 * 「广告加载失败」—— 客户端看起来只是「点了没反应」。
 */
function applyServerConfig(cfg: ServerConfig): void {
  const ad = cfg.ad;
  if (ad) {
    const ids = {
      rewardedVideoId: ad.rewardedVideoId,
      interstitialId: ad.interstitialId,
      bannerId: ad.bannerId,
    };
    if (platform.name === 'wechat') {
      configureAds(ids);
    } else if (platform.name === 'douyin') {
      // 抖音端这条此前**从未被调用**：`boot()` 只判了 wechat，
      // 于是抖音包一直在用 `adunit-placeholder`。现在按平台各配各的。
      configureDouyinAds(ids);
    }
    ads.applyFrequency(ad);
    applyRewardFrequency(ad);
  }

  // 主题只覆盖「解锁条件」。list 为空时 `applyThemeUnlocks` 会还原本地值 ——
  // 服务端不下发就不动，避免一次配置失误清空玩家的主题墙。
  applyThemeUnlocks(cfg.themes);
}

/**
 * 功能开关。
 *
 * `config` 还没拉回来 / 拉取失败时一律按**开**处理：
 * 分享、提示、跳过都是核心玩法的一部分，
 * 不能因为一次网络失败就让它们从界面上消失。
 */
function featureOn(name: 'hint' | 'skip' | 'shareChallenge'): boolean {
  if (!config?.features) return true;
  return config.features[name] !== false;
}

/**
 * 分享链接的基址。
 *
 * ## 为什么不能直接 `location.origin`
 *
 * 小游戏端**没有 `location`**（`wx` / `tt` 环境里访问它是 undefined）。
 * 这也是之前审计出的崩溃点之一：从「复制链接」走一遍就会抛
 * `Cannot read properties of undefined`。
 *
 * 优先级：
 *   1. Web 端用当前页面地址（本地调试时复制出来的链接能直接打开）
 *   2. 服务端下发的 `shareUrlPrefix`（小游戏端的唯一真源）
 *   3. `location` 存在时的 origin（兜底：老服务端不下发前缀）
 *
 * 都没有就返回空串，由调用方提示「分享域名未配置」——
 * 拼一个 `?l=47` 出去，好友点开只会看到首页。
 */
function shareBaseUrl(): string {
  return resolveShareBase({
    isWeb: platform.name === 'web',
    shareUrlPrefix: config?.shareUrlPrefix,
    location: (globalThis as { location?: { origin?: string; pathname?: string } }).location,
  });
}

let phase: Phase = 'loading';
/**
 * 战绩弹层是否打开。
 *
 * 不新增 `Phase`：它是**长在我的页上**的模态层，不是独立页面。
 * 做成 Phase 意味着要在 `isNavPhase` / 转场 / 底栏绘制里各处特判，
 * 而弹层关闭后必须回到「同一个」我的页（含滚动位置等），
 * 用布尔量在原地开合最不容易出错。
 */
let statsPanelOpen = false;
let statsPanelButtons: Button[] = [];

/**
 * 适龄提示弹层。
 *
 * ## 为什么是全局模态，而不是只挂在我的页
 *
 * 它是**首次启动**就要出现的合规提示 —— 那时玩家还在大厅或直接进关。
 * 挂在某一页上就得在每页都判一次，还不如做成压在所有页面之上的模态。
 *
 * 与 `statsPanelOpen` / `sharePanelOpen` 的区别：那两个是玩家主动打开的，
 * 这个是我们主动弹的；所以它在 `onDown` 里**最先**拦截，
 * 包括调试面板都要让位（合规提示没点掉之前，什么都不该被点到）。
 */
let ageGateOpen = false;
let ageGateButtons: Button[] = [];

/**
 * 分享抽屉（我的页「分享挑战」点开）。
 *
 * 与 `statsPanelOpen` 同理：是**叠在我的页上的模态层**，不占一个 Phase。
 * 两个弹层互斥 —— 同时开着会叠两层遮罩，点关闭只关掉最上面那层。
 */
let sharePanelOpen = false;
let sharePanelButtons: Button[] = [];
/**
 * 抽屉是从哪一页打开的 —— 关掉抽屉要退回这页。
 *
 * 大厅三个入口都能开抽屉（首页选关 / 地图 / 通关结算 / 我的页），
 * 靠 `phase` 自己判断不出来：抽屉是**叠在页面上**的模态层，
 * `phase` 在抽屉开着时仍然是原页面的值，但如果在抽屉里换了 tab
 * 或玩家切后台回来，就需要一个显式记录来复位。
 */
let sharePanelFrom: Phase = 'profile';
/**
 * 这次分享是否宣称成绩。
 *
 * ## 为什么不能只看 `sharePanel.undos`
 *
 * `undos = 0` 有两种完全相反的含义：
 *   - **挑战**：我真的一次都没重来（三星，最好的成绩）；
 *   - **邀请**：我不宣称任何成绩（面板里 undos 缺省填 0）。
 *
 * 只看数字分不出来。用错的话，一次纯邀请会被写成「我零重来通关」——
 * 好友打开看到的是一个我根本没拿到的分数，而且他几乎必输。
 *
 * 所以用这个显式标记，由 `openSharePanel` 的调用方决定。
 */
let sharePanelHasScore = false;
const sharePanel: SharePanelState = {
  levelIdx: 1,
  undos: 0,
  nickname: '我',
  uid: 0,
  copy: '',
  copyIndex: 0,
  query: '',
};
let resultButtons: Button[] = [];
let resultData: { levelIdx: number; steps: number; shortest: number; timeMs: number; unlockedSkin: { id: string; name: string } | null; undos: number; skipped?: boolean; rejected?: boolean } | null = null;
let pressedBtn: string | null = null;
let pendingLevel = 1;

/**
 * 全局提示条（画在所有页面之上）。
 *
 * ## 为什么需要它
 *
 * 以前所有失败路径都只有 `console.error` —— 界面上零反馈。
 * 玩家点「下一关」而关卡加载失败时，看到的就是「点了没反应」，
 * 根本不知道发生了什么。提示条是最低限度的用户可见反馈。
 */
let toastMsg = '';
let toastAt = 0;
/** 提示条的展示时长（毫秒）。 */
let toastMs = 2400;

/** 显示一条提示（默认 2.4 秒）。 */
function showToast(msg: string, ms = 2400): void {
  toastMsg = msg;
  toastAt = Date.now();
  // 记录时长，绘制时按它算淡出
  toastMs = ms;
}

let skinsPage: SkinsPageState = {
  tab: 'themes',
  equipped: 'wood',
  selected: 'wood',
  unlocked: new Set(['wood', 'mint']),
  page: 0,
  themeSelected: '',
  themeEquipped: '',
  maxLevel: 0,
  unlockedThemes: new Set(),
  // 调试构建里八套全部可试 —— 否则测试环境要先打通 1000 关才能看到深海
  themeAllUnlocked: DEBUG_ENABLED,
};

/**
 * 把「进度」同步到皮肤页的状态。
 *
 * 三处都要调：启动、服务端回包、以及每次进皮肤页。
 * 少一处就会出现「刚装备的主题切后台回来变回去了」这类状态不一致。
 */
function syncSkinsPage(): void {
  skinsPage.equipped = progress.current.currentSkin;
  skinsPage.unlocked = new Set(progress.current.unlockedSkins);
  skinsPage.unlockedThemes = new Set(progress.current.unlockedThemes ?? []);
  skinsPage.themeEquipped = progress.current.currentTheme ?? '';
  skinsPage.maxLevel = progress.current.maxLevel;
  // 展台默认摆「正在用的那一套」，而不是每次都从第一格开始
  if (!skinsPage.themeSelected) skinsPage.themeSelected = skinsPage.themeEquipped;
}
let skinButtons: Button[] = [];

/** 主页大厅。 */
let homePage: HomePageState = {
  maxLevel: 0,
  currentLevel: 1,
  levelCount: 1000,
  nickname: '玩家',
  avatar: '',
  skinCount: 2,
  totalSkins: 16,
  starCount: 0,
  totalRetries: 0,
};
let homeButtons: Button[] = [];

/** 关卡地图。 */
let mapPage: MapViewState = createMapState(1, 1000, {}, DEBUG_ENABLED);
let mapButtons: Button[] = [];
/**
 * 地图拖动会话（区分拖动与点击）。
 *
 * `v` 是最近一段的滚动速度（设计像素 / 毫秒）：抬手时交给 `fling` 继续跑。
 * 没有它，一次划动只能走一个屏幕 —— 1000 关要划四十多次，这正是
 * 「地图不能快速拖动」的一半原因（另一半是右侧导轨）。
 */
let mapDragStart: {
  x: number;
  y: number;
  scrollY: number;
  moved: boolean;
  lastY: number;
  lastAt: number;
  v: number;
} | null = null;
/** 导轨拖动：只记手指相对滑块顶部的偏移（null = 没在拖导轨）。 */
let mapRailGrab: number | null = null;

/**
 * 主题货架的拖动状态。
 *
 * 货架有 12 张卡、一屏只放得下 3 行，所以必须能拖。这里的 `moved` 门槛（8px）
 * 是为了区分「想选这套主题」和「想往下看」—— 没有它，每次滑动都会顺手改掉选中项。
 */
let shelfDragStart: {
  /** 拖的是哪一块：主题货架 / 皮肤网格（两块的滚动字段不同） */
  kind: 'theme' | 'skin';
  y: number;
  scroll: number;
  moved: boolean;
  lastY: number;
  lastAt: number;
  v: number;
} | null = null;

/**
 * 调试面板：关卡直达（**仅测试环境**）。
 *
 * 展开时它压在一切之上 —— 所有输入先给它，剩下的才轮到下面那一页。
 * 生产构建里 `DEBUG_ENABLED` 恒为 `false`，`drawDebugJump` 与这段状态一起被删掉。
 */
let debugPanel: DebugJumpState = createDebugJumpState();
let debugJumpButtons: Button[] = [];

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
  soundOn: true,
  vibrateOn: true,
  starCount: 0,
  totalRetries: 0,
  threeStarCount: 0,
  currentLevel: 1,
  uid: 0,
};

/**
 * 音效偏好落盘的 key。
 *
 * **不进 `ProgressStore`**：那份数据会被服务端回包整体覆盖
 * （`progress.sync` 直接改字段），本地开关混进去会在某次登录后被重置。
 * 音效是设备偏好，不是账号进度 —— 换手机重启默认开，是对的。
 */
const KEY_SOUND = 'sound_off';

/**
 * 振动偏好落盘的 key（与音效同一套理由）。
 *
 * 这个开关以前和音效开关一样是**死的**：改了 `profilePage.vibrateOn`，
 * 振动调用从来没读过它。现在所有振动都走 `vibe()`，它在中间挡一道。
 */
const KEY_VIBRATE = 'vibrate_off';

/**
 * 振动反馈。`pattern` 语义同 `navigator.vibrate`：数字 = 振多少毫秒，
 * 数组 = 振/停交替。
 *
 * 时长全部照设计稿：落子 8 / 连径 15 / 铺满 `[10,25,10,25,18]` /
 * 盖印 40 / 按钮 5。**不许统一成"震一下"** —— 手感是节奏，
 * 五件事用同一个时长，等于告诉手指"这五件事没有区别"。
 */
function vibe(pattern?: number | number[]): void {
  if (!profilePage.vibrateOn) return;
  platform.vibrate(pattern);
}

/** 触感的五个槽位。主题可以整套覆盖（见 `BoardTheme.haptics`）。 */
type VibeSlot = 'step' | 'trail' | 'settle' | 'seal' | 'tap';

/**
 * 通用那组触感（设计稿 · 鸣沙丹青）。
 *
 * 五档 + 一个**按钮档**：按钮不属于某个动作，它是 UI 的"我收到了"，
 * 所以任何主题都不覆盖它（天青给的 5 和这里一样）。
 */
const VIBE_BASE: Record<VibeSlot, number | number[]> = {
  step: 8,
  trail: 15,
  settle: [10, 25, 10, 25, 18],
  seal: 40,
  tap: 5,
};

/**
 * 按槽位震一下。
 *
 * 为什么不直接 `vibe(15)`：五档的数字是**材质**决定的 —— 瓷叩要脆、
 * 玉磬要长、石章要沉。写死在调用点上，换主题就只能听到同一套节奏，
 * 那等于所有主题共用一套手感。
 */
function vibeAt(slot: VibeSlot): void {
  vibe(currentTheme()?.haptics?.[slot] ?? VIBE_BASE[slot]);
}

let profileButtons: Button[] = [];

/** 当前挑战上下文（若来自好友分享）。 */
let challenge: ReturnType<typeof parseChallenge> = null;
/** 挑战结算结果。cover 模式的对比维度是「重来次数」。 */
let challengeResult: { win: boolean; myUndos: number; bestUndos: number; fromName: string; isNewBest: boolean } | null = null;

/**
 * 冷启动流程（登录 / 配置 / 关卡表）是否已经走完。
 *
 * 小游戏冷启动时 `onShow` **也会触发一次**，那时关卡表还没加载，
 * 贸然按它带的 query 进关卡会直接抛（`levels` 是空的）。
 * 冷启动的参数由 `boot()` 里的 `parseChallenge()` 读，这里只用它挡掉那次重复。
 */
let booted = false;

/**
 * 上一次热启动已经处理过的挑战指纹。
 *
 * 从后台切回来（看广告、回微信消息）也会触发 `onShow`，但 `query` 为空；
 * 有些机型会把上次的 query 再带一遍 —— 用指纹去重，避免「切个后台回来
 * 又被弹进好友那一关」。指纹相同 = 同一条链接，不重复进入。
 */
let hotLaunchKey = '';

/**
 * 画布坐标 → 设计坐标。
 *
 * `clientX/clientY` 是**页面 CSS 像素**（`e.clientX`）。
 * 先换算到「画布自己的 CSS 尺寸内」（去掉画布在页面中的偏移、考虑画布被缩放的情况），
 * 再用视口反解。
 *
 * ## 为什么不用 canvas.width 去缩放
 *
 * `canvas.width` 是**设备像素**（= CSS 尺寸 × dpr）。拿它去除会得到设备像素，
 * 还得再除 dpr 绕回 CSS 像素 —— 绕一圈容易出错（历史上就是这么错的）。
 * 直接用 `rect.width`（CSS 像素）只做一次换算就够了。
 */
function toDesign(clientX: number, clientY: number): { x: number; y: number } {
  // 小游戏端（微信 / 抖音）的 clientX 已经是 CSS 像素，
  // 且画布铺满屏幕，无需再按 rect 换算。
  //
  // 抖音同样适用：`tt.getSystemInfoSync()` 给的 windowWidth/Height
  // 与实际触摸坐标同一坐标系，和微信一致。
  if (platform.name === 'wechat' || platform.name === 'douyin') {
    return viewport.toDesign(clientX, clientY);
  }
  const rect = canvas.getBoundingClientRect();
  // 画布 CSS 尺寸 → 视口内的 CSS 坐标
  const cssX = ((clientX - rect.left) / rect.width) * width;
  const cssY = ((clientY - rect.top) / rect.height) * height;
  return viewport.toDesign(cssX, cssY);
}

/**
 * 游戏内按钮位置。
 *
 * ## 尺寸为什么是 88 高（2026-11-11 移动端体检）
 *
 * 原来按 90×60 设计像素画。390 宽的屏上缩放 0.52，实际只有 46.8×31.2 CSS px，
 * 比 44pt 的触控下限还矮一截 —— 拇指要瞄准第二次才点中。
 * 88 设计高在 375 屏上是 44 CSS px、在 390 屏上是 45.8，正好压在可用线上。
 *
 * ## 为什么「提示」去盘面下方、「跳过」留顶部
 *
 * 顶部原来挤着「返回 / 提示 / 跳过」三颗按钮，间隙只剩 12 设计像素（6 CSS）。
 * 其中「跳过」是**看广告换通关**的动作，点错的代价比「提示」大得多，却和它肩并肩。
 *
 * 现在的分工按「手会放哪」定：
 * - **提示**是卡住时的高频动作，落在盘面下方 —— 拇指的自然停放区，够得着也不挡盘；
 * - **跳过**是低频且不可逆的动作，留在右上角，和「返回」隔着一整个关号胶囊。
 */
const hintBtn: Button = { x: 44, y: 876, w: 662, h: 104, label: '提 示', kind: 'primary', id: 'hint' };
const skipBtn: Button = { x: 44, y: 1196, w: 321, h: 88, label: '跳 过', kind: 'secondary', id: 'skip' };
const backHomeBtn: Button = { x: 385, y: 1196, w: 321, h: 88, label: '返 回', kind: 'secondary', id: 'backHome' };

/**
 * 盘面机制图例（设计稿 03 屏那一行六枚）。
 *
 * 色块用的是**格面本身的面色**（门/单向=石板青、星=鎏金、钥=铜、传送=暮紫、冰=霜青），
 * 这样图例和盘上那格是同一个东西，而不是另画一套小图标。
 */
const LEGEND_META: Array<{ type: number; kind: 'arrow' | 'star' | 'key' | 'gate' | 'portal' | 'ice' | 'rock'; label: string; bg: string; ink: string }> = [
  { type: 2, kind: 'rock', label: '墨石', bg: '#16211C', ink: 'rgba(158,186,168,0.92)' },
  { type: 3, kind: 'arrow', label: '单向门', bg: '#26333B', ink: '#F2DCA8' },
  { type: 4, kind: 'star', label: '星屑 序', bg: '#B89045', ink: '#2A2114' },
  { type: 5, kind: 'key', label: '钥匙', bg: '#A07E3C', ink: '#2A2114' },
  { type: 6, kind: 'gate', label: '门', bg: '#26333B', ink: 'rgba(240,235,220,0.8)' },
  { type: 7, kind: 'portal', label: '传送门', bg: '#5C5192', ink: 'rgba(240,235,255,0.85)' },
  { type: 8, kind: 'ice', label: '冰面', bg: '#7FA8A0', ink: 'rgba(20,50,45,0.75)' },
];

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

/**
 * 当前生效的总关数。
 *
 * cover 模式是现行玩法，优先用 cover 表的关数；
 * 服务端没给（老服务端）就退回经典表，最后退回内置表。
 */
function totalLevelCount(): number {
  return config?.coverLevelCount ?? config?.levelCount ?? levels.total;
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
      mapPage = createMapState(progress.currentLevel, totalLevelCount(), progress.current.stars, DEBUG_ENABLED);
      // 首次进入地图聚焦当前关
      mapPage.scrollY = Math.min(mapPage.maxScrollY, scrollToLevel(progress.currentLevel));
      mapDragStart = null;
      phase = 'map';
      break;
    }
    case 'skins':
      phase = 'skins';
      syncSkinsPage();
      // 每次进来都从货架顶部开始：停在上一轮的滚动位置会让人以为少了主题
      skinsPage.themeScroll = 0;
      skinsPage.themeFling = 0;
      shelfDragStart = null;
      ads.showBanner();
      reportEvent('theme_page_view', {
        owned: unlockedThemeCount(skinsPage),
        total: shelfCount(),
      });
      break;
    case 'rank':
      phase = 'rank';
      await loadGlobalRank();
      break;
    case 'profile':
      phase = 'profile';
      // 从别的 tab 回来时不该继承上一次的弹层状态
      statsPanelOpen = false;
      sharePanelOpen = false;
      profilePage = {
        ...profilePage,
        nickname: progress.current.nickname || '玩家',
        avatar: progress.current.avatar || '',
        maxLevel: progress.current.maxLevel,
        totalSteps: progress.current.totalSteps,
        totalTimeMs: progress.current.totalTimeMs,
        adWatchCnt: progress.current.adWatchCnt,
        starCount: totalStars(),
        totalRetries: progress.current.totalRetries ?? 0,
        threeStarCount: Object.values(progress.current.stars ?? {}).filter((s) => s === 3).length,
        currentLevel: progress.currentLevel,
        uid: progress.current.uid,
        // 只在**真有头像**时算填过：服务端对没填过的用户下发空串，
        // 本地又会把空昵称兜成「玩家」，两个都判断不了"填没填过"。
        profileFilled: !!progress.current.avatar,
      };
      reportEvent('profile_view', { max_level: progress.current.maxLevel });
      break;
  }
}

/**
 * 排行榜每页条数。
 *
 * 与服务端 `leaderboard.DefaultPageSize` 对齐：客户端只是"想要的窗口大小"，
 * 服务端仍会兜住上限（100）。两边不一致时以服务端回的 `limit` 为准 ——
 * 这里只负责分页按钮的步进，不承担正确性。
 */
const RANK_PAGE_SIZE = 50;

/** 拉取总榜（offset = 窗口起点）。 */
async function loadGlobalRank(offset = 0): Promise<void> {
  rankPage.global.loading = true;
  try {
    const res = await fetchLeaderboard(offset, RANK_PAGE_SIZE);
    rankPage.global = {
      list: res.list,
      myRank: res.myRank,
      total: res.total,
      loading: false,
      offset: res.offset ?? offset,
      pageSize: RANK_PAGE_SIZE,
    };
  } catch {
    rankPage.global.loading = false;
  }
}

session.on((e) => {
  if (e.type === 'won') {
    // 通关是一段**有先后**的演出，不是一堆同时触发的效果：
    //   ① 逐粒落定（48ms 一粒，每粒一记轻研磨）
    //   ② 末粒落定 → 全盘沙光 + 土埙
    //   ③ 石章砸下 → 抖墙 + 石顿
    // 所以音效只有第一声是立刻发的，土埙与石章都排进同一条时间线往后推。
    // 各发各的（早先就是这样）会变成"埙在第一粒就吹、章在第一粒就盖"。
    const cas = cascadeMs();
    winCascadeMs = cas;
    // 末粒之后多久起"结束音"：鸣沙土埙 168（要等沙雨尾音散）、天青玉磬 120
    winSealAt = cas > 0 ? cas + (currentTheme()?.motion?.winGap ?? WIN_XUN_GAP) : 0;
    // perfect = 一次没撤销。通关那一记要多一声高八度的闪光，
    // 这是「打得干净」唯一的即时听觉奖励（星级要等结算页才看到）
    audio.win((session.state?.undos ?? 0) === 0, winSealAt);
    if (cas > 0) {
      audio.settle(e.path.length, WAVE_STEP_MS);
      // 铺满 · 沙落：四下短震夹三段停（设计稿同一组数）
      vibeAt('settle');
      // 盖印那一下的重震必须和石章落到墙上同帧，所以单独排一个定时器
      setTimeout(() => vibeAt('seal'), winSealAt + WIN_SEAL_HIT);
    } else {
      // 没有级联的主题，印是当场落的，那就当场震
      vibeAt('seal');
    }
    if (challenge) void onChallengeWin(e.steps, e.timeMs, e.path);
    else void onWin(e.steps, e.timeMs, e.path);
  }
  if (e.type === 'break') { audio.break(); vibeAt('trail'); }
  if (e.type === 'blocked') {
    // 点石头 / 没钥匙开门 / 逆着单向门走：**必须给一下**。
    // 早先这里什么都不做，玩家点上去一片死寂，只会以为"点了没反应"——
    // 而这一格其实明确地拒绝了他。
    shakeCell = e.idx;
    shakeAt = Date.now();
    audio.blocked();
    vibeAt('trail');
  }
  if (e.type === 'moved') {
    audio.light();
    pressCell = e.idx;
    pressAt = Date.now();
    // 落子：这一下是**手底下有东西**，不是"振动提示"
    vibeAt('step');
    // 这一格刚刚"铺上颜料"：落子动效 + 沥金从上一格堆过来
    dropAt.set(e.idx, pressAt);
    trailAt = pressAt;
    reportEvent('tile_light', { level_idx: session.state?.runtime.level.idx });
  }
  // ── 松手 ──
  //
  // **松手不再作废，也不再倒计时**：路径、钥匙、星星全部保持原状，
  // 玩家随时按回线头接着拖。所以这里不弹任何提示 ——
  // 早先那句「1.5 秒内按回线上可继续拖」是在解释一个倒计时，
  // 倒计时没了，提示也就没有存在意义（反而让人以为有时间压力）。
  if (e.type === 'paused') {
    // 故意不做事：松手是玩家的常态动作，不该有声音、文字或震动回应。
    // 留着这个分支是为了显式表明"这里有意安静"，不是漏了。
  }
  if (e.type === 'resumed') {
    // 续接不该有任何惩罚，连音效都省 —— 玩家只是以为自己断线了
    audio.light();
  }
  if (e.type === 'abandoned') {
    // 作废只剩一个入口：玩家按了**别的格子**（显式要重新起一笔）。
    //
    // **不弹提示**（2026-11-19 去掉）。这里原先会 toast「重新起一笔 ·
    // 这一笔已计入重来」，但它弹的时机是玩家正在专注拖线的中途 ——
    // 一块横在屏幕上的文字，说的还是他自己刚刚做的事。
    // 「重来次数 +1」在 HUD 上本来就有数，不需要再喊一遍。
    // 无步数的情况（切后台等）同样不打扰。
    reportEvent('level_abandon', {
      level_idx: session.state?.runtime.level.idx,
      steps: e.steps,
      undos: session.state?.undos ?? 0,
    });
  }
});

/** 通关处理：上报成绩。 */
async function onWin(steps: number, timeMs: number, path: number[], skipped = false) {
  const level = session.state!.runtime.level;
  const undos = session.state?.undos ?? 0;
  // 通关波次动画（级联 48ms 一粒 + 盖印），结算页延后出现
  winAnimStart = Date.now();
  fx.clear();
  reportEvent('level_pass', { level_idx: level.idx, steps, time_ms: timeMs, undos, skipped });

  let unlockedSkin: { id: string; name: string } | null = null;
  // 服务端明确拒绝（路径非法）时为 true：照常出结算页，但不推进进度。
  let rejectedByServer = false;
  try {
    if (skipped) {
      // **跳过走独立接口** —— cover 的跳过没有路径可校验，
      // 走 `/api/cover/progress` 会因为「路径长度 0 != 可走格数」被拒。
      const res = await reportCoverSkip(level.idx);
      progress.sync({
        maxLevel: res.maxLevel,
        totalTimeMs: progress.current.totalTimeMs,
        totalSteps: progress.current.totalSteps,
      });
      // 跳过的关卡**不给星**（花钱买过去的 ≠ 打过去的）
      progress.clearStar(level.idx);
    } else {
      // **cover 模式走独立接口** —— 服务端按 cover 的完整规则回放校验
      // （冰块滑行 / 单向门 / 钥匙门 / 传送门 / 星星顺序），
      // 且星级由 `undos` 决定而不是步数（步数恒为 required−1）。
      const res = await reportCoverProgress(level.idx, steps, timeMs, undos, path);
      unlockedSkin = res.unlockedSkin;
      if (res.unlockedSkin) {
        progress.unlockSkin(res.unlockedSkin.id);
        audio.unlock();
        // 解锁是"东西到手了"，比按钮重一档（设计稿五档里的连径档）
        vibeAt('trail');
      }
      progress.sync({
        maxLevel: res.maxLevel,
        unlockedSkins: res.unlockedSkins,
        totalTimeMs: res.totalTimeMs,
        totalSteps: res.totalSteps,
      });
      // 本地即时更新该关星级，地图页无需等下次拉取
      progress.setStar(level.idx, res.stars);
    }
  } catch (e) {
    console.error('上报成绩失败', e);

    // ── 服务端**明确拒绝** ≠ 网络故障 ──
    //
    // `reportCoverProgress` 会按完整规则回放路径。若服务端判「路径非法」，
    // 那是**玩家的路径真的不合法**（或客户端规则与服务端漂移），
    // 绝不能当成"网络抖动"乐观放行 —— 否则校验形同虚设：
    // 改内存画一条假路径，本地照样记成已通关。
    //
    // 但也**不能直接 return 掉结算页**：玩家在屏幕上确实铺满了，
    // 直接吞掉通关会让他以为游戏卡了。所以照常出结算页，
    // 只是不推进 maxLevel、不给星 —— 重进这一关还能再打。
    if (e instanceof ApiError && e.isRejection) {
      showToast('这一笔没能记上，请重试');
      reportEvent('progress_report_rejected', {
        level_idx: level.idx,
        skipped,
        reason: e.message,
      });
      // 跳过下面的乐观更新，但仍要走到结算页
      // （用局部变量标记，避免用 return 把动画/结算一起掐掉）
      rejectedByServer = true;
    } else {
      // ── 网络故障：乐观更新本地进度 ──
      //
      // ## 为什么失败也要推进本地进度
      //
      // 服务端没记上这一关 → `maxLevel` 不变 → 地图页把下一关画成「锁着」。
      // 但玩家**已经打完了**这一关，而且 `pendingLevel` 已经推进到下一关 ——
      // 于是玩家能进下一关（走 `pendingLevel`），却看到地图说没解锁。
      //
      // 两边不一致比「服务端数据晚点同步」糟糕得多：
      // 玩家会以为进度丢了，反复重玩同一关。
      //
      // 本地先记上，下次登录时服务端会用 `GREATEST(max_level, ...)` 兜回来；
      // 如果这次上报其实只是网络抖动、请求已经到达服务端，那本地值和服务端一致。
      progress.sync({
        maxLevel: Math.max(progress.current.maxLevel, level.idx),
      });
      // 星级也乐观写上（服务端没收到的话下次拉取会覆盖回来）
      if (!skipped) {
        progress.setStar(level.idx, starOfCoverLocal(undos));
      }
      showToast('成绩同步失败，进度已本地保存');
      reportEvent('progress_report_failed', { level_idx: level.idx, skipped });
    }
  }

  resultData = {
    levelIdx: level.idx,
    steps,
    shortest: level.required - 1,
    timeMs,
    unlockedSkin,
    undos,
    skipped,
    // 服务端拒了这一笔：结算页据此提示「没记上」，且不显示「下一关」。
    // 不能假装通关了 —— 玩家重进这一关还能再打，进度也不会被写脏。
    rejected: rejectedByServer,
  };
  // **下一关 = 当前关 + 1**。
  //
  // 最后一关（1000）通关后这里是 1001 —— 超出关卡表范围。
  // 结算页据此判断「是不是全部通关了」，决定要不要显示「下一关」按钮
  // （见 `drawResult` 的 `isAllCleared`）。`enterLevel` 也有越界拦截兜底。
  //
  // 服务端拒绝时**不推进**：那一笔不算数，玩家应该回到本关重打。
  if (!rejectedByServer) pendingLevel = level.idx + 1;

  // 发布进度到开放数据域（好友榜才准）
  publishMyProfile();

  // 结算页延后出现，让通关波次 + 落印播完；入场后再延迟 500ms 弹插屏
  //
  // 1.75 秒是**旧管线**的固定值：那时印在第一帧就落，级联只是背景。
  // 现在印要等末粒（`winSealAt`），一盘 30 格就是 1.56 秒之后才砸下来 ——
  // 固定 1750 会把印切在"刚落到一半"。所以按实际编排算，再留一段静置：
  // 印落定 320ms + 留在盘上停 700ms（这一个"过"就是整局唯一的结束语）。
  const sealMs = currentTheme()?.motion?.seal?.ms ?? 320;
  const tail = winSealAt + sealMs + 700;
  setTimeout(() => {
    phase = 'result';
    setTimeout(() => { void ads.showInterstitial('result_interstitial'); }, 500);
  }, Math.max(1750, tail));
}

/**
 * 挑战模式通关：不推进主线，走 /api/cover/challenge。
 *
 * cover 模式的挑战比较维度是**悔棋次数**（不是步数）——
 * 步数恒为 required−1，比步数没有意义。
 *
 * ## 跟谁比
 *
 * 优先跟**分享链接里的那位好友**比（`challenge.fromUndos`）——
 * 这才是「挑战」的语义：好友重来 3 次，我重来 2 次就是赢了。
 *
 * 链接里没带分数（老版本分享的链接只有 `l=N`）时，
 * 退回跟**自己的历史最佳**比 —— 服务端返回的 `best` 就是这个。
 *
 * ## 为什么不能只看服务端返回的 best
 *
 * 服务端的 best 是「自己这关的历史最佳」，不是好友的分数。
 * 只用它的话，好友来 2 次、我来 5 次也会判「惜败」——
 * 但实际上我比好友差，而好友根本没出现在比较里。
 */
async function onChallengeWin(steps: number, timeMs: number, path: number[]) {
  const level = session.state!.runtime.level;
  const undos = session.state?.undos ?? 0;
  let isNewBest = false;
  let myBest = { undos: 0, timeMs: 0 };
  let verdict: CoverChallengeOutcome | null = null;
  try {
    // 把 token 一起上送 —— 服务端按它取对手成绩并判定胜负。
    // 我们**不上送任何对手分数**，请求体里也没有那个字段。
    const res = await reportCoverChallenge(level.idx, steps, timeMs, undos, path, challenge?.token ?? undefined);
    isNewBest = res.isNewBest;
    myBest = res.best;
    verdict = res.challenge ?? null;
  } catch (e) {
    console.error('提交挑战成绩失败', e);
  }

  /**
   * 胜负：**优先用服务端判的**。
   *
   * ## 为什么不再自己比 `undos`
   *
   * 旧实现在这里比 `undos <= challenge.fromUndos`，而 `fromUndos` 来自
   * 分享链接的 query —— 好友把 `?undos=0` 一改就「挑战成功」。
   * 那不是一个成绩，只是一句可以随便写的话。
   *
   * 现在服务端按 token 从库里取真正的对手成绩来判（见 resolveChallenge）。
   * 只有服务端不可用（断网 / 老服务端没有这个字段）时才退回本地比较，
   * 而且此时**只跟自己的历史最佳比**，不用链接里那个可篡改的数字。
   */
  let rivalUndos: number;
  let win: boolean;
  if (verdict) {
    rivalUndos = verdict.rivalUndos;
    win = verdict.win;
  } else {
    // 退化路径：服务端没给判定（无 token / 老服务端）。
    // 只跟自己的历史最佳比 —— 链接里的 undos 不可信，不拿它当对手。
    rivalUndos = myBest.undos;
    win = undos <= rivalUndos;
  }

  reportEvent('challenge_result', {
    from_uid: challenge?.fromUid,
    level_idx: level.idx,
    win,
    is_new_best: isNewBest,
    // 判定来源：服务端 / 本地退化。用来核对「有多少挑战真的走了服务端判定」
    verdict_by: verdict ? 'server' : 'local',
  });

  winAnimStart = Date.now();
  fx.clear();
  setTimeout(() => {
    phase = 'result';
    challengeResult = {
      win,
      myUndos: undos,
      bestUndos: rivalUndos,
      // 昵称用服务端快照（分享那一刻的署名），没有就用链接里的
      fromName: verdict?.fromName || challenge?.fromName || '好友',
      isNewBest,
    };
    // 挑战不落印，所以只要等波次跑完（没有级联的主题仍是 1.2 秒）
  }, Math.max(1200, winCascadeMs + 320));
}

/**
 * 调试模式：跳到任意一关。
 *
 * ## 它**不改进度**（2026-11-21 改）
 *
 * 旧实现先让服务端把 `max_level` 推到目标关的前一关，好让目标关变成
 * 「当前关」、地图显示对得上。代价是**玩家的真实进度被永久顶高**：
 * 点开第 405 关看一眼，`max_level` 就从真实的 153 变成 404，
 * 地图随即把 1..404 画成已通关 —— 而分享选关按星级判定又说 405 没过。
 *
 * 现在跳关只做一次「服务端调试开关是否开着」的探针（403 = 关着），
 * 进关本身完全靠客户端（`enterLevel` 直接拉关卡数据）。
 * 真正的进度只由通关上报 / 看广告跳过推进，跳关一个字节都不写。
 *
 * ## 服务端调不通怎么办
 *
 * 打印一句说明就行，**照常进关** —— 调试入口不依赖服务端。
 * 两种失败分开报：403 = 我们自己把开关关了；其他 = 后端没起 / DB 没开。
 * 原来一律提示「服务端调试未开启」，DB 挂了的时候会把人往配置上带，白查半天。
 */
async function debugJumpToLevel(idx: number): Promise<void> {
  try {
    await debugJump(idx);
  } catch (e) {
    console.warn('[debug] 跳关探针失败，照常进入关卡', e);
    const msg = String((e as Error)?.message ?? e);
    showToast(msg.includes('403') ? '服务端调试未开启，照常进入' : '服务端没响应，照常进入');
  }
}

/**
 * 调试模式：把 `max_level` 重算回「真打过的最高关」。
 *
 * 被旧版跳关顶坏过进度的账号（地图上的「当前关」远超过真实进度、
 * 中间那些关显示已通关却一颗星都没有）用这个修。
 * 修完把地图页的状态跟着刷新，否则画面还停在旧的当前关。
 */
async function repairProgressFromDebug(): Promise<void> {
  try {
    const res = await debugRepairProgress();
    progress.sync({ maxLevel: res.maxLevel });
    mapPage.currentLevel = progress.currentLevel;
    mapPage.stars = progress.current.stars;
    mapPage.scrollTarget = scrollToLevel(mapPage.currentLevel);
    const msg = `进度已修正：当前第 ${progress.currentLevel} 关`;
    debugPanel.note = msg;
    debugPanel.noteAt = Date.now();
    showToast(msg, 2200);
    console.log('[debug] 进度已按成绩表重算，max_level =', res.maxLevel);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const text = msg.includes('403') ? '服务端调试未开启，没法修' : '修进度失败：服务端没响应';
    debugPanel.note = text;
    debugPanel.noteAt = Date.now();
    showToast(text);
  }
}

/**
 * 调试模式：跳到任意一关（探一下服务端开关，再进关卡）。
 *
 * 失败也要进关卡 —— 调试入口不依赖服务端是否开了调试。
 */
async function jumpAndEnter(idx: number): Promise<void> {
  await debugJumpToLevel(idx);
  void enterLevel(idx);
}

/**
 * 调试面板的一个按键被按下。
 *
 * 这里只做两件「需要外部状态」的事：开 / 关面板、真的进关卡。
 * 输入本身的状态流转全在 `applyDebugJumpInput`（纯函数，可测）——
 * 触摸点按键和键盘敲数字都走它，两条路径的行为才不会分叉。
 */
function applyDebugJumpKey(id: string): void {
  if (id === 'dj:close') { debugPanel.open = false; return; }
  if (id === 'dj:repair') { void repairProgressFromDebug(); return; }
  if (id === 'dj:open') {
    debugPanel.open = true;
    debugPanel.openedAt = Date.now();
    // 默认填当前关：绝大多数调试就是从「我卡在哪一关」出发的。
    // 标成 fresh —— 第一下数字要整段替换，否则想输 71 会变成 171。
    if (!debugPanel.input) {
      debugPanel.input = String(progress.currentLevel);
      debugPanel.fresh = true;
    }
    return;
  }

  const enter = applyDebugJumpInput(debugPanel, id, totalLevelCount(), progress.currentLevel);
  if (enter) void enterFromDebug();
}

/** 从调试面板进入某一关。 */
async function enterFromDebug(): Promise<void> {
  const total = totalLevelCount();
  const idx = Number(debugPanel.input);
  if (!(idx >= 1 && idx <= total)) return;

  debugPanel.open = false;
  debugPanel.input = '';
  // 跳关等于「我不在别人的挑战里了」。不清掉的话，排行榜那套
  // 「和好友比谁重来少」会挂在一张不相干的棋盘上。
  challenge = null;
  challengeResult = null;
  // **不埋点**：调试跳关是测试行为，混进线上的漏斗分析比少一条事件糟得多
  console.log('[debug] 直达第', idx, '关');
  await jumpAndEnter(idx);
}

/**
 * 调试面板的键盘操作（**仅浏览器端**）。
 *
 * 微信小游戏没有键盘，那边的入口是地图页右上角的牌子 ——
 * 这条路径不能省，因为手机才是这个游戏的主场，测试也多半在手机上。
 *
 * 键位：`` ` ``（或 F2）开 / 关，数字填号，Backspace 退格，Enter 直达，Esc 关闭。
 * 选 `` ` `` 是因为它在浏览器里不触发任何默认行为，也不会被输入法抢走。
 */
function bindDebugKeys(): void {
  window.addEventListener('keydown', (e) => {
    // 别抢浏览器自己的快捷键（Cmd+R 刷新、Ctrl+数字 切标签页）
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.code === 'Backquote' || e.key === '`' || e.key === 'F2') {
      e.preventDefault();
      applyDebugJumpKey(debugPanel.open ? 'dj:close' : 'dj:open');
      return;
    }

    if (!debugPanel.open) return;

    if (e.key === 'Escape') { e.preventDefault(); applyDebugJumpKey('dj:close'); return; }
    if (e.key === 'Enter') { e.preventDefault(); applyDebugJumpKey('dj:enter'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); applyDebugJumpKey('dj:back'); return; }
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); applyDebugJumpKey(`dj:d:${e.key}`); }
  });
}

/**
 * 进入关卡。
 *
 * ## 失败必须有用户可见反馈
 *
 * 以前这里只 `console.error` 然后 return —— 界面零变化。
 * 玩家点「下一关」看到的就是「点了没反应」，
 * 而且 `phase` 还停在 `'result'`，反复点反复没反应。
 *
 * 现在：
 * - 弹出提示条说明发生了什么；
 * - 兜底回大厅（不留在结算页空转）；
 * - 埋一条 `level_load_fail` 便于排查。
 */
async function enterLevel(idx: number) {
  // 关号越界（通关最后一关后点「下一关」会到这里）
  if (idx < 1 || idx > totalLevelCount()) {
    console.error('关号越界', idx);
    showToast('已经是最后一关啦');
    phase = 'home';
    return;
  }

  let entry;
  try {
    entry = await levels.ensure(idx);
  } catch (e) {
    console.error('关卡加载失败', idx, e);
    showToast('关卡加载失败，请重试');
    reportEvent('level_load_fail', { level_idx: idx, reason: 'throw' });
    if (phase === 'result') phase = 'home';
    return;
  }

  if (!entry) {
    console.error('关卡加载失败', idx);
    showToast('关卡加载失败，请重试');
    reportEvent('level_load_fail', { level_idx: idx, reason: 'missing' });
    // 别把玩家留在结算页反复点「下一关」
    if (phase === 'result') phase = 'home';
    return;
  }

  const level = decodeCoverLevel(entry);
  session.load(buildCoverRuntime(level));
  phase = 'playing';
  winAnimStart = 0;
  winCascadeMs = 0;
  winSealAt = 0;
  waveLit = new Set();
  pressCell = -1;
  pressAt = 0;
  dropAt = new Map();
  trailAt = 0;
  waveAt = new Map();
  shakeCell = -1;
  shakeAt = 0;
  fx.clear();
  // 进场从这一帧起算。和转场**同向**：幕从右边退、格子从上往下一格一格就位，
  // 等幕退干净时盘面已经铺到第三行，观感是"幕被抹开，格子跟着落定"
  enterAt = Date.now();
  armEnterCue();
  reportEvent('level_start', { level_idx: idx, diff: level.diff, w: level.w, h: level.h });
}

/**
 * 进场揭幕的音画收尾。
 *
 * ## 为什么要在开局就排一段定时器
 *
 * 设计稿的揭幕是"逐格落定 → **末格**落定那一下全盘脉冲 + 玉磬"。末格那一刻
 * 是由主题参数算出来的（`enterTempo` 的 `total`），只有 `main` 知道 `enterAt`，
 * 所以在这里排一次。
 *
 * ## 排期必须和画面**同一个模型**
 *
 * 逐格音、玉磬的时刻全部来自 kit 的 `enterTempo` / `enterSettleDelays` ——
 * 和 `enterProgress`（格子什么时候落）同源。早先这里另抄了一套锯齿扫掠公式
 * （`(w−1)·step + (h−1)·(w·step+row)`，连压缩比都没扣落定段），
 * 和画面的行序模型对不上：8×8 的天青盘上它算出 2.4s，而格子 1.58s 就落完了，
 * 于是"沙雨还在下、玉磬还没响"，画面里盘却已经静态 —— 音画就是这么散的。
 * 这个坑 kit 的 `enterTempo` 注释里已经修过一次，这里当时没跟着改。
 * **要新的排期先去 `enterTempo` 取数，别再抄公式。**
 *
 * ## 两个必须守住的细节
 *
 * 1. **逐格音**排成一条时间线（`audio.settleAt`），不是每格一个 `setTimeout`：
 *    40 个定时器在低端机上各偏 10~30ms，听起来就是一串毛毛雨。
 * 2. **主题没给 `enter` 或没给 `settle` 音色 → 一声不发**，连玉磬也不放。
 *    玻璃 / 黏土那几套没有"逐格落下"这件事，硬加音效就是贴音效。
 */
function armEnterCue(): void {
  // 重入（跳过后重播 / 快速换关）要把上一段没响的收尾掐掉，不然会双响
  if (enterCueTimer !== undefined) {
    clearTimeout(enterCueTimer);
    enterCueTimer = undefined;
  }
  const th = currentTheme();
  const en = th?.motion?.enter;
  if (!en || !en.pulse) return;
  const st = session.state;
  if (!st) return;

  const level = st.runtime.level;
  const { total } = enterTempo(en, level.w, level.h);

  // 逐格音跟着每格**落定**走（不是等距一串）—— 行距 `row`、扫掠压缩 `k`
  // 都得在拍子里听得见，否则声音听起来"平"，画面却在分行落。
  // VOID 不落（kit 的画格循环直接跳过它），也就没有"落定"这一声。
  audio.settleAt(
    enterSettleDelays(en, level.w, level.h, (x, y) => cellType(level.grid[y * level.w + x]) === CoverCell.VOID),
  );

  // 末格落定那一下：全盘脉冲（kit 按 `enterAt + total` 画）+ 玉磬 + 轻震
  enterCueTimer = setTimeout(() => {
    enterCueTimer = undefined;
    if (phase !== 'playing') return;
    audio.chime();
    vibeAt('tap');
  }, Math.max(0, total));
}

/**
 * 跳过开场的音画收尾：**不回放过程**，收尾立刻来。
 *
 * 设计稿「动画中再点 = 跳过：所有格直接落定、沙光照播，不回放过程」——
 * 沙光由 kit 按 `enterAt + total` 照常播（跳过时它正好落在当下），
 * 这里只负责把还没响的逐格音停掉、玉磬立刻敲。
 * 早先是重调一次 `armEnterCue`：整段沙雨从头再排一遍，
 * 跳过之后画面静态、耳朵里却还在下雨，比不跳还糟。
 */
function skipEnterCue(): void {
  if (enterCueTimer !== undefined) {
    clearTimeout(enterCueTimer);
    enterCueTimer = undefined;
  }
  audio.settleStop();
  // 「主题没给收尾语言就一声不发」与 `armEnterCue` 同一口径
  const en = currentTheme()?.motion?.enter;
  if (!en || !en.pulse) return;
  audio.chime();
  vibeAt('tap');
}

/**
 * 使用提示。
 *
 * cover 模式的提示 = **在剩余盘面上实时求一条路径**（`coverHint.ts`），
 * 一次算出**整条剩下怎么走**，交给会话装成「路线计划」。
 *
 * 不是「查参考解」—— 玩家走岔之后参考解就接不回去了，
 * 硬接会让线突然倒退，体验极差。所以实时求解，实测只要几毫秒。
 *
 * 盘面上同时只亮 5 格（`HINT_WINDOW`），玩家顺着最亮的那头走，
 * 窗口会自己往前滑 —— 不需要走两步就回来点一次提示。
 */
async function useHint() {
  const st = session.state;
  if (!st) return;

  // `paused` = 松手后停住（没有倒计时），路径和线头都还在。
  // 这时点提示和拖动中点一样合理 —— 旧实现只认 idle/dragging，
  // 玩家刚抬手就问提示，点下去毫无反应。
  if (st.phase !== 'idle' && st.phase !== 'dragging' && st.phase !== 'paused') return;

  // 首次使用需看广告
  let viaAd = false;
  if (needsAdForHint(st.runtime.level.idx, st.hintUsed)) {
    // 今日激励视频额度用完（运营配的上限）：直接说清楚。
    // 让玩家盯着「提示准备中…」等十来秒再失败，比直接拒绝更让人困惑。
    if (ads.rewardedQuotaLeft() <= 0) {
      showToast('今天的激励视频次数用完了，明天再来');
      return;
    }
    // 激励视频在微信端有自己的界面，但 web / 调试环境的模拟广告只是干等三秒。
    // 不说一句，这三秒就是纯「点了没反应」。
    showToast('提示准备中…', 3200);
    const ok = await ads.showRewarded('hint');
    if (!ok) {
      // 中途退出 / 额度刚好被别人占掉：说一声，别让玩家以为提示坏了
      showToast('广告没看完，这次不给提示');
      return;
    }
    // 等广告的这几秒里玩家可能已经换了关 / 结算：不能往旧状态上贴提示
    if (session.state !== st) return;
    viaAd = true;
  }

  // ── 提示 = **从空盘重来**，而不是接在当前线头后面 ──
  //
  // 旧实现把玩家已走的格子当障碍，在线头后面求「剩余路线」。
  // 一旦玩家走岔，这条剩余路线只能围着错路打转，提示越长越误导。
  // 现在的语义是「点提示 = 清空这一笔，从头告诉你整关怎么走」。
  //
  // 清空**不计重来**（`restartForHint` 不碰 `undos`）：这不是玩家走错，
  // 是提示功能的一部分；首次提示还要看广告，再扣星就太贵了。
  //
  // 放在广告之后：中途退出广告的玩家不该既没看到提示、又丢了已有的线。
  session.restartForHint();
  if (session.state !== st) return;
  // 清掉落子 / 沥金动效的时刻表 —— 旧的路径已经没了，
  // 残留的动画还会在空格子上闪一下，看起来像没清干净。
  dropAt = new Map();
  trailAt = 0;
  pressCell = -1;
  shakeCell = -1;

  // ── 提示：**优先问服务端**（它拿参考解切片，O(1)，永远给得出）──
  //
  // 旧实现完全在浏览器里跑哈密顿求解器（`coverHint.ts`，120ms 预算）。
  // 冰块关 / 传送门关上剪枝失效会超时，表现为「这一关暂时给不出提示」。
  //
  // 服务端有参考解时直接切后缀，比前端解快且稳。
  // 网络不通 / 服务端没这关的数据时**退回前端求解** —— 不能因为断网就不给提示。
  const levelIdx = st.runtime.level.idx;
  // 路径刚被清空：请求空盘提示，服务端会返回整条参考解。
  const walked: number[] = [];
  let served = false;
  try {
    const r = await fetchCoverHint(levelIdx, walked);
    // 等网络这段时间里玩家可能已经换关 / 结算
    if (session.state !== st) return;
    // **也可能已经重新起笔**。此时提示是按空盘算的，
    // 贴到一条已经画了几格的线上会整体指错 —— 宁可这次不给，也不指错路。
    if (st.path.length > 0) return;
    if (r.fromReference && r.cells.length > 0) {
      session.setHint(r.cells);
      showToast(`已从头开始 · 跟着亮的路走，共 ${r.cells.length} 格`, 1900);
      reportEvent('hint_use', { level_idx: levelIdx, via_ad: viaAd, solve_ms: 0 });
      served = true;
    }
    // `fromReference=false` = 参考解接不回来（空盘请求理论上不会出现）。
    // 交给下面兜底统一处理，免得两条路径给出不一致的提示。
  } catch {
    // 网络失败 → 下面走前端求解
  }
  if (served) return;

  // 网络请求期间玩家可能已经重新起笔。此时空盘提示不再成立，
  // 再跑本地求解也只会算「当前线头之后」—— 正是这次改动要拆掉的旧语义。
  if (st.path.length > 0) return;

  const hint = findCoverHint(st);
  if (!hint.found || hint.cells.length === 0) {
    // 空盘都求不出解：理论上只剩「关卡数据损坏」这一种。
    // 兜底仍保留 backtrackTo 分支，但正常不会走到（空盘没有可回退的线）。
    if (hint.backtrackTo !== undefined) {
      session.setHint([hint.backtrackTo]);
      showToast('这条线已经走不通了，退回到高亮格试试');
      reportEvent('hint_use', { level_idx: levelIdx, via_ad: viaAd, dead_end: 1 });
    } else {
      // 给不出也要说一声：静默失败是最糟的反馈，玩家会以为按钮坏了。
      showToast('这一关暂时给不出提示');
    }
    return;
  }

  session.setHint(hint.cells);
  // 一次给整条，玩家只需要顺着亮的那头走。
  // 报一下总格数 —— 不然「路线到底有多长」只能靠数亮点，越走越没底。
  showToast(`已从头开始 · 跟着亮的路走，共 ${hint.cells.length} 格`, 1900);
  reportEvent('hint_use', { level_idx: levelIdx, via_ad: viaAd, solve_ms: hint.ms });
}

/** 跳过关卡。 */
async function useSkip() {
  const st = session.state;
  if (!st) return;
  // 说清「为什么不能跳」—— 旧实现只 console.log，
  // 玩家点了一下什么都没发生，会以为按钮坏了。
  const blocked = skipBlockReason(st.runtime.level.idx);
  if (blocked) {
    showToast(blocked);
    return;
  }
  if (ads.rewardedQuotaLeft() <= 0) {
    showToast('今天的激励视频次数用完了，明天再来');
    return;
  }
  const ok = await ads.showRewarded('skip');
  if (!ok) return;

  markSkippedToday(st.runtime.level.idx);
  session.markSkipped();
  reportEvent('skip_use', { level_idx: st.runtime.level.idx, via_ad: true });
  void onWin(st.runtime.level.required - 1, 0, [], true);
}

/** 装备当前选中（展台上）的棋盘主题。空串 = 回到经典黏土盘面。 */
function equipSelectedTheme() {
  const id = skinsPage.themeSelected ?? '';
  if (id) {
    const t = themeById(id);
    // 未解锁时展台摆的是「拿不到的目标」，不是可装备项 —— 按钮本来就不该画出来，
    // 这里再挡一次是因为「画」和「点」是两条路径，防守要放在动作侧。
    if (!t || !isThemeOwned(skinsPage, t)) return;
  }
  if (skinsPage.themeEquipped === id) return;
  skinsPage.themeEquipped = id;
  progress.equipTheme(id);
  // 装备 = 换耳朵 + 播签名动机。
  //
  // **必须在这里换音色**，而不是等进游戏 —— 玩家在展台上按下「使用」的瞬间
  // 就该听到这套主题的声音，否则八套音色要等他真打一关才发现，
  // 那和「没有音效」没区别。`preview` 内部同时做了 `setVoice`。
  audio.preview(id);
  reportEvent('theme_equip', { theme_id: id || 'classic' });
}

/**
 * 装备一套棋子皮肤。
 *
 * 未拥有的直接忽略 —— 界面不给按钮，但"画"和"点"是两条路径，
 * 防守要放在动作侧（和 `equipSelectedTheme` 同一条规矩）。
 */
function equipSkinAt(index: number) {
  const skin = SKINS[index];
  if (!skin) return;
  if (!isSkinOwned(skinsPage, skin)) return;
  if (progress.current.currentSkin === skin.id) return;

  progress.equipSkin(skin.id);
  skinsPage.equipped = skin.id;
  skinsPage.selected = skin.id;
  audio.tap();
  vibeAt('tap');
  reportEvent('skin_equip', { skin_id: skin.id, skin_tier: skin.tier });
}

/** 激励视频额度用完的统一提示（主题 / 皮肤两条路共用）。 */
function rewardedQuotaBlocked(): boolean {
  if (ads.rewardedQuotaLeft() > 0) return false;
  showToast('今天的激励视频次数用完了，明天再来');
  return true;
}

/**
 * 看广告解锁当前展台上的主题。
 *
 * ## 顺序：广告 → 服务端 → 本地
 *
 * 服务端成功才算解锁。反过来（先本地 unlock）在断网时会变成
 * "看着解锁了、换台设备又锁上"—— 玩家会认为广告白看。
 */
async function unlockThemeByAd(): Promise<void> {
  const id = skinsPage.themeSelected ?? '';
  const t = themeById(id);
  if (!t || t.unlock.type !== 'ad' || isThemeOwned(skinsPage, t)) return;
  if (rewardedQuotaBlocked()) return;

  const ok = await ads.showRewarded('skin_unlock');
  if (!ok) return;

  try {
    await unlockReward('theme', id);
  } catch (e) {
    console.warn('[theme] 解锁上报失败', e);
    showToast('网络不通，解锁没保存，稍后再试一次', 3000);
    return;
  }

  progress.unlockTheme(id);
  syncSkinsPage();
  audio.unlock();
  audio.probe(id);
  reportEvent('theme_unlock', { theme_id: id, via_ad: true });
  showToast('已解锁，点「使用」换上');
}

/** 看广告解锁一套棋子皮肤（同一条「广告 → 服务端 → 本地」顺序）。 */
async function unlockSkinByAd(index: number): Promise<void> {
  const skin = SKINS[index];
  if (!skin || skin.unlockType !== 'ad' || isSkinOwned(skinsPage, skin)) return;
  if (rewardedQuotaBlocked()) return;

  const ok = await ads.showRewarded('skin_unlock');
  if (!ok) return;

  try {
    await unlockReward('skin', skin.id);
  } catch (e) {
    console.warn('[skin] 解锁上报失败', e);
    showToast('网络不通，解锁没保存，稍后再试一次', 3000);
    return;
  }

  progress.unlockSkin(skin.id);
  syncSkinsPage();
  audio.unlock();
  reportEvent('skin_unlock', { skin_id: skin.id, via_ad: true });
  showToast(`已解锁「${skin.name}」，点一下就能换上`);
}

/**
 * 「我的 → 昵称头像」：拉起平台授权，拿到后落库。
 *
 * ## 为什么必须由玩家点
 *
 * 微信的 `getUserProfile` 会弹授权框，**只能在用户手势里调用** ——
 * 启动时自动调会被判定为诱导授权（提审直接拒）。
 *
 * ## 失败的三条路都要说清楚
 *
 * - 平台不支持（Web）：如实说「不支持」，不要静默；
 * - 玩家拒绝授权：给一次重试的提示，不报错；
 * - 服务端写失败：本地**不**假装成功 —— 否则重装后又变回首字，玩家会以为丢了。
 */
async function editProfile(): Promise<void> {
  if (!platform.profile) {
    showToast('当前环境不支持读取头像昵称', 2400);
    return;
  }
  const info = await platform.profile.request();
  if (!info) {
    showToast('没拿到昵称头像，可以再点一次', 2400);
    return;
  }

  try {
    const saved = await updateProfile({ nickname: info.nickname, avatar: info.avatar });
    progress.sync({
      nickname: saved.nickname || progress.current.nickname,
      avatar: saved.avatar || '',
    });
    profilePage = {
      ...profilePage,
      nickname: saved.nickname || profilePage.nickname,
      avatar: saved.avatar || profilePage.avatar,
      profileFilled: true,
    };
    // 开放数据域里的好友榜也要跟着更新，否则好友看到的还是旧名字
    publishMyProfile();
    showToast('昵称头像已保存', 2000);
    audio.unlock();
  } catch (e) {
    console.warn('[profile] 保存昵称头像失败', e);
    showToast('网络不通，资料没保存', 2600);
  }
}

/** 从服务端刷新进度（切后台回前台时）。 */async function refreshProgress() {
  try {
    const res = await fetchProfile();
    progress.sync({
      maxLevel: res.maxLevel,
      unlockedSkins: res.unlockedSkins,
      // 服务端是**解锁状态的真相**：本地可能因为换机 / 清缓存少了几套。
      // 这里整体覆盖（不是取并集）—— 否则退掉一套广告主题后，
      // 本地那条"我有"会永远留着，后台改配置对玩家完全无效。
      unlockedThemes: res.unlockedThemes,
      totalTimeMs: res.totalTimeMs,
      totalSteps: res.totalSteps,
      // 统计口径也在服务端：切后台回来顺手对齐一次。
      // 老服务端缺这两个字段时 `sync` 会跳过（不会把本地数字冲成 0）。
      adWatchCnt: res.adWatchCnt,
      totalRetries: res.totalRetries,
      // 昵称头像也回：换设备登录时「我的」页要显示上次填的那份。
      nickname: res.nickname || progress.current.nickname,
      avatar: res.avatar || progress.current.avatar,
    });
    syncSkinsPage();
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

/**
 * 打开分享抽屉（设计稿 01 屏）。**三个入口共用这一个函数。**
 *
 * ## 为什么删掉了旧的 `doShare()`
 *
 * 旧实现从 `session.state` 取关卡与成绩，而 `session.state` 在大厅里
 * 躺的是**上一次玩过的关卡**，且全项目没有一处把它置空 —— 于是从大厅
 * 点分享会发出去一局陈旧的成绩。`openSharePanel` 让调用方显式传关号，
 * 这个隐患从根上没有了。分享入口只剩这一条，旧的没有存在价值。
 *
 * 所以关卡与成绩一律由**调用方显式传入**，不从 session 猜。
 *
 * ## `undos` 的两种语义
 *
 * - `null` —— **邀请**：我不宣称任何成绩，只是叫你一起来玩。
 *   query 里不带 `undos`，好友打开后按「我的历史最佳」比。
 * - `number` —— **挑战**：这是我刚打出来的成绩（通关结算走这条）。
 *   好友要重来 ≤ 我才能赢。
 *
 * 这两种不能混：邀请场景塞一个 0 进去，等于宣称「我零重来通关」，
 * 那是一句谎话，也会把好友的胜负判定搞反（见 challenge.ts 的注释）。
 *
 * @param levelIdx 分享哪一关
 * @param undos    成绩；`null` = 纯邀请
 * @param from     从哪一页开的（关掉抽屉时回这里）
 */
function openSharePanel(levelIdx: number, undos: number | null, from: Phase = 'map') {
  // 功能开关：分享挑战整体关掉时，三个入口（首页 / 我的 / 结算）一起挡在这里。
  // 分散到各入口各判一次的话，早晚会漏掉一个。
  if (!featureOn('shareChallenge')) {
    showToast('分享挑战暂未开放');
    return;
  }
  const nickname = progress.current.nickname || '我';
  // 文案游标以关号为起点：同一关每次打开都是同一条，不会「刚才看着不错，再打开变了」
  sharePanel.copyIndex = levelIdx % shareCopyCount();
  sharePanel.levelIdx = levelIdx;
  sharePanel.undos = undos ?? 0;
  sharePanel.nickname = nickname;
  sharePanel.uid = progress.current.uid;
  sharePanel.copy = shareCopy(levelIdx, undos ?? 0, sharePanel.copyIndex);
  // 显式记住「这次宣称成绩吗」—— 不能靠 undos 是否为 0 推断（见 sharePanelHasScore）
  sharePanelHasScore = undos !== null;
  sharePanel.query = buildShareQuery({
    levelIdx,
    ...(undos === null ? {} : { undos }),
    uid: progress.current.uid,
    name: nickname,
  });
  sharePanelFrom = from;
  sharePanelOpen = true;
  // 抽屉是模态的，战绩弹层必须让位（两层遮罩叠起来会黑成一片）
  statsPanelOpen = false;
  audio.tap();
  vibeAt('tap');
  reportEvent('share_click', { level_idx: levelIdx, kind: undos === null ? 'invite' : 'result' });
}

/** 分享抽屉：换一条文案。 */
function rollShareCopy() {
  sharePanel.copyIndex = (sharePanel.copyIndex + 1) % shareCopyCount();
  sharePanel.copy = shareCopy(sharePanel.levelIdx, sharePanel.undos, sharePanel.copyIndex);
  audio.tap();
  vibeAt('tap');
}

/**
 * 分享抽屉：真的把海报画出来（750×1334）。
 *
 * ## 二维码的内容从哪来
 *
 * 用 `sharePanel.query`（面板打开时已生成的那份 query）拼出完整链接。
 * **不重新生成 token** —— 海报是要存到相册 / 分享出去的，
 * 每次生成一个不同的 token 会让「图上的码」和「发的链接」对不上，
 * 好友扫了码进去看到的是**另一次挑战**。
 *
 * 真正的分享（`sendInvite`）会另外拿一份带 token 的 query，
 * 那时海报已经画好了 —— 所以二维码里的链接不带 token，
 * 好友照样能进这一关，只是胜负退回「跟自己的历史最佳比」。
 * 这是有意的取舍：**图上能扫进去**比**图上带战绩**重要。
 */
function buildInvitePoster(): PosterCanvas | null {
  const base = shareBaseUrl();
  const url = base && sharePanel.query ? `${base}?${sharePanel.query}` : '';
  return renderPoster(
    { idx: sharePanel.levelIdx, w: 6, h: 6 },
    progress.current.currentSkin,
    sharePanel.undos,
    sharePanel.nickname,
    { text: sharePanel.copy },
    sharePanel.uid,
    0,
    url,
  );
}

/**
 * 分享抽屉：确保这次分享在服务端有一条挑战记录，返回完整 query。
 *
 * ## 为什么 token 在「分享那一刻」才创建
 *
 * 面板打开时玩家可能只是看看海报、换换文案然后就取消了。
 * 一开面板就往 `challenges` 表写一行，等于把「浏览」也记成「分享」，
 * 裂变数据会虚高。
 *
 * ## 失败也必须能分享
 *
 * 拿不到 token（断网 / 老服务端）时退回**不带 token** 的旧 query ——
 * 链接照样能打开、能玩、能通关，只是胜负退回「跟自己的历史最佳比」。
 * 分享本身不该因为一个统计用的 token 而失败。
 */
async function buildShareQueryWithToken(): Promise<string> {
  const { levelIdx, undos } = sharePanel;
  // undos === 0 有两种可能：真零重来（邀请场景也是 0）。这里靠外部调用区分不了，
  // 所以用 `sharePanelHasScore` 这个显式标记 —— 见 openSharePanel。
  const hasScore = sharePanelHasScore;
  const nickname = progress.current.nickname || '我';

  let token: string | undefined;
  try {
    const res = await createShareChallenge(levelIdx, hasScore ? undos : undefined);
    token = res.token;
  } catch (e) {
    // 不挡分享：记一笔就够了
    console.error('创建分享挑战失败', e);
  }

  return buildShareQuery({
    levelIdx,
    ...(hasScore ? { undos } : {}),
    ...(token ? { token } : {}),
    uid: progress.current.uid,
    name: nickname,
  });
}

/** 上一条卡图的缓存：key = 影响画面的全部输入，path = 已经落好的临时文件。 */
let shareCardCache: { key: string; path: string } | null = null;

/**
 * 分享抽屉：出 5:4 卡片图，导出成本地文件路径（微信 / 抖音的 `imageUrl`）。
 *
 * ## 为什么不能直接把 9:16 海报塞进 `imageUrl`
 *
 * 微信聊天卡片的显示比例是 **5:4**（500×400 / 1080×864），
 * 传别的比例会被**居中裁切**：750×1334 的海报塞进去，
 * 上下两个大标题都被切掉，只剩中间那条金缮光迹 ——
 * 看起来像一张空图，而且不会报错，分享出去照样「成功」。
 *
 * 所以另出一张横向卡图（`renderShareCard`），信息量少但排得下。
 *
 * ## 为什么要 `exportCanvas`
 *
 * `wx.shareAppMessage({ imageUrl })` 吃的是**本地文件路径**
 * （`wxfile://tmp/...`），传 dataURL 会被静默忽略、退回默认图。
 * 所以出完图还要落一次临时文件。
 *
 * ## 缓存
 *
 * 同一关、同一文案、同一链接的卡图是同一张。
 * 每次点「发送」都重画 1080×864 + 落盘，在低端机上是几百毫秒的卡顿，
 * 而玩家常常反复点（先发一个，再发一个）。key 里带上会影响画面的全部输入，
 * 换文案 / 换关卡 / 换 token 都会失效重画。
 *
 * @param query 已带 token 的启动参数（二维码与卡片要指向同一次挑战）
 * @returns 临时文件路径；这端不支持导出 / 出图失败时返回空串（**不挡分享**）
 */
async function buildShareCardImage(query: string): Promise<string> {
  if (!platform.exportCanvas) return '';
  const base = shareBaseUrl();
  const url = base && query ? `${base}?${query}` : '';

  const key = `${sharePanel.levelIdx}|${sharePanel.undos}|${sharePanel.copy}|${sharePanel.uid}|${url}`;
  if (shareCardCache && shareCardCache.key === key) return shareCardCache.path;

  const canvas = renderShareCard(
    { idx: sharePanel.levelIdx, w: 6, h: 6 },
    sharePanel.undos,
    sharePanel.copy,
    url,
  );
  if (!canvas) return '';

  const path = await platform.exportCanvas(canvas);
  if (!path) return '';
  shareCardCache = { key, path };
  return path;
}

/**
 * 分享抽屉：调起一次分享。
 *
 * @param channel `friend` / `timeline`
 */
async function sendInvite(channel: ShareChannel) {
  // 先落服务端挑战记录再分享 —— 链接里带 token，胜负由服务端判
  const query = await buildShareQueryWithToken();
  sharePanel.query = query;

  // 5:4 卡片图。只在「发给朋友」时带：朋友圈走的是系统菜单，
  // 微信不让我们定制内容，传了也用不上。
  //
  // **出图失败不挡分享** —— 一张配图比「分享按钮没反应」轻得多，
  // 退回微信默认图也能发出去。
  let imageUrl = '';
  if (channel === 'friend') {
    try {
      imageUrl = await buildShareCardImage(query);
    } catch (e) {
      console.warn('分享卡图生成失败，退回默认图', e);
    }
  }

  const res = await platform.share({
    title: sharePanel.copy,
    query,
    channel,
    ...(imageUrl ? { imageUrl } : {}),
  });

  if (res === 'sent') {
    showToast('已打开微信，选个好友发出去吧');
    reportEvent('share_success', { level_idx: sharePanel.levelIdx, channel: 'friend' });
    sharePanelOpen = false;
  } else if (res === 'menu') {
    // 朋友圈通道微信不允许定制内容，我们只能把菜单放出来，必须如实说明
    showToast('已打开右上角菜单，点「分享到朋友圈」', 3000);
    reportEvent('share_success', { level_idx: sharePanel.levelIdx, channel: 'timeline' });
    sharePanelOpen = false;
  } else if (res === 'copied') {
    showToast('链接已复制，去粘贴给好友吧');
    reportEvent('share_success', { level_idx: sharePanel.levelIdx, channel: 'copy' });
    sharePanelOpen = false;
  } else {
    showToast('分享没成功，再试一次？');
  }
}

/** 分享抽屉：复制链接。 */
async function copyInviteLink() {
  // 复制出去的链接同样要带 token ——
  // 否则从「复制链接」发出去的挑战，好友通关时服务端判不了胜负。
  const query = await buildShareQueryWithToken();
  sharePanel.query = query;
  const base = shareBaseUrl();
  if (!base) {
    // 没有 location、服务端也没下发前缀：拼出来的链接好友打不开首页以外的东西。
    // 与其复制一条坏链接，不如说清楚 —— 运营会去后台把「分享链接前缀」填上。
    showToast('分享域名还没配置，去后台填「分享链接前缀」');
    return;
  }
  const url = `${base}?${query}`;
  let ok = false;
  if (platform.clipboard) {
    try {
      ok = await platform.clipboard.set(url);
    } catch { /* 落到失败文案 */ }
  } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
    // 老平台对象上没有 clipboard 时退回浏览器 API（Web 端）
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch { /* 落到失败文案 */ }
  }

  if (ok) {
    showToast('链接已复制');
    reportEvent('share_success', { level_idx: sharePanel.levelIdx, channel: 'copy' });
    sharePanelOpen = false;
  } else {
    // 小游戏里**没有**「长按上面的链接」这回事 —— 没有可长按的文本。
    // 只能说清「复制失败」，别给一个做不到的指引。
    showToast('复制没成功，稍后再试一次');
  }
}

/**
 * 分享抽屉：保存海报。
 *
 * ## 三端三条路
 *
 * - **Web**：`<a download>` + `toDataURL`（浏览器直接下载）
 * - **小游戏**：`canvasToTempFilePath` → `saveImageToPhotosAlbum`
 *   （见 `platform/saveImage.ts`）
 *
 * ## 为什么不能只提示「请长按海报保存」
 *
 * 海报是 **canvas 渲染**的，不是 `<img>` —— canvas 的像素不是 DOM 节点，
 * **没有长按菜单**。原来那句提示是个假承诺：玩家按半天什么也不会发生，
 * 而且面板是模态层，长按也不会触发任何东西。
 */
async function saveInvitePoster() {
  const poster = buildInvitePoster();
  if (!poster) {
    // 拿不到离屏画布（既无 DOM 也没有小游戏离屏 API）
    showToast('当前环境不支持保存海报');
    return;
  }

  // ── Web：直接下载 ──
  if (platform.name === 'web') {
    if (!poster.toDataURL) {
      showToast('当前环境不支持保存海报');
      return;
    }
    const a = document.createElement('a');
    a.href = poster.toDataURL('image/png');
    a.download = `invite-${sharePanel.levelIdx}.png`;
    a.click();
    showToast('海报已下载');
    return;
  }

  // ── 小游戏：存相册 ──
  if (!platform.saveImage) {
    showToast('当前环境不支持保存海报');
    return;
  }

  const r = await platform.saveImage(poster);
  switch (r) {
    case 'saved':
      showToast('已保存到相册');
      return;
    case 'denied':
      // 授权被拒：再点一次还是弹同一个框，得引导去设置里开权限
      showToast('需要相册权限：请在设置里允许后重试', 3500);
      return;
    case 'unsupported':
      showToast('当前环境不支持保存到相册');
      return;
    default:
      showToast('保存失败，请重试');
  }
}

/**
 * 绘制挑战结算面板。
 *
 * ## 显示的是「重来次数」而不是步数
 *
 * cover 模式的步数恒为 `required − 1`，比步数没有意义。
 * 真正的对比维度是**重来次数**（和星级口径一致）。
 */
function drawChallengeResult(ctx: CanvasRenderingContext2D, r: { win: boolean; myUndos: number; bestUndos: number; fromName: string; isNewBest: boolean }): Button[] {
  // 遮罩：陶土棕的暗，不是夜空的紫黑
  ctx.fillStyle = 'rgba(58,38,24,0.62)';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  const pw = DESIGN_W - 100, ph = 500, px = 50;
  const py = Math.round((DESIGN_H - ph) / 2);
  const cx = px + pw / 2;
  const accent = r.win ? CLAY.mint : CLAY.rose;

  // 面板：��块奶油黏土板
  clayBlock(ctx, px, py, pw, ph, 44, CLAY.cream, 841, { depth: 22, hi: 0.035, jitter: 0.002 });

  // 标题带：胜=薄荷，负=玫瑰
  clayBlock(ctx, px + 22, py + 20, pw - 44, 88, 30, accent, 842, { depth: 8, hi: 0.06 });
  clayText(ctx, r.win ? '挑战成功！' : '惜败', cx, py + 64, 46, {
    fill: '#FFF6E9',
    outline: accent.shade,
    outlineWidth: 5,
  });

  clayText(ctx, `${r.fromName} 的挑战`, cx, py + 158, 26, {
    weight: 600,
    fill: CLAY_UI.inkSoft,
    outlineWidth: 0,
    emboss: false,
  });
  clayText(ctx, `我重来 ${r.myUndos} 次 · 最佳 ${r.bestUndos} 次`, cx, py + 208, 26, {
    weight: 600,
    fill: CLAY_UI.ink,
    outlineWidth: 0,
    emboss: false,
  });

  if (r.isNewBest) {
    clayBlock(ctx, cx - 160, py + 240, 320, 56, 28, CLAY.mustard, 843, { depth: 6, hi: 0.08 });
    clayText(ctx, '刷新最佳纪录！', cx, py + 268, 26, {
      fill: '#5C4208',
      outlineWidth: 0,
      emboss: false,
    });
  }

  const retry: Button = { x: 120, y: py + 322, w: DESIGN_W - 240, h: 80, label: '再试一次', kind: 'primary', id: 'retry' };
  const shareBtn: Button = { x: 120, y: py + 414, w: DESIGN_W - 240, h: 64, label: '分享', kind: 'secondary', id: 'share' };
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
  // 开放数据域自己有 30 秒缓存：刚通关就点进来时，
  // 不主动刷一下会看到自己上一关的分数
  refreshOpenData();

  // 开放数据域首帧需要时间
  setTimeout(() => { rankPage.friends.loadingOpenData = false; }, 500);
}

/** 指针按下。 */
function onDown(clientX: number, clientY: number) {
  const d = toDesign(clientX, clientY);

  // ── 适龄提示：合规模态，压在最前面 ──
  //
  // 放在调试面板之前：这是提审硬要求，没点掉之前连调试入口都不该响应。
  // 按钮列表最后一项是整屏遮罩（id 同为 ageGateOk），
  // 所以点卡片外任何地方都等于「我知道了」—— 不会出现"点不动"的死路。
  if (ageGateOpen) {
    for (const b of ageGateButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }

  // ── 调试面板压在所有页面之上 ──
  //
  // 展开时它是**模态**的：下面那一页一个都不许响应。
  // 否则在关卡里打开面板、手指从面板上滑出去，就会拖到棋盘。
  if (DEBUG_ENABLED && debugPanel.open) {
    for (const b of debugJumpButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    pressedBtn = null;
    return;
  }

  // ── 战绩弹层：模态，压在我的页与底栏之上 ──
  //
  // 必须在「判底栏」之前拦截，否则底部 tab 会被点穿。
  // 弹层按钮列表是「整屏遮罩 + 关闭键」两个，遮罩 id 也是 statsClose，
  // 所以点卡片外任何地方都等于关闭。
  if (phase === 'profile' && statsPanelOpen) {
    for (const b of statsPanelButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    // 按钮还没画出来（首帧之前）也绝不下传
    return;
  }
  // 分享抽屉是**全站模态**：它可能从首页 / 地图 / 结算页打开，
  // 所以不能像战绩弹层那样只判 `phase === 'profile'`。
  // 必须抢在底栏与页面按钮之前拦截，否则玩家会把抽屉下面的 tab 点穿。
  if (sharePanelOpen) {
    for (const b of sharePanelButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }

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
    // ── 右侧导轨优先于节点 ──
    //
    // 导轨只手势落在 656 以右（节点最右到 643，见 `RAIL.hitLeft`）。
    // 先判导轨，手指落在那一带就绝不会被当成「点了个节点」。
    const rail = pickRail(d.x, d.y, mapPage);
    if (rail) {
      // 任何新的触摸都要掐掉正在跑的惯性与缓动，
      // 否则「按停」这个最自然的手势会失效
      mapPage.fling = 0;
      mapPage.scrollTarget = null;
      mapDragStart = null;
      if (rail.kind === 'world' || rail.kind === 'current') {
        mapPage.scrollTarget = scrollToLevel(rail.level ?? mapPage.currentLevel);
        audio.tap();
        vibeAt('tap');
        return;
      }
      mapRailGrab = rail.grab;
      mapPage.scrub = true;
      mapPage.scrollY = railScrollAt(d.y, mapPage, rail.grab);
      return;
    }

    // 命中关卡节点 → 可能是点击，也可能是拖动起点
    const idx = pickMapNode(d.x, d.y, mapPage);
    mapPage.fling = 0;
    mapPage.scrollTarget = null;
    if (idx > 0) pressedBtn = 'map:' + idx;
    mapDragStart = {
      x: d.x,
      y: d.y,
      scrollY: mapPage.scrollY,
      moved: false,
      lastY: d.y,
      lastAt: Date.now(),
      v: 0,
    };
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
    // 按钮优先（「使用」压在大卡上 / 皮肤卡整张是热区，
    // 先判它就不会出现「点按钮顺手把列表推走」）
    for (const b of skinButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }

    // 货架：按下记起点，抬手时若没移动才算「选中」。
    // 只在大卡以下才起拖 —— 在大卡上滑动不该把货架推走。
    const isSkins = (skinsPage.tab ?? 'themes') === 'skins';
    const scroll = isSkins ? (skinsPage.skinScroll ?? 0) : (skinsPage.themeScroll ?? 0);
    const chip = isSkins
      ? pickSkinChip(d.x, d.y, scroll)
      : pickThemeChip(d.x, d.y, scroll);
    if (isSkins) skinsPage.skinFling = 0;
    else skinsPage.themeFling = 0;

    shelfDragStart = {
      kind: isSkins ? 'skin' : 'theme',
      y: d.y,
      scroll,
      moved: false,
      lastY: d.y,
      lastAt: Date.now(),
      v: 0,
    };

    if (chip < 0) {
      shelfDragStart = null;
      return;
    }
    pressedBtn = (isSkins ? 'skin:' : 'shelf:') + chip;
    return;
  }
  if (phase === 'result') {
    for (const b of resultButtons) {
      if (hitButton(b, d.x, d.y)) { pressedBtn = b.id; return; }
    }
    return;
  }

  if (phase !== 'playing') return;

  // ── 入场未播完：**这一下只用来跳过**，不落子 ──
  //
  // 设计稿「伍·初始界面」：「动画中再点 = 跳过（全部直接落定）」。
  // 关键在"再点"和"全部直接落定"：
  //
  // - 必须**吞掉这一下**。不吞的话玩家想跳过，结果顺手在某个格子上起了一笔，
  //   反而多出一段莫名其妙的线 —— 跳过这个动作本身会制造一个错误。
  // - 不只是把 `enterAt` 推到过去：那样格子会"瞬间全在"，没有"落定"的收束感。
  //   这里推到"刚好过了最后一格"的时刻，于是**全盘在同一步落定**，
  //   末行沙光脉冲紧接着照常播（它按 `enterAt + total` 算，会自动跟上）。
  if (enterAt && session.state) {
    const en = currentTheme()?.motion?.enter;
    if (en) {
      const st = session.state;
      const w = st.runtime.level.w;
      const h = st.runtime.level.h;
      const total = enterTotalMs(en, w, h);
      if (Date.now() - enterAt < total) {
        // 推到"整盘刚落定"那一刻，沙光脉冲才不会被一起跳掉
        enterAt = Date.now() - total;
        // 全部落定 = 过程不回放，收尾立刻来（见 `skipEnterCue`）
        skipEnterCue();
        return;
      }
    }
  }

  if (hitButton(backHomeBtn, d.x, d.y)) { pressedBtn = 'backHome'; return; }
  // 功能开关关掉时**连热区一起去掉**：画都不画了还能点中，
  // 玩家会因为「点了没反应」而以为卡了。
  if (featureOn('hint') && hitButton(hintBtn, d.x, d.y)) { pressedBtn = 'hint'; return; }
  if (!challenge && featureOn('skip') && hitButton(skipBtn, d.x, d.y)) { pressedBtn = 'skip'; return; }
  session.pointerDown(d.x, d.y);
}

/** 指针移动。 */
function onMove(clientX: number, clientY: number) {
  const d = toDesign(clientX, clientY);

  // 面板展开时不让手势漏到下面那一页（尤其别去拖棋盘）
  if (DEBUG_ENABLED && debugPanel.open) return;

  // 地图：导轨拖动 / 山道拖动
  if (phase === 'map' && mapRailGrab !== null) {
    mapPage.scrollY = railScrollAt(d.y, mapPage, mapRailGrab);
    return;
  }
  if (phase === 'skins' && shelfDragStart) {
    const wasMoved = shelfDragStart.moved;
    // 甩出去：与地图同一条衰减曲线（320ms），门槛 0.18 像素/毫秒
    if (wasMoved && Math.abs(shelfDragStart.v) > 0.18) {
      const v = Math.max(-6, Math.min(6, shelfDragStart.v));
      if (shelfDragStart.kind === 'skin') skinsPage.skinFling = v;
      else skinsPage.themeFling = v;
    }
    shelfDragStart = null;
    if (wasMoved) { pressedBtn = null; return; }
  }

  if (phase === 'map' && mapDragStart) {
    const dy = d.y - mapDragStart.y;
    if (Math.abs(dy) > 6) mapDragStart.moved = true;
    if (mapDragStart.moved) {
      // 地图的屏幕 y 是翻转的（往上 = 后面的关），所以手指往下拉 = 加 scrollY
      mapPage.scrollY = Math.max(0, Math.min(mapPage.maxScrollY, mapDragStart.scrollY + dy));

      // 速度：指数平滑，别用瞬时值 —— 抬手前那一下抖一下就决定了去哪，
      // 用瞬时值会变成「想停却飞出去三屏」
      const at = Date.now();
      const dt = Math.max(1, at - mapDragStart.lastAt);
      const inst = (d.y - mapDragStart.lastY) / dt;
      mapDragStart.v = mapDragStart.v * 0.6 + inst * 0.4;
      mapDragStart.lastY = d.y;
      mapDragStart.lastAt = at;
    }
    return;
  }

  if (phase === 'skins' && shelfDragStart) {
    const dy = d.y - shelfDragStart.y;
    if (Math.abs(dy) > 8) shelfDragStart.moved = true;
    if (shelfDragStart.moved) {
      const next = shelfDragStart.scroll - dy;
      if (shelfDragStart.kind === 'skin') skinsPage.skinScroll = clampSkinScroll(next);
      else skinsPage.themeScroll = clampShelfScroll(next);
      const at = Date.now();
      const dt = Math.max(1, at - shelfDragStart.lastAt);
      const inst = -(d.y - shelfDragStart.lastY) / dt;
      shelfDragStart.v = shelfDragStart.v * 0.6 + inst * 0.4;
      shelfDragStart.lastY = d.y;
      shelfDragStart.lastAt = at;
    }
    return;
  }

  if (phase !== 'playing') return;
  session.pointerMove(d.x, d.y);
}

/** 指针抬起。 */
function onUp() {
  // 面板开着时只认面板上的键（地图拖动 / 棋盘拖动都不该留下状态）
  if (DEBUG_ENABLED && debugPanel.open) {
    mapDragStart = null;
    const id = pressedBtn;
    pressedBtn = null;
    if (id && id.startsWith('dj:')) applyDebugJumpKey(id);
    return;
  }

  // 地图拖动结束必须在 pressedBtn 分支之前处理，否则 'map:N' 会先被消费掉
  if (phase === 'map' && mapRailGrab !== null) {
    mapRailGrab = null;
    mapPage.scrub = false;
    pressedBtn = null;
    return;
  }
  if (phase === 'map' && mapDragStart) {
    const wasMoved = mapDragStart.moved;
    // 甩出去：0.18 是「划得动但不算甩」的门槛，低于它只当普通拖动，
    // 免得轻飘飘一次点击也让地图滑走
    if (wasMoved && Math.abs(mapDragStart.v) > 0.18) {
      mapPage.fling = Math.max(-6, Math.min(6, mapDragStart.v));
    }
    mapDragStart = null;
    if (wasMoved) { pressedBtn = null; return; }
  }

  if (pressedBtn) {
    const id = pressedBtn;
    pressedBtn = null;

    // 调试面板的键（入口牌子 `dj:open` 也走这里）
    if (DEBUG_ENABLED && id.startsWith('dj:')) { applyDebugJumpKey(id); return; }

    // 适龄提示：点「我知道了」（或卡外）关闭，并落本地标记 ——
    // 下次启动不再自动弹；但「我的 → 适龄提示」仍可再打开。
    if (id === 'ageGateOk') {
      ageGateOpen = false;
      platform.storage.set(KEY_AGE_ACK, '1');
      audio.tap();
      vibeAt('tap');
      return;
    }
    if (id === 'ageGatePrivacy') {
      platform.privacy?.openContract?.();
      audio.tap();
      return;
    }

    // 战绩弹层：只有关闭键，且必须抢在导航之前（模态）
    if (id === 'statsClose') {
      statsPanelOpen = false;
      audio.tap();
      vibeAt('tap');
      return;
    }

    // 分享抽屉
    if (id === 'shareDismiss') {
      sharePanelOpen = false;
      // 回到开抽屉的那一页（地图/结算/我的）。
      // 抽屉是叠在页面上的模态层，取消要退回原处 —— 不能让玩家在地图里
      // 点开分享又取消，结果被丢回大厅。
      if (phase !== sharePanelFrom) phase = sharePanelFrom;
      audio.tap();
      return;
    }
    if (id === 'shareNewCopy') { rollShareCopy(); return; }
    if (id === 'shareFriend') { void sendInvite('friend'); return; }
    if (id === 'shareTimeline') { void sendInvite('timeline'); return; }
    if (id === 'shareDouyin') { void sendInvite('douyin'); return; }
    if (id === 'shareCopyLink') { void copyInviteLink(); return; }
    if (id === 'shareSavePoster') { saveInvitePoster(); return; }

    // 底部导航
    if (id.startsWith('nav:')) { void gotoTab(id.slice(4) as NavTab); return; }

    // 大厅 / 地图
    if (id === 'homeStart') {
      reportEvent('home_start_click', { level_idx: progress.currentLevel });
      void enterLevel(progress.currentLevel);
      return;
    }
    if (id === 'navHome') { void gotoTab('home'); return; }
    if (id === 'playCurrent') {
      // 吸底的「继续」：地图一屏只有 8 关，让玩家自己找当前关太苛刻
      reportEvent('map_level_click', { level_idx: progress.currentLevel });
      void enterLevel(progress.currentLevel);
      return;
    }
    if (id === 'mapHome') {
      // 拖到别处之后回到自己：以缓动回去，不是瞬移 ——
      // 瞬移之后玩家不知道「刚才看的和现在的是不是同一个地方」
      mapPage.fling = 0;
      mapPage.scrollTarget = scrollToLevel(mapPage.currentLevel);
      audio.tap();
      vibeAt('tap');
      return;
    }
    if (id.startsWith('shelf:')) {
      const chip = parseInt(id.slice(6), 10);
      const tid = themeIdAt(chip);
      skinsPage.themeSelected = tid;
      // 点选就试一声：挑主题时耳朵比眼睛快。
      // 用 `probe` 而不是 `preview` —— 玩家会连着点八套，播完整签名动机太吵。
      // 未解锁的也照播：这是「先听再决定要不要打」，属于陈列的一部分。
      audio.probe(tid);
      return;
    }
    if (id.startsWith('map:')) {
      const idx = parseInt(id.slice(4), 10);

      // ── 分享选关模式：只能选自己已经通过的关 ──
      //
      // 分享出去的是一份「同关挑战」，发一关自己都没打过的，既没有成绩也
      // 不知道这关什么难度。所以这里用 `isLevelCleared`（按星级判定，
      // 跳过关不算通过），未通过的关只给一句提示，不弹分享面板。
      // 这里不推进任何进度、不进关。
      if (mapPage.shareMode) {
        if (!isLevelCleared(idx, mapPage)) {
          mapPage.toast = `先通过第 ${idx} 关，才能分享`;
          mapPage.toastAt = Date.now();
          return;
        }
        openSharePanel(idx, null, 'map');
        return;
      }

      if (isLevelPlayable(idx, mapPage)) {
        // 调试模式下点未解锁的关 → **直接进关**。
        //
        // 旧注释说「先让服务端把进度推上去，地图显示才对得上」—— 那正是
        // 2026-11-21 那次进度被顶坏的来源：点开第 405 关看一眼，
        // `max_level` 就从真实的 153 变成 404，而且再也降不回来。
        // 现在跳关接口只做「服务端调试开关开着没」的探针，一个字节都不写。
        //
        // `DEBUG_ENABLED &&` 让生产构建把这一整块 tree-shake 掉
        // （连同 `debugJump` 这个 API 一起）。
        const needJump = DEBUG_ENABLED && idx > progress.currentLevel;
        reportEvent('map_level_click', { level_idx: idx, debug: needJump });
        if (needJump) {
          void jumpAndEnter(idx);
          return;
        }
        void enterLevel(idx);
      } else {
        mapPage.toast = `先通过第 ${progress.current.maxLevel} 关`;
        mapPage.toastAt = Date.now();
      }
      return;
    }

    // 首页「分享挑战」条 → 进地图的选关分享模式
    if (id === 'homeSharePick') {
      // 一关都没通过时，进去也是一张全灰的地图 —— 不如在门口说清楚。
      if (progress.current.maxLevel < 1) {
        showToast('先通过第 1 关，才能分享挑战');
        return;
      }
      mapPage = createMapState(progress.currentLevel, totalLevelCount(), progress.current.stars, DEBUG_ENABLED);
      // 选关模式下**停在最高已通关的那一关**，而不是「下一关」——
      // 下一关必然不可选，停在它上面等于让玩家先看到一张点不动的图。
      mapPage.scrollY = Math.min(mapPage.maxScrollY, scrollToLevel(Math.max(1, progress.current.maxLevel)));
      mapPage.shareMode = true;
      mapDragStart = null;
      phase = 'map';
      audio.tap();
      vibeAt('tap');
      return;
    }

    // 地图选关模式的两个出口：脚卡「取消」/ 底部导航切走都算退出
    if (id === 'sharePickCancel') {
      mapPage.shareMode = false;
      void gotoTab('home');
      return;
    }

    // 排行榜 Tab
    if (id === 'tabGlobal') { rankPage.tab = 'global'; reportEvent('leaderboard_tab_switch', { tab: 'global' }); return; }
    if (id === 'rankPrev') {
      void loadGlobalRank(Math.max(0, rankPage.global.offset - rankPage.global.pageSize));
      return;
    }
    if (id === 'rankNext') {
      void loadGlobalRank(rankPage.global.offset + rankPage.global.pageSize);
      return;
    }
    if (id === 'tabFriends') {
      rankPage.tab = 'friends';
      reportEvent('leaderboard_tab_switch', { tab: 'friends' });
      void openFriends();
      return;
    }

    // 我的页功能行
    if (id === 'toggleSound') {
      profilePage.soundOn = !profilePage.soundOn;
      // 这个开关以前是死的：改了 `profilePage.soundOn`，`audio` 从来没读过它。
      // 玩家以为静音了，进关卡照样响 —— 比没有开关更糟。
      audio.setEnabled(profilePage.soundOn);
      platform.storage.set(KEY_SOUND, profilePage.soundOn ? '' : '1');
      if (profilePage.soundOn) audio.tap();
      vibeAt('tap');
      return;
    }
    if (id === 'toggleVibrate') {
      profilePage.vibrateOn = !profilePage.vibrateOn;
      platform.storage.set(KEY_VIBRATE, profilePage.vibrateOn ? '' : '1');
      // 打开时立刻震一下 —— 这是玩家唯一能当场确认"到底开没开"的办法
      // 用连径档而不是按钮档：按钮档 5ms 在多数安卓机上根本感知不到，
      // 那样这个开关看起来还是"死的"
      vibeAt('trail');
      return;
    }
    // 我的页「分享挑战」—— 邀请：不带成绩，挑的是「当前该打的那一关」
    if (id === 'shareGame') { openSharePanel(progress.currentLevel, null, 'profile'); return; }
    // 我的页「昵称头像」：微信资料必须由玩家手势触发，所以只能放在这里。
    if (id === 'editProfile') { void editProfile(); return; }
    // 我的页「适龄提示」：首次启动弹过一次，这里随时能回看
    if (id === 'ageGate') {
      ageGateOpen = true;
      audio.tap();
      vibeAt('tap');
      return;
    }
    if (id === 'profileStats') {
      // 两个弹层互斥，否则遮罩叠两层、点关闭只关掉最上面那层
      sharePanelOpen = false;
      statsPanelOpen = true;
      audio.tap();
      vibeAt('tap');
      reportEvent('profile_stats_view', { max_level: profilePage.maxLevel });
      return;
    }

    // 游戏内
    if (id === 'hint') void useHint();
    else if (id === 'skip') void useSkip();
    else if (id === 'backHome') { phase = 'home'; return; }
    else if (id === 'next') void enterLevel(pendingLevel);
    else if (id === 'home') { phase = 'home'; challenge = null; challengeResult = null; return; }
    // 「重来」要回到**刚打完的这一关**，不是下一关。
    //
    // 以前写的是 `pendingLevel`（= 当前关 + 1）——
    // 玩家通关第 1 关后点「重来」，直接被带到第 2 关，
    // 语义完全错了（「重来」= 再玩一次刚才那关）。
    // `resultData.levelIdx` 才是刚打完的关号。
    else if (id === 'retry') {
      challengeResult = null;
      // 这里**不再** `totalRetries += 1`。
      //
      // 「累计重来」的口径是「各关悔棋数之和」（服务端 `SUM(level_records.undos)`，
      // 与后台玩家详情页一致）。按钮点一次只记 1，而玩家在关里撤销 20 步
      // 再重开，真实的悔棋是 20 —— 两个数字混在一起，页面上的「累计重来」就没意义了。
      // 现在它只从服务端同步（见 `boot()` 的 `progress.sync`）。
      const target = challenge ? challenge.levelIdx : (resultData?.levelIdx ?? pendingLevel);
      void enterLevel(target);
    }
    // 通关结算的「分享」：分享**刚打完的这一关 + 本局重来数**。
    //
    // 与我的页那条（邀请）的区别就在 `undos`：这里是真成绩，
    // 好友要重来 ≤ 我才能赢；邀请那条不带成绩。
    //
    // 关号取 `resultData.levelIdx` 而不是 `pendingLevel` ——
    // 后者是「下一关」，分享出去会变成一句和刚打完的这局无关的话。
    else if (id === 'share') {
      const lv = challenge ? challenge.levelIdx : (resultData?.levelIdx ?? pendingLevel - 1);
      const undos = challengeResult ? challengeResult.myUndos : (resultData?.undos ?? null);
      openSharePanel(lv, undos, 'result');
    }
    else if (id === 'skins') {
      phase = 'skins';
      syncSkinsPage();
      skinsPage.themeScroll = 0;
      skinsPage.themeFling = 0;
      skinsPage.skinScroll = 0;
      skinsPage.skinFling = 0;
      shelfDragStart = null;
      ads.showBanner();
      reportEvent('theme_page_view', { owned: unlockedThemeCount(skinsPage), total: shelfCount() });
    }
    else if (id === 'back') { phase = 'home'; ads.hideBanner(); }
    else if (id === 'equipTheme') equipSelectedTheme();
    else if (id === 'themeTab') { skinsPage.tab = 'themes'; skinsPage.themeFling = 0; audio.tap(); }
    else if (id === 'skinTab') {
      skinsPage.tab = 'skins';
      skinsPage.skinFling = 0;
      audio.tap();
      reportEvent('skin_page_view', { owned: ownedSkinCount(skinsPage), total: SKINS.length });
    }
    else if (id.startsWith('skin:')) equipSkinAt(parseInt(id.slice(5), 10));
    else if (id.startsWith('skinAd:')) void unlockSkinByAd(parseInt(id.slice(7), 10));
    else if (id === 'unlockThemeAd') void unlockThemeByAd();
    return;
  }
  if (phase === 'playing') {
    // 松手后**不再**立即结算 —— 见 `CoverSession.pointerUp`。
    //
    // 判定（通关）在这一刻确认；**未通关则什么也不发生**：
    // 路径定住、钥匙星星留着，玩家随时按回线头接着拖。
    // 惩罚（`undos + 1`）只发生在玩家按下**别的格子**那一刻（`abandoned`）。
    session.pointerUp();
  }
}

/**
 * 重新测量画布并重建视口。
 *
 * ## 为什么必须有
 *
 * 画布尺寸只在启动时读一次。手机端地址栏收缩、横竖屏切换、窗口缩放之后，
 * 画布的 CSS 尺寸变了，但记录下来的 `width` / `height` / `dpr` 还是旧的 ——
 *
 * - 渲染：`viewport.applyTo` 用旧尺寸算缩放 → 画面被拉伸 / 偏移
 * - 输入：`toDesign` 用旧尺寸反解 → **点击位置整体偏移**
 *
 * 这和历史上修过的「渲染与输入坐标变换不一致」是同一类问题，
 * 只是这次的触发条件是窗口尺寸变化。
 */
function applyResize(): void {
  if (!platform.resizeCanvas) return;
  const m = platform.resizeCanvas();
  if (m.width === width && m.height === height && m.dpr === dpr) return;

  width = m.width;
  height = m.height;
  dpr = m.dpr;
  viewport = createViewport({
    width,
    height,
    dpr,
    designWidth: DESIGN_W,
    designHeight: DESIGN_H,
  });
  reportEvent('canvas_resize', { width, height, dpr });
}

// 事件绑定（平台分支）
if (platform.name === 'web') {
  canvas.addEventListener('pointerdown', (e) => onDown(e.clientX, e.clientY));
  canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  if (DEBUG_ENABLED) bindDebugKeys();
  platform.onResize?.(applyResize);
} else {
  // ## 触摸一律走 `platform.onTouch`
  //
  // 以前这里直接读 `globalThis.wx.onTouchStart` —— 微信包能跑，
  // **抖音包里一个触摸事件都收不到**（抖音只有 `tt`），
  // 而且是可选链静默短路：没有任何报错，只是「点了不动」。
  // 平台层的意义就是把这类差异收在一处，调用方不该知道命名空间叫什么。
  platform.onTouch?.({
    down: onDown,
    move: onMove,
    up: onUp,
    // 系统打断不能当"松手"：来电挂断后玩家手指并没抬起，
    // 当松手会立刻结算一局并不完整的路径。按取消处理（`CoverSession` 里会作废本段）。
    cancel: onUp,
  });

  platform.onAppHide?.(() => {
    void tracker.flush();   // 补传埋点
    session.abandon();
  });

  platform.onAppShow?.((query) => {
    // 从后台回来：窗口尺寸可能已经变了（横竖屏切换 / 状态栏高度变化）
    applyResize();
    void refreshProgress();
    // 点好友分享卡片进来时，小游戏不重启，参数只在这里出现
    void handleHotLaunch(query);
  });

  platform.onResize?.(applyResize);
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
  waveAt = new Map();
  const st = session.state;
  if (!st || !winAnimStart) return;
  const elapsed = now - winAnimStart;
  const rs = st.runtime.rs;
  const total = st.path.length;
  for (let i = 0; i < total; i++) {
    // 设计稿是 48ms 一粒（"[10,25,10,25,18] 震"同一节奏）。
    // 60ms 是上一版的数，一盘 40 步就是 400ms 的差距 —— 末粒的土埙会晚半拍
    const delay = (total - 1 - i) * WAVE_STEP_MS;
    if (elapsed >= delay) {
      const idx = rs.flatOf[st.path[i]];
      waveLit.add(idx);
      waveAt.set(idx, winAnimStart + delay);
    }
  }
}

/** 渲染循环。 */
function frame() {
  const { now, dt } = tick();
  updateWave(now);

  // 松手宽限期到点 → 这一段作废（见 `CoverSession.tick`）。
  // 必须每帧比对时间戳，不能靠 `setTimeout`：切后台时定时器被节流，
  // 回前台时「早该过期了」却还要等下一次触发。
  if (phase === 'playing') session.tick(now);
  if (phase === 'skins') {
    // 两块的惯性各自推进：切分段时另一块的甩动不该继续跑
    stepThemeScroll(skinsPage, dt);
    stepSkinScroll(skinsPage, dt);
  }

  // 渲染异常不能拖垮整个游戏。
  //
  // `requestAnimationFrame(frame)` 在函数**末尾**调用，
  // 所以 `frame` 一旦抛异常，这行永远不会执行 —— 渲染循环就此中断，
  // 画面停在最后一帧，之后点任何按钮都没反应。
  //
  // 真实踩过的坑：通关后 `progress.current.unlockedSkins.length` 抛
  // `Cannot read properties of undefined`，画面卡在结算动画、
  // 『下一关』点不动，而且**不会报任何网络错误**，极难定位。
  //
  // 所以这里兜住异常：打日志、保持循环继续，
  // 下一帧还能重新渲染（甚至能自愈）。
  try {
    renderFrame(now, dt);
  } catch (e) {
    console.error('[render] 渲染帧异常', e);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/**
 * 当前屏幕在设计坐标系里覆盖的矩形。
 *
 * 等比缩放是「整张设计稿缩到屏幕里，多出来的边留白」——
 * 把留白反算回设计坐标就是负数，范围会大于 750×1334。
 * 背景按这个盒子画才能铺满整屏。
 */
function visibleDesignBox(): { x: number; y: number; w: number; h: number } {
  const s = viewport.scale;
  return {
    x: -viewport.offsetX / s,
    y: -viewport.offsetY / s,
    w: width / s,
    h: height / s,
  };
}

/** 渲染一帧的具体内容（与 `frame` 分离，方便统一兜异常）。 */
function renderFrame(now: number, dt: number): void {
  // ── 设计坐标系 → 设备像素 ──
  //
  // 变换由视口统一提供，保证和 `toDesign` 严格互逆。
  viewport.applyTo(ctx);

  const st = session.state;
  const playing = !!st && !!session.layout && (phase === 'playing' || phase === 'result');

  /**
   * 已装备的棋盘主题。
   *
   * **只在盘面阶段生效**：大厅 / 地图 / 皮肤页仍是陶土工坊。
   * 主题是「换棋盘」，不是「换整个 App」—— 菜单一旦跟着变深色，
   * 黏土按钮和浅色文字会立刻打架，而那不是主题该负责的事。
   */
  const boardTheme = playing ? themeById(progress.current.currentTheme) : undefined;

  // 背景：全站统一陶土桌面（黏土工坊），各页面不再画背景。
  //
  // **必须覆盖「实际可视范围」而不是 750×1334**：等比缩放后上下（或左右）
  // 会留下几十像素的空白，那段区域不在设计稿里，背景渐变就断在边界上 ——
  // 观感是一道横贯屏幕的接缝（375×667 满屏，但 390×844 上下各留 75px）。
  // 传入反算出来的设计坐标盒子后，一块渐变铺满整屏，接缝消失。
  //
  // 主题接管后由主题自己铺（每套的底纹是它成立的一半）。
  if (boardTheme) boardTheme.backdrop(ctx, visibleDesignBox(), now);
  else drawLobbyGround(ctx, visibleDesignBox());

  // 冷启动：还没有任何页面可画。
  //
  // 不加这一段的话，`boot()` 等登录 / 配置 / 关卡表的几秒里屏幕上
  //**只有一块不动的底色** —— 玩家以为卡死，审核当成加载失败。
  if (phase === 'loading') {
    drawBootSplash(ctx, now);
    return;
  }

  if (st && session.layout && playing) {
    const rs = st.runtime.rs;
    const level = st.runtime.level;

    /** 当前路径（拍平索引序列）。 */
    const flat = st.path.map((l) => rs.flatOf[l]);
    /** 已覆盖的格（拍平索引集合）。 */
    const covered = new Set<number>(flat);
    for (const idx of waveLit) covered.add(idx);

    /** 已拾取的钥匙 / 已过的星星（分组集合）。 */
    const keysHeld = new Set<number>();
    const shardsGot = new Set<number>();
    let shardTotal = 0;
    for (let i = 0; i < rs.typeOf.length; i++) if (rs.typeOf[i] === 4 /* SHARD */) shardTotal++;
    for (const l of st.path) {
      const t = rs.typeOf[l];
      if (t === 5 /* KEY */) keysHeld.add(rs.groupOf[l]);
      if (t === 4 /* SHARD */) shardsGot.add(rs.groupOf[l]);
    }
    // 星屑编号是 1..k 顺序必经 —— 所以「下一个」= 已收集的数量。
    // 不能靠「最后走过的那颗 +1」：一颗没走过时它会是 -1，
    // HUD 就不显示「下一个 ★1」，玩家开局不知道要先捡星。
    const shardNext = shardsGot.size < shardTotal ? shardsGot.size : -1;

    // 画序固定：板 → 格 → 连线 → 筹码 → 当前格/提示 → 端点。
    //
    // 旧实现把「提示高亮」塞在格子层里画，连线横穿时会把高亮切断；
    // 而当前格（玩家在哪）**根本没有标记**，只能靠线头猜。
    const boardArg = { w: level.w, h: level.h, grid: level.grid };
    const coverState = {
      covered,
      path: flat,
      hint: st.hint,
      keysHeld,
      shardsGot,
      shardNext,
      shakeCell,
      shakeAt,
      pressCell,
      pressAt,
    };
    if (boardTheme) {
      // 主题接管整块盘面。提示只给窗口内的 5 格 —— 和黏土管线同一规则，
      // 整条路线一次点亮等于把答案摊在桌上。
      const hintWindow =
        st.hint && st.hint.cells.length > 0
          ? st.hint.cells.slice(st.hint.at, st.hint.at + 5)
          : undefined;
      boardTheme.board({
        ctx,
        board: boardArg,
        layout: session.layout,
        state: {
          covered,
          path: flat,
          keysHeld,
          shardsGot,
          shardNext,
          hint: hintWindow,
          // 松手宽限：线要变淡。旧管线是在这里用 globalAlpha 包住的，
          // 主题接管后必须显式传下去，否则宽限期的线会全亮。
          paused: st.phase === 'paused',
          shakeCell,
          shakeAt,
          pressCell,
          pressAt,
          // 动效的时刻：落子 / 沥金生长 / 铺满级联 / 盖印抖墙 / 整盘进场
          drops: dropAt,
          trailAt,
          settle: waveAt,
          wonAt: winAnimStart,
          enter: enterAt || undefined,
        },
        now,
        dpr: viewport.scale * viewport.dpr,
      });
    } else {
      const curSkin = skinById(progress.current.currentSkin);

      drawCoverPlate(ctx, boardArg, session.layout, level.idx, viewport.scale * viewport.dpr);
      drawCoverCells(ctx, boardArg, session.layout, coverState, curSkin, now);
      // 松手后线**照常全亮** —— 它就是玩家画出的东西，是稳定状态，不是"暂存"。
      //
      // 早先这里给 `paused` 压到 0.55，因为当时松手只有 1.5 秒宽限、
      // 线即将作废，压暗是在说"这还不是你的"。现在松手即定住，
      // 再压暗就成了"我画完一条线，它自己变灰了"——纯粹的困惑。
      drawCoverTrail(ctx, flat, level.w, level.grid, session.layout, CLAY.terracotta);
      drawCoverMarks(ctx, boardArg, session.layout, coverState);
      drawCoverHead(ctx, boardArg, session.layout, coverState, now);
      // 端点圆片必须在连线之后，否则线头会横穿圆片、把「起」「终」压成一团
      drawCoverEndpoints(ctx, boardArg, session.layout);
    }

    // ── 抵达 · 爆闪（终点格）──
    //
    // 设计稿把它排在**通关级联之前**：线头碰到终点的那一瞬，终点格炸一下
    // （八芒 + 双环 + 芯点，420ms），然后才开始"从终点反向点亮全路径"，
    // 最后才是落印。所以这三件事在时间上是严格串行的，不能一起放。
    //
    // 画在盘面之后、印章之前：爆闪属于盘面（它长在终点那一格里），
    // 而印章是浮在盘上的一枚印 —— 顺序反了，印会被爆闪的光洗掉。
    if (winAnimStart && phase === 'playing' && boardTheme?.arrive) {
      const burstElapsed = now - winAnimStart;
      if (burstElapsed >= 0 && burstElapsed < 520) {
        for (let i = 0; i < boardArg.grid.length; i++) {
          if (cellType(boardArg.grid[i]) !== CoverCell.END) continue;
          const bx = i % boardArg.w;
          const by = Math.floor(i / boardArg.w);
          const L = session.layout;
          boardTheme.arrive(
            ctx,
            L.originX + bx * L.cell + L.cell / 2,
            L.originY + by * L.cell + L.cell / 2,
            L.cell,
            burstElapsed,
          );
          break;
        }
      }
    }

    // ── 通关：棋盘正中落一枚朱印「过」 ──
    //
    // 必须有这一下。波次点亮（`waveLit`）点的是**本来就亮着**的格子，
    // 通关那一刻盘面不会有任何变化，玩家看到的只是"最后一格连上 → 停 1.7 秒"。
    // 印章是全屏唯一一点红，也是这一局唯一一次"被宣告结束"。
    if (winAnimStart && phase === 'playing' && !challenge) {
      const c = cardOf(session.layout);
      /**
       * 印的边长 —— **按卡宽算，不按格宽**。
       *
       * 这枚印是"盖在整面墙上的落款"，它属于盘面而不是某一格。
       * 按格宽算（早先的写法 `cell × size`）会有两个后果：
       *
       * - **大盘上印会缩没**：11×11 的格宽只有 55px，`0.8 × 55 = 44px`，
       *   那已经不是"盖印"了，是格心上的一个小红点；
       * - **换关时量感会跳**：同一个通关动作，5×6 是 167px、11×11 是 91px，
       *   隔两关再通关会觉得"这次的印怎么变小了"。
       *
       * 卡宽恒定（662，见 `BOARD_CARD_W`），所以按卡宽算的结果在任何盘面上
       * 都是同一个尺寸。`0.29 × 662 ≈ 192`，正好是结算页那枚印
       * （`SEAL_S = 192`）的大小 —— 通关动效既然收在一枚印上，
       * 就该和结算页同一个量级，而不是比它小一圈。
       *
       * 主题可以覆盖这个比例（`motion.seal.size`），但那是"这套主题的印
       * 相对别套重多少"，单位是**卡宽**。
       */
      const sealMul = boardTheme?.motion?.seal?.size ?? 0.25;
      const sealSize = Math.min(c.w, c.h) * sealMul;
      // 印要等**末粒落定**才砸（`winSealAt`）。早于那一刻 `elapsed` 为负，
      // 主题自己会跳过 —— 这里不提前 return，免得天青/黏土那两套（没有级联）
      // 一并被推迟
      const sealElapsed = now - winAnimStart - winSealAt;
      // 印的形状是各套主题的「款」：黏土/天青是圆的朱印，鸣沙是方的石章。
      // 形状不同，砸下来的动效也不同，所以交给主题自己画
      if (boardTheme?.winSeal) {
        boardTheme.winSeal(ctx, c.x + c.w / 2, c.y + c.h / 2, sealSize, sealElapsed);
      } else {
        drawWinSeal(ctx, c.x + c.w / 2, c.y + c.h / 2, sealSize, now - winAnimStart);
      }
    }

    // 主题的界面配色。空 = 黏土（经典盘面）
    const chrome = boardTheme?.chrome;

    drawHud(
      ctx, level.idx, progress.current.currentSkin, progress.current.unlockedSkins.length,
      config?.skins?.length ?? 13,
      { done: st.path.length, total: level.required, shardNext },
      chrome,
    );

    // D=0 的关卡两端都自由：开局面对一张空盘没有任何锚点。
    if (level.deadEnds === 0 && st.path.length === 0) {
      drawCoverFreeStartHint(ctx, session.layout, chrome?.inkSoft);
    }
    drawPlayFootnote(ctx, session.state?.undos ?? 0, chrome);

    // ── 盘底三层（设计稿 03）：金「提 示」→ 机制图例 → 次级行动
    //
    // 「提示」是这一屏唯一的正向行动点，做成满栏金条；
    // 「返回 / 跳过」是负向/低频动作，压到最下面一行灰底 —— 和金子拉开层级，
    // 也离盘面最远（误触代价最小）。
    if (chrome) {
      if (featureOn('hint')) drawPlayTip(ctx, hintBtn, pressedBtn === 'hint');
    } else if (featureOn('hint')) {
      drawButton(ctx, hintBtn, pressedBtn === 'hint', undefined, chrome);
    }

    // 图例：固定七枚（含墨石），逐关不变 —— 它是这个世界的"物种表"，
    // 不是本关的按键索引（见 `drawPlayLegend` 的说明）
    if (!challenge) {
      drawPlayLegend(
        ctx,
        // 图例的色块跟主题走：天青是暗石板 + 金线，鸣沙是六枚矿物色片。
        // 不跟着换的话，亮色盘面上那六块近黑的方格会像六张贴纸。
        LEGEND_META.map(({ kind, label, bg, ink }) => {
          const ov = boardTheme?.legend?.[kind];
          return { kind, label, bg: ov?.bg ?? bg, ink: ov?.ink ?? ink };
        }),
        1008,
        chrome,
        boardTheme?.legendMarks,
      );
    }

    // 挑战关不给「跳过」：比的就是谁真能走完，花钱跳过是另一种玩法。
    // 功能开关关掉时同理 —— 不画、也不留热区。
    if (chrome) {
      if (!challenge && featureOn('skip')) drawPlaySub(ctx, skipBtn, pressedBtn === 'skip', chrome);
      drawPlaySub(ctx, backHomeBtn, pressedBtn === 'backHome', chrome);
    } else {
      if (!challenge && featureOn('skip')) drawButton(ctx, skipBtn, pressedBtn === 'skip', undefined, chrome);
      drawButton(ctx, backHomeBtn, pressedBtn === 'backHome', undefined, chrome);
    }

    // 挑战模式横幅：放**棋盘下方**那条空带里。
    //
    // 原来盖在关号胶囊上（y 84~160），胶囊加高到 84 之后它会同时压住
    // 「提示」按钮的左半边 —— 两个都可点的东西叠在一起，误触只会更糟。
    // 棋盘底最多到 1031（11×11），1100 往下是完全空的，横幅放这里不抢任何东西。
    if (challenge) {
      const name = challenge.fromName.length > 6 ? `${challenge.fromName.slice(0, 6)}…` : challenge.fromName;
      clayBlock(ctx, 90, 240, DESIGN_W - 180, 62, 28, CLAY.mustard, 881, { depth: 8, hi: 0.07 });
      clayText(ctx, `${name} 的挑战 · 第 ${challenge.levelIdx} 关`, DESIGN_W / 2, 271, 26, {
        fill: '#4A3327',
        outlineWidth: 0,
        emboss: false,
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
      currentLevel: progress.currentLevel,
      skinCount: progress.current.unlockedSkins.length,
      starCount: totalStars(),
      totalRetries: progress.current.totalRetries ?? 0,
      // 配置是异步拉回来的（可能比首屏晚），逐帧对齐一次最省心
      shareOn: featureOn('shareChallenge'),
    };
    homeButtons = drawHomePage(ctx, homePage, now);
  }
  if (phase === 'map') {
    // 星级与当前关可能在通关后变化，每帧对齐一次
    mapPage.stars = progress.current.stars;
    mapPage.currentLevel = progress.currentLevel;
    // 惯性 / 缓动按帧推进（换算见 `stepMapScroll`）
    stepMapScroll(mapPage, dt);
    mapButtons = drawMapView(ctx, mapPage, now, progress.current.currentTheme);
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
    drawNav(ctx, navTabOf(phase), now, themeById(progress.current.currentTheme)?.chrome);
  }

  // ── 战绩弹层（模态，压在底栏之上）──
  //
  // 必须画在 `drawNav` **之后**：弹层是模态的，底栏若压在它上面，
  // 玩家会一边看着弹层一边把 tab 点穿。同理 `onDown` 里要抢先拦截。
  if (phase === 'profile' && statsPanelOpen) {
    statsPanelButtons = drawStatsPanel(ctx, {
      maxLevel: profilePage.maxLevel,
      currentLevel: profilePage.currentLevel,
      starCount: profilePage.starCount,
      threeStarCount: profilePage.threeStarCount,
      totalRetries: profilePage.totalRetries,
      totalSteps: profilePage.totalSteps,
      totalTimeMs: profilePage.totalTimeMs,
      adWatchCnt: profilePage.adWatchCnt,
      levelCount: totalLevelCount(),
    });
  }

  // ── 分享抽屉（全站模态，压在底栏与结算面板之上）──
  //
  // 绘制必须放在**所有页面之后**：它可能从首页 / 地图 / 结算页打开，
  // 若跟着某一页画，从别处打开时就会被后面的页面盖住。
  // 见文件末尾的 `drawSharePanel` 调用点。

  if (phase === 'result' && challengeResult) {
    resultButtons = drawChallengeResult(ctx, challengeResult);
  } else if (phase === 'result' && resultData) {
    // 全部通关 = 通关的关号已经等于总关数
    const isAllCleared = resultData.levelIdx >= totalLevelCount();
    resultButtons = drawResult(
      ctx, resultData.levelIdx, resultData.steps, resultData.shortest,
      resultData.timeMs, resultData.unlockedSkin,
      progress.current.maxLevel / totalLevelCount(),
      resultData.undos,
      resultData.skipped === true,
      isAllCleared,
      resultData.rejected === true,
    );
  }

  // ── 调试面板 ──
  //
  // 画在横屏提示**之前**：横向时面板本身也放不下（几乎占满屏宽），
  // 该让「请竖屏」盖住它，而不是反过来把提示压住。
  if (DEBUG_ENABLED && debugPanel.open) {
    debugJumpButtons = drawDebugJump(ctx, debugPanel, now, totalLevelCount(), visibleDesignBox());
  }

  // ── 横屏提示 ──
  //
  // 等比缩放把 750×1334 塞进 844×390 时只剩 32% 宽，格子不到 20px，
  // 拖着拖着手指就出界了。桌面浏览器窗口拉宽不算（短边 > 560）。
  if (width > height * 1.05 && Math.min(width, height) < 560) drawRotateHint(ctx);

  // ── 切页转场：剥壁揭示 ──
  //
  // 检测放在这里而不是每个 `phase = '...'` 旁边：页面切换在这一层已经全部
  // 落定，逐处去埋点必然漏一处（大厅到地图、跳过到下一关、返回首页……）。
  if (peekPhase === null) peekPhase = phase;
  else if (phase !== peekPhase) {
    peekPhase = phase;
    const skin = phase === 'playing' || phase === 'result' ? currentTheme()?.wipe : undefined;
    wipeSkin = skin ?? null;
    wipeAt = skin ? now : 0;
  }
  if (wipeAt && wipeSkin) {
    const e = now - wipeAt;
    // 时长按主题走：鸣沙 480ms 剥壁，天青 520ms 釉光抹开
    if (e >= (wipeSkin.ms ?? WIPE_MS)) {      wipeAt = 0;
      wipeSkin = null;
    } else {
      drawWallWipe(ctx, visibleDesignBox(), e, wipeSkin);
    }
  }

  // ── 分享抽屉（全站模态：首页 / 地图 / 结算页都可能打开它）──
  //
  // 画在**页面与底栏之后、提示条之前**：
  // - 在页面之后，换个入口打开也不会被后面的页面盖住；
  // - 在提示条之前，因为「已打开微信」「链接已复制」这类反馈
  //   恰恰是在抽屉上点出来的，必须比抽屉更靠前。
  //
  // 不放进 `isNavPhase` 分支：结算页不是 nav 页，但它也要能开抽屉。
  if (sharePanelOpen) {
    sharePanelButtons = drawSharePanel(ctx, sharePanel);
  }

  // ── 适龄提示（最上层，压过所有页面与弹层）──
  //
  // 画在提示条之前：「未同意隐私政策」这类提示恰恰要能盖在它上面。
  if (ageGateOpen) {
    ageGateButtons = drawAgeGate(ctx, !!platform.privacy?.openContract);
  }

  // ── 全局提示条（最后画，压在所有页面之上）──
  drawToast(ctx, now);
}

/**
 * 横屏时的「请竖屏」遮罩。
 *
 * ## 为什么用 CSS 像素画，而不是设计坐标
 *
 * 横屏时等比缩放的系数只有 0.29（750 宽的设计稿塞进 844×390），
 * 在设计坐标里写 46 号字，落到屏上只有 13px —— 正是这条提示要告诉玩家
 * 「屏幕不够用」，它自己先看不清就滑稽了。
 * 所以这里临时把变换换成 `1 单位 = 1 CSS px`，按真实像素排版。
 *
 * 只提示、不拦截 —— 输入层没做方向判断，玩家硬要横着玩也点得动，
 * 只是画面被盖住了。真做拦截还要处理「转回来之后按下的按钮还停在
 * `pressedBtn` 里」这类状态残留，得不偿失。
 */
function drawRotateHint(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#3A2618';
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;

  // 图标：一部横躺的手机（竖版圆角矩形转 90°）
  ctx.save();
  ctx.translate(cx, cy - 46);
  ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = 'rgba(255,246,233,0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(-18, -28, 36, 56, 7);
  else ctx.rect(-18, -28, 36, 56);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,246,233,0.5)';
  ctx.beginPath();
  ctx.arc(0, 18, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 24px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#FFF6E9';
  ctx.fillText('请竖屏游玩', cx, cy + 22);

  ctx.font = '500 14px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(255,246,233,0.66)';
  ctx.fillText('横屏时棋盘只剩三分之一宽，手指放不下', cx, cy + 52);

  ctx.restore();
}

/**
 * 画全局提示条。
 *
 * 画在**所有**页面之上 —— 失败提示不能被某个页面盖住，
 * 否则玩家还是看不到「刚才那下没成功」。
 */
function drawToast(ctx: CanvasRenderingContext2D, now: number): void {
  if (!toastMsg) return;
  const age = now - toastAt;
  if (age > toastMs) { toastMsg = ''; return; }

  // 淡入 150ms / 淡出 300ms
  const alpha = Math.min(1, age / 150, (toastMs - age) / 300);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  ctx.font = '600 26px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(toastMsg).width;
  const bw = Math.min(DESIGN_W - 80, tw + 56);
  const bh = 64;
  const bx = (DESIGN_W - bw) / 2;
  // 240 = 进度读数下方、盘面顶部上方那条空带。
  //
  // 原来钉在底部（DESIGN_H − 320），但在游戏内那一片是「盘面底缘 + 提示按钮」，
  // toast 要么压住棋盘的下沿、要么贴到按钮顶上 —— 5×5 这种下缘不规则的盘面尤其难看。
  // 挪到上部后它不压任何东西，位置也像一条系统通知。
  const by = 240;

  ctx.fillStyle = 'rgba(58,38,24,0.92)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, 32);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill();

  ctx.fillStyle = '#FFF6E9';
  ctx.fillText(toastMsg, DESIGN_W / 2, by + bh / 2);
  ctx.globalAlpha = 1;
}

/**
 * 挑战指纹：同一条分享链接的多个 query 字段里，只有这三项决定"是不是同一次挑战"。
 *
 * 不带 `undos` / `name`：那两项是文案，同一条链接被转发时可能被改，
 * 但玩家点的仍是同一关、同一个对手 —— 不该因此重进关卡。
 */
function challengeSignature(c: ReturnType<typeof parseChallenge>): string {
  if (!c) return '';
  return `${c.token ?? ''}|${c.levelIdx}|${c.fromUid}`;
}

/**
 * 热启动：游戏已经在运行时，玩家点了好友的分享卡片。
 *
 * ## 这条路径以前完全没有
 *
 * 小游戏被分享卡片唤起时**不会重启**，只会触发 `onShow`，
 * 参数在 `res.query` 里。之前 `boot()` 只读 `getLaunchOptionsSync()`
 * ——那是"本次进程第一次启动时"的参数，热启动时它还是老值。
 * 表现：玩家在游戏里点朋友的卡片，界面纹丝不动，什么也没发生。
 *
 * 抖音和微信都是这套行为，两边都靠 `platform.onAppShow` 接。
 */
async function handleHotLaunch(query?: Record<string, string>): Promise<void> {
  if (!booted || !query || !query.l) return;

  const next = parseChallengeFrom(query);
  if (!next) return;

  const sig = challengeSignature(next);
  // 同一条链接重复上报（部分机型切前后台会把 query 再带一遍）只认第一次
  if (sig === hotLaunchKey) return;
  hotLaunchKey = sig;

  // 带 token：以服务端快照为准（与 `boot()` 里那段同一规则，只这一份实现）
  if (next.token) {
    const info = await fetchChallengeInfo(next.token);
    if (info) {
      next.fromName = info.fromName || next.fromName;
      next.fromUid = info.fromUid || next.fromUid;
      next.fromUndos = info.hasScore ? info.fromUndos : null;
    }
  }

  challenge = next;
  challengeResult = null;
  reportEvent('challenge_start', {
    level_idx: next.levelIdx,
    from_uid: next.fromUid || undefined,
    from_server: !!next.token,
    hot: true,
  });
  try {
    await enterLevel(next.levelIdx);
  } catch (e) {
    // 关卡数据异常不该把整个前台事件回调打断（同一条 onShow 还管着 resize / 进度刷新）
    console.error('[hot-launch] 进入挑战关卡失败', e);
    platform.logError?.('hot-launch', e);
  }
}

/**
 * 启动。
 *
 * ## 「没有后端也能玩」
 *
 * 登录 / 配置 / 星级都是**可选**的 —— 拿不到就退到本地默认值，
 * 关卡表本身是内置的（`data/levels-v3-client.json`），
 * 所以断网时游戏依然完整可玩（只是进度不会同步到服务端）。
 *
 * 这对本地开发特别重要：以前必须先起 Go 服务才能看到一关，
 * 现在 `npm run dev` 直接就能玩。
 */
async function boot() {
  tracker.init();
  progress.restore();

  // ── 广告计数：本地 +1，同时上报服务端 ──
  //
  // 挂在 `Ads` 的回调上而不是四个调用点各写一遍：
  // 「看完」有两条路（正常结束 / SDK 挂了兜底发放），两条都该计。
  // 本地先 +1 是为了即时反馈（「我的」页数字立刻变），
  // 服务端回包再以它为准 —— 这样多设备/重装后能收敛到真实值。
  ads.setOnWatched((placement) => {
    progress.sync({ adWatchCnt: (progress.current.adWatchCnt ?? 0) + 1 });
    void reportAdWatch(placement)
      .then((res) => {
        if (typeof res?.adWatchCnt === 'number') progress.sync({ adWatchCnt: res.adWatchCnt });
      })
      .catch(() => { /* 离线时保留本地 +1，下次登录以服务端为准 */ });
  });

  // ── 声音：偏好与音色 ──
  //
  // 必须在 `restore()` 之后：装备的主题存在本地进度里。
  // 这里只「登记」，不发声 —— 真正的 AudioContext 要等第一次用户手势
  // （浏览器自动播放策略），由 `audio.light()` 首次调用时惰性创建。
  profilePage.soundOn = platform.storage.get(KEY_SOUND) !== '1';
  audio.setEnabled(profilePage.soundOn);
  profilePage.vibrateOn = platform.storage.get(KEY_VIBRATE) !== '1';
  audio.setVoice(progress.current.currentTheme);

  // ⓪ 适龄提示（首次启动）
  //
  // 放在最前面：它是提审要求，而且要在玩家看到任何界面之前出现 ——
  // 挂在登录之后的话，登录失败 / 慢网络时它就永远不弹。
  ageGateOpen = platform.storage.get(KEY_AGE_ACK) !== '1';

  // ① 隐私授权（微信合规，必须在拿 openid 之前）
  //
  // `wx.login` 拿 openid 就是「收集个人信息」，所以授权要在它前面。
  // 拒绝时**不拦着玩**：游戏本身不需要身份，本地进度照常存，
  // 只是不同步到服务端（排行榜、好友、跨设备进度都没有）。
  // 拦下来反而更糟 —— 玩家会以为游戏坏了，而且他不会再去点第二次。
  platform.privacy?.installWatcher?.();
  const privacyOK = await ensurePrivacyAuthorized();
  if (!privacyOK) {
    console.warn('[boot] 未获得隐私授权，本次不登录');
    showToast('未同意隐私政策：进度只存在本机', 3000);
  }

  // ② 登录（失败不致命）
  //
  // 没授权就**不发 `wx.login`** —— 那是明确的个人信息收集。
  // 其余流程照走（配置 / 关卡表 / 本地进度），游戏完整可玩。
  if (privacyOK) try {
    const loginRes = await login();
    reportEvent('login_success', { uid: loginRes.uid, is_new: loginRes.maxLevel <= 0 });
    progress.sync({
      // maxLevel = 最高已通关关号。**不要** `|| 1` ——
      // 新用户是 0（没通关过任何一关），`|| 1` 会把它变成 1，
      // 于是 currentLevel 算成 2 —— 新玩家直接被跳过第 1 关。
      maxLevel: loginRes.maxLevel,
      unlockedSkins: loginRes.unlockedSkins,
      unlockedThemes: loginRes.unlockedThemes,
      totalTimeMs: loginRes.totalTimeMs,
      totalSteps: loginRes.totalSteps,
      nickname: loginRes.nickname || '玩家',
      avatar: loginRes.avatar || '',
      uid: loginRes.uid,
      // 两个统计项都以**服务端**为准：
      // - `adWatchCnt` 由 `/api/cover/ad-watch` 累加（离线时本地先 +1）；
      // - `totalRetries` 是 `SUM(level_records.undos)`，客户端不再自己数按钮次数。
      // 老服务端不下发 `totalRetries`（undefined）时 `sync` 会跳过，保留本地值。
      adWatchCnt: loginRes.adWatchCnt,
      totalRetries: loginRes.totalRetries,
    });
    syncSkinsPage();
    // 登录成功后补传缓冲 —— 这批事件（app_start 等）现在能带上 uid 了。
    // 不 flush 的话它们要等到攒满 20 条才发，而登录前那几条
    // 已经是「无 uid 的匿名事件」，白白丢掉按玩家聚合的价值。
    void tracker.flush();
  } catch (e) {
    console.warn('[boot] 登录失败，使用本地进度', e);
  }

  // ② 服务器配置（失败用默认值）
  try {
    // 平台由客户端声明：这个接口不鉴权，登录失败时也没有 token 可用。
    // 服务端按 `?platform=` 下发对应的广告位 / 分享前缀 / 频控。
    config = await fetchConfig(localPlatformCode());
    applyServerConfig(config);
  } catch (e) {
    console.warn('[boot] 配置拉取失败，使用默认配置', e);
  }

  // ③ 关卡表（内置表兜底，一定成功）
  //
  // 用 **cover 表的版本号** —— cover 是现行玩法，它的表才是真正在用的那张。
  // 之前传的是经典表的版本号，改了 cover 表客户端却以为没变，永远不重拉。
  await levels.init(config?.coverLevelVersion ?? config?.levelVersion ?? '');

  // ④ 挑战参数
  challenge = parseChallenge();

  // 带 token 的链接：用服务端记录校正「发起人是谁、当时什么成绩」。
  //
  // ## 为什么以服务端为准
  //
  // 链接里的 `undos` / `name` 只是**文案**，可能被改、也可能是老版本残留。
  // 服务端那条记录是分享那一刻的快照，横幅与结算都该用它。
  //
  // 查不到（token 无效 / 老链接没带 token）就保留链接参数里解析出来的值 ——
  // 挑战照玩，只是判定会走退化路径。
  if (challenge?.token) {
    const info = await fetchChallengeInfo(challenge.token);
    if (info) {
      challenge.fromName = info.fromName || challenge.fromName;
      challenge.fromUid = info.fromUid || challenge.fromUid;
      // fromUndos = -1 是「不带成绩」的哨兵 → 客户端用 null 表示「不知道」
      challenge.fromUndos = info.hasScore ? info.fromUndos : null;
    }
  }

  // 分享挑战 → 直接进关卡；普通启动 → 回大厅
  if (challenge) {
    reportEvent('challenge_start', {
      level_idx: challenge.levelIdx,
      from_uid: challenge.fromUid || undefined,
      from_server: !!challenge.token,
    });
    await enterLevel(challenge.levelIdx);
  } else {
    phase = 'home';
    homePage = {
      ...homePage,
      maxLevel: progress.current.maxLevel,
      currentLevel: progress.currentLevel,
      levelCount: config?.coverLevelCount ?? config?.levelCount ?? levels.total,
      nickname: progress.current.nickname || '玩家',
      avatar: progress.current.avatar || '',
      skinCount: progress.current.unlockedSkins.length,
      totalSkins: SKINS.length,
      starCount: totalStars(),
      totalRetries: progress.current.totalRetries ?? 0,
    };
    // 异步拉星级，不阻塞进大厅
    //
    // 拉的是 **cover 模式**的星级 —— cover 的星级按悔棋次数算，
    // 经典那套（步数比）在 cover 模式下恒为 3 星，没有意义。
    void fetchStars('cover')
      .then((res) => progress.setStars(res.stars))
      .catch(() => { /* 忽略 */ });
  }
  reportEvent('app_start', {});

  // 冷启动收尾：标记完成，并记住本次进入的挑战。
  //
  // 小游戏冷启动会先触发一次 `onShow`（早于 boot 完成，被 `booted` 挡住）；
  // 少数机型还会在 boot 之后再补一次，指纹相同 → `handleHotLaunch` 直接返回，
  // 不会把玩家从刚进的关里再弹一次。
  booted = true;
  hotLaunchKey = challengeSignature(challenge);
}

void boot().catch((e) => {
  // ## 启动流程自己失败时，不能把玩家留在启动页
  //
  // 四个 await 里每一步都各自兜了底，理论上不该走到这里；但「理论上」
  // 已经在渲染循环上失手过一次（见 `frame()` 的注释）。
  // 真出错时至少把玩家放进大厅 —— 关卡表是内置的，离线也能玩。
  console.error('[boot] 启动失败', e);
  platform.logError?.('boot', e);
  booted = true;
  if (phase === 'loading') phase = 'home';
});

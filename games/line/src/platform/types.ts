/**
 * 保存到相册的结果。
 *
 * 分成四种而不是 boolean：「授权被拒」和「这端不支持」给玩家的
 * 下一步完全不同 —— 前者要引导去设置里开权限。
 */
export type SaveImageResult = 'saved' | 'denied' | 'unsupported' | 'failed';

/**
 * 能被保存的画布（最小结构）。
 *
 * 离屏画布（微信 `wx.createOffscreenCanvas`）不是 DOM 的 `HTMLCanvasElement`，
 * 但 `canvasToTempFilePath` 只认画布本身 —— 所以这里收最小结构，
 * 不让调用方去做三百个成员的断言。
 */
export interface SaveableCanvas {
  width: number;
  height: number;
}

/** 平台适配层接口。Web 与微信各自实现一份。 */
export interface Platform {
  readonly name: 'web' | 'wechat' | 'douyin';
  /** 取登录凭证。Web 端返回 mock。 */
  login(): Promise<{ code: string }>;
  /**
   * 本次启动附带的参数（`?l=27&undos=0` 那一串）。
   *
   * ## 为什么收在平台层
   *
   * 三个来源完全不同：微信 `wx.getLaunchOptionsSync().query`、
   * 抖音 `tt.getLaunchOptionsSync().query`、Web `location.search`。
   * 以前这段 if/else 写在 `game/challenge.ts` 里，结果漏了抖音 ——
   * 抖音没有 `location`，于是**分享链接在抖音端全部失效**（不报错）。
   *
   * 拿不到时返回空对象（老基础库 / 非启动上下文）。
   */
  launchQuery?(): Record<string, string>;
  /** 发起网络请求。 */
  request<T>(url: string, method: 'GET' | 'POST', data?: unknown, header?: Record<string, string>): Promise<T>;
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
  ad: {
    /** 展示激励视频。resolve(true) 表示完整看完。 */
    showRewarded(placement: string): Promise<boolean>;
    showInterstitial(placement: string): Promise<void>;
    showBanner(): void;
    hideBanner(): void;
  };
  /**
   * 分享。
   *
   * `opts.channel` 决定走哪条通道：
   *
   * - `friend`（默认）—— 主动指派：微信 `wx.shareAppMessage` 直接拉起
   *   通讯录选择面板，卡片文案与 `query` 全由我们定。**这是唯一能
   *   定制分享内容的通道。**
   * - `timeline` —— 朋友圈。微信从 2022 年（基础库 ≥ 2.25）起**下线了
   *   朋友圈分享的自定义能力**：标题、图片、query 全部被忽略，强制用
   *   小游戏后台配置的昵称 + 图标。所以这条通道实际做的是「打开右上角
   *   菜单，让玩家自己点『分享到朋友圈』」—— 我们只能把按钮放出，
   *   内容改不了。这不是实现偷懒，是平台的能力边界。
   *
   * 两个通道返回 `ShareResult`，调用方据此决定给什么反馈
   * （`timeline` 在微信端永远是 `menu`，因为真正的分享发生在系统菜单里）。
   */
  share(opts: ShareOptions): Promise<ShareResult>;
  /**
   * 召唤短振动反馈。
   *
   * `pattern` 与 Web 的 `navigator.vibrate` 同一套语义：数字 = 振多少毫秒，
   * 数组 = 振/停交替（`[10,25,10,25,18]` 是四下短震夹三段停）。
   * 主题的设计稿给每件事都定了时长（落子 8 / 连径 15 / 铺满那个数组 /
   * 盖印 40 / 按钮 5）—— 手感是**节奏**，统一成"震一下"就等于没有节奏。
   */
  vibrate(pattern?: number | number[]): void;
  /** 获取主画布。 */
  getCanvas(): { canvas: HTMLCanvasElement; width: number; height: number; dpr: number };
  /**
   * 重新测量画布尺寸（resize / 切后台回前台时调用）。
   *
   * ## 为什么必须有
   *
   * 画布尺寸只在启动时读一次。手机端地址栏收缩、横竖屏切换、
   * 窗口缩放之后，画布的 CSS 尺寸变了但**记录下来的 width/height/dpr
   * 还是旧的** —— 渲染被拉伸，而 `toDesign` 仍按旧尺寸反解，
   * 于是**点击位置整体偏移**（和历史上修过的 125px 偏移同类问题）。
   *
   * 微信端同样有这个问题（`wx.onWindowResize`）。
   */
  resizeCanvas?(): { canvas: HTMLCanvasElement; width: number; height: number; dpr: number };
  /**
   * 订阅尺寸变化。返回取消订阅函数（可选）。
   *
   * 回调里应当调用 `resizeCanvas()` 重新测量，然后重建视口。
   */
  onResize?(cb: () => void): () => void;
  /**
   * 绑定屏幕触摸（小游戏没有 DOM，坐标是逻辑像素）。
   *
   * ## 为什么必须走平台层
   *
   * 调用方直接读 `wx.onTouchStart` 的写法，在抖音包里**一个事件都收不到**
   * —— 抖音只有 `tt`，没有 `wx`。表现是「微信能玩、抖音进得去点不动」，
   * 且不报任何错，因为 `wx?.onTouchStart?.()` 静默短路了。
   */
  onTouch?(bind: PlatformTouch): void;
  /** 切到后台（补传埋点、放弃进行中的一手）。 */
  onAppHide?(cb: () => void): void;
  /**
   * 回到前台。`query` 是本次唤起附带的启动参数。
   *
   * ## 为什么必须收这个 query
   *
   * 玩家在游戏里点好友的分享卡片时，小游戏**不会重启**，只触发 onShow，
   * 参数在回调的 `res.query` 里 —— 不在 `getLaunchOptionsSync()`。
   * 不接它，表现是「点了分享卡片，游戏还停在原来的界面」。
   */
  onAppShow?(cb: (query?: Record<string, string>) => void): void;
  /**
   * 写入一条错误日志（平台实时日志）。
   *
   * 小游戏在玩家手机上崩了，我们没有控制台。微信/抖音的实时日志
   * 能在后台查到最近若干天的 `error` 记录 —— 这是线上唯一的定位手段。
   * 平台没有这个能力时**静默跳过**，不影响游戏。
   */
  logError?(tag: string, detail: unknown): void;
  /**
   * 挂全局未捕获异常钩子（`onError` / `onUnhandledRejection`）。
   *
   * ## 为什么是方法而不是模块顶层执行
   *
   * 写在模块顶层的 `if (typeof wx !== 'undefined') {...}` 是**副作用**，
   * bundler 不敢摇掉它 —— 结果微信包里会混进 `tt.onError` 的代码，
   * 抖音包里混进 `wx.onError`。虽然被 `typeof` 挡住不会执行，
   * 但「微信包里 `tt.` 必须为 0」这条纪律就破了，而且以后很难发现
   * 到底哪个平台的文件在偷偷进包。
   *
   * 收成方法后由 `platform/index.ts` 在选定平台后调一次，未选中的
   * 平台实现整块被摇掉。
   */
  installErrorReporting?(): void;
  /**
   * 弹系统键盘输入一段文字（小游戏没有 `<input>`）。
   *
   * ## 为什么不能自己画一个输入框
   *
   * Canvas 画得出方框和光标，但**画不出输入法** —— 中文输入要候选词、
   * 要拼音组合，这些只有系统键盘能做。自己画的结果是玩家只能打英文。
   *
   * 所以文字输入一律走平台键盘：微信 `wx.showKeyboard`、抖音 `tt.showKeyboard`
   * （同形同参）。回车确认后 `hideKeyboard` 并回传文本。
   *
   * 拿不到能力时返回 `unsupported` —— 调用方据此隐藏输入入口，
   * **不要**退化成"自己画一个"，那会产出一个只能打英文的假输入框。
   */
  inputText?(opts: {
    /** 输入框初始内容 */
    defaultValue?: string;
    /** 键盘右下角按钮文案（最多 4 字） */
    confirmText?: string;
    /** 最多几个字 */
    maxLength?: number;
    /** 提示语（多行） */
    placeholder?: string;
  }): Promise<KeyboardResult>;
  /**
   * 从相册选一张图。
   *
   * 微信 `wx.chooseMedia`（2.10.0+，旧的 `chooseImage` 已废弃但仍在），
   * 抖音 `tt.chooseImage`。**没有相册权限时会失败**，那是正常的用户选择，
   * 不当作错误。
   */
  pickImage?(): Promise<PickImageResult>;
  /** 开放数据域是否可用（微信端）。 */
  readonly openDataAvailable: boolean;
  /**
   * 该平台支持的分享通道。
   *
   * ## 为什么是「查询能力」而不是「假设能力」
   *
   * 两平台的分享差异很大：
   *   - 微信：好友 + 朋友圈（且朋友圈自 2022 起不可定制内容）
   *   - 抖音：好友 + 分享到抖音，**没有朋友圈**
   *
   * 如果 UI 写死「好友 / 朋友圈 / 复制链接 / 保存海报」四格，
   * 那抖音端就会画出两个点不动的按钮 —— 玩家会以为坏了。
   *
   * 所以分享面板只渲染平台报上来的通道。
   * 代价是面板布局要能吃 2~4 格（用等分槽位，见 ui/sharePanel.ts）。
   */
  readonly shareChannels: readonly ShareChannel[];
  /**
   * 隐私授权（微信合规，2023 起强制）。
   *
   * 微信要求小游戏声明隐私保护指引，并在**首次触发个人信息收集**
   * （`wx.login` 拿 openid 就算）之前取得用户同意。
   * 平台不支持这套 API 时为 `undefined`，调用方直接放行 ——
   * 宁可在不支持的端上不弹，也不能把玩家拦在启动页。
   */
  readonly privacy?: PlatformPrivacy;
  /**
   * 拉取用户的昵称 / 头像（需要用户手势触发）。
   *
   * 微信的 `getUserProfile` 会弹授权框，所以**不能在启动时悄悄调** ——
   * 只能由「我的 → 完善资料」这样一个显式动作发起。
   * 拿不到（用户拒绝 / 平台不支持 / 老基础库）返回 `null`，
   * 调用方保持首字圆球，不要因此报错。
   */
  readonly profile?: PlatformProfile;
  /** 剪贴板（复制分享链接）。没有它时调用方如实说「这端不支持」。 */
  readonly clipboard?: PlatformClipboard;
  /**
   * 把画布内容存进相册。
   *
   * ## 为什么需要它
   *
   * 海报是 **canvas 渲染**的，不是 `<img>` —— 所以「长按保存」这条路
   * 在小游戏端根本不存在（canvas 的像素不是 DOM 节点，没有长按菜单）。
   * 原来那句「请长按海报保存到相册」是**假承诺**：玩家按半天什么也没有。
   *
   * 小游戏端要保存必须走两步：
   *   1. `wx.canvasToTempFilePath` 把画布导出成临时文件
   *   2. `wx.saveImageToPhotosAlbum` 存进相册（需要用户授权）
   *
   * Web 端则是 `<a download>`（`toDataURL` + 触发下载）。
   *
   * ## 为什么返回「四种结果」而不是 boolean
   *
   * 「授权被拒」和「这个平台不支持」给玩家的下一步完全不同：
   * 前者要引导去设置里开权限，后者只能如实告知。
   * 压成 boolean 就只能给一句「保存失败，请重试」—— 玩家不知道该做什么，
   * 只会以为游戏坏了。
   *
   * @param canvas 要保存的画布（离屏画布也行）
   * @returns 存好了 / 用户拒绝授权 / 这端不支持 / 别的原因失败
   */
  saveImage?(canvas: SaveableCanvas): Promise<SaveImageResult>;
  /**
   * 把画布导出成一个**临时文件路径**。
   *
   * ## 为什么分享卡片图需要它
   *
   * 微信的 `wx.shareAppMessage({ imageUrl })` 要的是**本地文件路径**
   * （`wxfile://tmp/...`），不是 dataURL —— 传 dataURL 会被忽略，
   * 卡片就退回默认图。
   *
   * 所以出完 5:4 卡图还要「导出成文件」这一步。
   *
   * Web 端没有这个概念 —— 直接用 `toDataURL()` 就行，所以返回空串。
   *
   * @returns 临时文件路径；不支持 / 失败返回空串
   */
  exportCanvas?(canvas: SaveableCanvas): Promise<string>;
}

/** 隐私授权的平台能力。 */
export interface PlatformPrivacy {
  /**
   * 确保已获得隐私授权。
   *
   * @returns `true` = 已授权或该端不需要授权（放行）；`false` = 玩家明确拒绝
   */
  ensureAuthorized(): Promise<boolean>;
  /** 打开隐私协议原文（微信「隐私保护指引」）。 */
  openContract?(): void;
  /**
   * 注册「某个接口需要隐私授权」的监听（可选）。
   *
   * 微信的相册 / 剪贴板等接口在用户未同意隐私协议时会走
   * `wx.onNeedPrivacyAuthorization`，不注册监听的话那些接口会直接失败。
   * 挂在平台对象上而不是让 `main.ts` 直接 import 微信实现 ——
   * 后者会把整套 `wx.*` 带进抖音包里。
   */
  installWatcher?(): void;
}

/** 昵称 / 头像的平台能力。 */
export interface PlatformProfile {
  /** 拉起授权并返回资料；用户拒绝 / 不支持时返回 `null`。 */
  request(): Promise<{ nickname: string; avatar: string } | null>;
}

/**
 * 剪贴板能力。
 *
 * ## 为什么不能直接调 `navigator.clipboard`
 *
 * 小游戏端**没有 `navigator`**（那是浏览器对象）。`navigator.clipboard.writeText`
 * 在微信 / 抖音里会抛 `ReferenceError`，被 `try/catch` 兜住后
 * 落到「复制没成功，长按上面的链接试试」——
 * 而屏幕上根本没有可长按的链接文本，这是又一句假承诺。
 *
 * 两端各自有 `wx.setClipboardData` / `tt.setClipboardData`，
 * 但**必须在用户点击的调用栈里**调（小游戏要求用户手势），
 * 所以这里是 Promise 化的薄封装，不做延时重试。
 */
export interface PlatformClipboard {
  /**
   * 写一段文本到剪贴板。
   *
   * @returns `true` = 复制成功；`false` = 这端不支持 / 被系统拒绝
   */
  set(text: string): Promise<boolean>;
}

/** 分享通道。 */
export type ShareChannel = 'friend' | 'timeline' | 'douyin';

/**
 * 键盘输入结果。
 *
 * - `ok` —— 玩家点了「完成」，`text` 是他输入的内容（可能是空串）
 * - `cancel` —— 玩家点了「取消」或点掉了
 * - `unsupported` —— 这端没有键盘能力（老基础库 / Web）
 */
export type KeyboardResult =
  | { kind: 'ok'; text: string }
  | { kind: 'cancel' }
  | { kind: 'unsupported' };

/** 相册选图结果。 */
export type PickImageResult =
  | { kind: 'ok'; path: string }
  | { kind: 'cancel' }
  | { kind: 'unsupported' };

/**
 * 屏幕触摸回调集合。
 *
 * 坐标是**逻辑像素**（微信/抖音的 `e.touches[i].clientX` 原生值），
 * 与 `getCanvas()` 返回的 `width` / `height` 同一坐标系。
 */
export interface PlatformTouch {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(): void;
  /** 系统打断（来电、下拉通知栏）。按取消处理，不能当成"松手"。 */
  cancel(): void;
}

/** 分享参数。 */
export interface ShareOptions {
  /** 卡片标题。`timeline` 通道下微信会忽略它。 */
  title: string;
  /**
   * 卡片配图。
   *
   * 微信卡片的最佳显示比例是 **5:4**（500×400 / 1080×864），
   * 别的比例会被裁。所以海报（9:16）不能直接当 `imageUrl` 用 ——
   * 真实接入时要另出一张 5:4 的卡片图。
   */
  imageUrl?: string;
  /** 启动参数，形如 `l=47&undos=0`。 */
  query?: string;
  /** 通道，默认 `friend`。 */
  channel?: ShareChannel;
}

/**
 * 分享结果。
 *
 * - `sent` —— 微信好友通道：面板已拉起（微信**不告诉我们用户有没有真发**，
 *   这是平台限制，不能当成"分享成功"上报）。
 * - `menu` —— 朋友圈通道：已把右上角菜单的「分享到朋友圈」放出来，
 *   真正的分享要玩家自己去点。文案里必须说清这件事，不能假装分享了。
 * - `copied` —— Web 端：链接已进剪贴板。
 * - `failed` —— 失败了（无剪贴板权限 / 用户取消系统分享面板等）。
 */
export type ShareResult = 'sent' | 'menu' | 'copied' | 'failed';

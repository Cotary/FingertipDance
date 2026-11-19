/** 平台适配层接口。Web 与微信各自实现一份。 */
export interface Platform {
  readonly name: 'web' | 'wechat';
  /** 取登录凭证。Web 端返回 mock。 */
  login(): Promise<{ code: string }>;
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
  /** 开放数据域是否可用（微信端）。 */
  readonly openDataAvailable: boolean;
}

/** 分享通道。 */
export type ShareChannel = 'friend' | 'timeline';

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

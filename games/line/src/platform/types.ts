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
  share(opts: { title: string; imageUrl?: string; query?: string }): Promise<void>;
  /**
   * 短振动反馈。
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

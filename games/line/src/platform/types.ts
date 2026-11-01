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
  /** 短振动反馈。 */
  vibrate(): void;
  /** 获取主画布。 */
  getCanvas(): { canvas: HTMLCanvasElement; width: number; height: number; dpr: number };
  /** 开放数据域是否可用（微信端）。 */
  readonly openDataAvailable: boolean;
}

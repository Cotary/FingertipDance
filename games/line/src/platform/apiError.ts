/**
 * 服务端业务错误。
 *
 * ## 为什么需要一个带 `code` 的错误类型
 *
 * 平台层的 `request` 在服务端返回非 0 时抛的是 `new Error("4008: 路径非法")` ——
 * **只有一个字符串**，调用方没法判断这是「服务器说你的数据不合法」还是
 * 「网络断了」。
 *
 * 后果很具体：`onWin` 里 catch 到任何异常都会走「乐观更新本地进度」，
 * 于是**服务端判定路径非法时，客户端照样把这一关记成已通关**。
 * 校验形同虚设。
 *
 * 现在两个平台都抛 `ApiError`（带 `code`），调用方可以：
 *
 * ```ts
 * catch (e) {
 *   if (e instanceof ApiError && e.isRejection) {
 *     // 服务端明确拒绝 → 不能乐观放行
 *   } else {
 *     // 网络问题 → 可以乐观放行，等下次同步
 *   }
 * }
 * ```
 */

/** 服务端错误码（与 `server/internal/core/resp.go` **逐值对应**）。 */
export const ApiCode = {
  OK: 0,
  BadRequest: 4000,
  Unauthorized: 4001,
  RateLimit: 4002,
  Forbidden: 4003,
  LevelNotFound: 4004,
  /** 步数低于理论值 */
  StepsTooLow: 4005,
  /** 用时异常（快得不可能） */
  TimeInvalid: 4006,
  SkipLimit: 4007,
  /** 路径非法：没铺满 / 走法不合法 / 起终点不对 */
  PathIllegal: 4008,
  Internal: 5000,
} as const;

/**
 * 服务端返回的业务错误。
 *
 * `isRejection` = 服务端**明确拒绝了这次请求**（数据不合法），
 * 区别于网络故障 / 超时 —— 前者不该被「乐观放行」兜住。
 */
export class ApiError extends Error {
  readonly code: number;

  constructor(code: number, msg: string) {
    super(`${code}: ${msg}`);
    this.name = 'ApiError';
    this.code = code;
  }

  /** 服务端明确拒绝（数据不合法），不是网络问题。 */
  get isRejection(): boolean {
    return (
      this.code === ApiCode.PathIllegal ||
      this.code === ApiCode.StepsTooLow ||
      this.code === ApiCode.TimeInvalid ||
      this.code === ApiCode.BadRequest ||
      this.code === ApiCode.LevelNotFound
    );
  }
}

import { platform } from '../platform';

/** 挑战上下文。 */
export interface Challenge {
  /** 被挑战的关号 */
  levelIdx: number;
  /** 挑战者的 uid */
  fromUid: number;
  /** 挑战者的昵称 */
  fromName: string;
  /**
   * 挑战者的**重来次数**（若已知）。
   *
   * cover 模式的对比维度是重来次数，不是步数 ——
   * 步数恒为 `required − 1`，拿来比没有意义。
   *
   * **null 表示「链接里没带」** —— 不能用 0 代替：
   * 0 次重来是**最好的成绩**（三星），和「不知道」完全是两回事。
   * 用 0 当哨兵的话，好友 0 次的成绩会被当成缺失，输赢判反。
   */
  fromUndos: number | null;
  /**
   * 服务端挑战 token（`?c=`）。
   *
   * ## 它是胜负的**唯一**凭据
   *
   * `fromUndos` 只用来显示（横幅写「他重来 0 次」），
   * 真正的判定发生在服务端：结算时把这个 token 一起上送，
   * 服务端按 token 取出对手成绩来判输赢。
   *
   * 没有 token 的老链接仍然能玩（`fromUndos` 还在），
   * 但胜负会退回「跟自己的历史最佳比」—— 这是之前的退化行为，
   * 比读一个可篡改的 URL 参数强。
   */
  token: string | null;
}

/**
 * 从启动参数解析挑战信息。
 *
 * 参数来源由平台层负责（微信 / 抖音 `getLaunchOptionsSync`、Web `location.search`），
 * 这里不再判断命名空间 —— 之前那段 if/else 漏了抖音，导致抖音端分享链接全失效。
 */
export function parseChallenge(): Challenge | null {
  return parseChallengeFrom(platform.launchQuery?.() ?? undefined);
}

/**
 * 从一份 query 解析挑战。
 *
 * 拆出来是为了**热启动**：玩家在游戏里点好友的分享卡片时，
 * 小游戏不重启，参数在 `onShow(res).query` 里而不是
 * `getLaunchOptionsSync()` 里。两处必须用同一套解析，不能各写一份。
 */
export function parseChallengeFrom(query: Record<string, string> | undefined | null): Challenge | null {
  if (!query) return null;

  const lvl = query.l;
  if (!lvl) return null;
  const levelIdx = parseInt(lvl, 10);
  if (!Number.isFinite(levelIdx) || levelIdx < 1) return null;

  // 重来次数：区分「没带」与「带了 0」。
  // 0 次重来是最好的成绩（三星），不能和「不知道」混为一谈。
  const rawUndos = query.undos;
  const parsedUndos = rawUndos === undefined ? NaN : parseInt(rawUndos, 10);
  const fromUndos = Number.isFinite(parsedUndos) && parsedUndos >= 0 ? parsedUndos : null;

  return {
    levelIdx,
    fromUid: parseInt(query.uid ?? '0', 10) || 0,
    fromName: query.name ? decodeURIComponent(query.name) : '好友',
    fromUndos,
    // 服务端挑战 token。形状校验不在这里做 ——
    // 服务端对非法形状会直接返回「挑战不存在」，客户端不必重复实现一份。
    token: query.c && query.c.length > 0 ? query.c : null,
  };
}

/**
 * 构造分享 query。
 *
 * 分享的是**重来次数** —— cover 模式比的是这个，不是步数。
 *
 * ## 旧链接兼容
 *
 * 老版本分享出去的是 `steps=N`。那些链接还在别人手机上，
 * `parseChallenge` 读不到 `undos` → 解析成 `null`（= 不知道），
 * 比较时退回「跟自己的历史最佳比」。
 *
 * 这里**故意不做** `steps → undos` 的换算：
 * 步数恒为 `required − 1`，和重来次数没有数学关系，
 * 硬换算出来的数字是编的 —— 显示「最佳 0 次」只是信息缺失，
 * 显示「最佳 3 次」却是**假信息**。宁可少说，不可说错。
 *
 * ## 为什么带 uid / name
 *
 * 挑战结算页要显示「XX 的挑战」并跟**他**比。
 * 不带这两个字段的话，链接里只有关号和分数，
 * 好友打开看到的是「好友的挑战」—— 没有名字，也没有 uid。
 */
export function buildShareQuery(challenge: {
  levelIdx: number;
  undos?: number;
  uid?: number;
  name?: string;
  /**
   * 服务端挑战 token。
   *
   * ## 为什么要有它
   *
   * `undos` 是给**显示**用的（横幅写「他重来 0 次」），
   * 但**胜负不能靠它判** —— 链接参数谁都能改。
   * 真正的对手成绩由服务端按 token 取（见 `/api/cover/challenge`）。
   *
   * 所以带上 token 之后，`undos` 只是文案，判定走 token。
   */
  token?: string;
}): string {
  const parts = [`l=${challenge.levelIdx}`];
  // 0 次重来必须带上 —— 那是最好的成绩（三星）。
  // 早前的写法是 `if (challenge.steps)`，0 会被当成「没有」丢掉。
  if (challenge.undos !== undefined) parts.push(`undos=${challenge.undos}`);
  if (challenge.token) parts.push(`c=${challenge.token}`);
  if (challenge.uid) parts.push(`uid=${challenge.uid}`);
  if (challenge.name) parts.push(`name=${encodeURIComponent(challenge.name)}`);
  return parts.join('&');
}

/**
 * 解析分享链接的基址。
 *
 * ## 为什么单独抽出来
 *
 * 小游戏端**没有 `location`**（`wx` / `tt` 容器里是 undefined）。
 * 直接读 `location.origin` 会抛 `Cannot read properties of undefined` ——
 * 这是之前审计出的崩溃点之一，而它只会在「复制链接」这条路上触发，
 * 平时玩不出来。
 *
 * 优先级：
 *   1. Web 端用当前页面地址 —— 本地调试复制出来的链接要能直接打开
 *   2. 服务端下发的 `shareUrlPrefix` —— 小游戏端的唯一真源
 *   3. `location` 存在时的地址（老服务端不下发前缀时的兜底）
 *
 * 返回空串表示「拼不出链接」，由调用方提示配置缺失 ——
 * 拼一个 `?l=47` 发出去，好友点开只会看到首页。
 *
 * 纯函数（location 由调用方传入），不依赖运行环境，便于单测。
 */
export function resolveShareBase(opts: {
  isWeb: boolean;
  shareUrlPrefix?: string;
  location?: { origin?: string; pathname?: string };
}): string {
  const loc = opts.location;
  const local = loc?.origin ? `${loc.origin}${loc.pathname ?? '/'}` : '';
  if (opts.isWeb && local) return local;
  const prefix = (opts.shareUrlPrefix ?? '').trim().replace(/[?&]+$/, '');
  if (prefix) return prefix;
  return local;
}

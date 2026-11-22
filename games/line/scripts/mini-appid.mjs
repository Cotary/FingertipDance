/**
 * 小游戏工程 `appid` 的解析（纯函数，可被单测直接调用）。
 *
 * ## 为什么要有这个文件
 *
 * `project.config.json` 里的 `appid` 决定这个包**能不能上传提审**：
 * 微信的 `touristappid` / 抖音的 `tt0000000000000000` 是**游客占位**，
 * 开发者工具里能预览，但上传会被拒。模板里一直写着占位值，
 * 于是很容易出现「提审时才发现包里是游客 id」。
 *
 * 更麻烦的是两个脚本行为不一致：
 *
 * - `copy-dy-assets.mjs` **每次构建都重写** `project.config.json` ——
 *   运营手改的 appid 会在下一次 `build:douyin` 时被悄悄改回占位值。
 * - `copy-wx-assets.mjs` 完全不碰这个文件 —— 手改有效，
 *   但换机器 / 换人时没人知道要改。
 *
 * 所以统一成一条规则：
 *
 *   1. 环境变量 `WX_APPID` / `DY_APPID` 优先（CI / 打包机用这条）；
 *   2. 否则**保留文件里已有的真实 appid**（运营手改过就一直是它）；
 *   3. 都没有 → 写占位值，并在构建结束时打一条醒目警告。
 *
 * 占位值**不会**让构建失败：本地开发（游客模式预览）是合法用法，
 * 出错也要等到上传才知道 —— 那时提示已经给了。
 */

/** 微信 AppID 形如 `wx1234567890abcdef`（wx + 16 位十六进制）。 */
const WX_APPID_RE = /^wx[0-9a-fA-F]{16}$/;

/** 抖音 AppID 形如 `tt1234567890abcdef`（tt + 16 位十六进制）。 */
const TT_APPID_RE = /^tt[0-9a-fA-F]{16}$/;

/** 两端各自的占位值。 */
export const PLACEHOLDER_APPID = {
  wx: 'touristappid',
  douyin: 'tt0000000000000000',
};

/** 判断某个 appid 是不是「游客占位」（不能上传提审）。 */
export function isPlaceholderAppId(target, appid) {
  if (!appid) return true;
  // 两端的占位值**互认**：微信的 `touristappid` 出现在抖音工程里
  // 同样说明「还没配」—— 只按本平台占位值判断会把它当成合法值放过去，
  // 而它其实也过不了格式校验，两头不一致更难查。
  return appid === PLACEHOLDER_APPID[target] || Object.values(PLACEHOLDER_APPID).includes(appid);
}

/**
 * 校验 appid 的格式。
 *
 * @returns 空串 = 合法；非空 = 错误说明
 */
export function validateAppId(target, appid) {
  const re = target === 'wx' ? WX_APPID_RE : TT_APPID_RE;
  if (!re.test(appid)) {
    const sample = target === 'wx' ? 'wx1234567890abcdef' : 'tt1234567890abcdef';
    const env = target === 'wx' ? 'WX_APPID' : 'DY_APPID';
    return `${env} 格式不对（当前 = ${JSON.stringify(appid)}，形如 ${sample}）`;
  }
  return '';
}

/**
 * 解析最终要写进 `project.config.json` 的 appid。
 *
 * @param target     `'wx'` / `'douyin'`
 * @param envAppId   环境变量（未设为 undefined / 空串）
 * @param existing   文件里现有的 appid（没有文件时 undefined）
 * @returns `{ appid, warning }` —— `warning` 非空时应打印，但**不阻断构建**
 */
export function resolveAppId(target, envAppId, existing) {
  const env = (envAppId ?? '').trim();
  const cur = (existing ?? '').trim();
  const envName = target === 'wx' ? 'WX_APPID' : 'DY_APPID';

  // ① 环境变量优先，但格式必须对 —— 写错了要立刻说，
  //    否则会带着一个畸形 appid 构建成功、上传时才报「appid 不合法」。
  if (env) {
    const err = validateAppId(target, env);
    if (err) return { appid: PLACEHOLDER_APPID[target], warning: err };
    return { appid: env, warning: '' };
  }

  // ② 文件里已有真实 appid：保留（运营手改过的那一份）
  if (cur && !isPlaceholderAppId(target, cur)) {
    const err = validateAppId(target, cur);
    if (err) {
      return {
        appid: PLACEHOLDER_APPID[target],
        warning: `project.config.json 里的 appid 格式不对（${err}），已退回占位值`,
      };
    }
    return { appid: cur, warning: '' };
  }

  // ③ 都没有 → 占位值 + 警告
  return {
    appid: PLACEHOLDER_APPID[target],
    warning:
      `${target === 'wx' ? '微信' : '抖音'}包仍是游客 appid（${PLACEHOLDER_APPID[target]}）：` +
      `开发者工具能预览，但**上传/提审会被拒**。` +
      `设 ${envName}=<真实 appid> 重新构建，或直接改 ` +
      `${target === 'wx' ? 'line-wx' : 'line-dy'}/project.config.json 后不要再跑构建脚本覆盖它。`,
  };
}

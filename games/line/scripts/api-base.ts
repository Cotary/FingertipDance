/**
 * 构建期后端地址的解析与校验。
 *
 * ## 为什么要有这个文件
 *
 * 以前 `vite.config.ts` 里是一行：
 *
 * ```ts
 * const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:50001';
 * ```
 *
 * 本地开发完全正常。但 `build:wx` / `build:douyin` **没设环境变量时，
 * 产出的包里就带着 `http://127.0.0.1:50001`**。
 *
 * 后果在小游戏端是**彻底静默**的：线上包一启动就去连玩家自己手机的
 * `127.0.0.1`（那台手机上什么都没有）→ 登录失败、进度不同步、
 * 排行榜空白。而 `boot()` 里那些 `try/catch` 会把失败全兜住，
 * **日志里一句报错都没有**，画面还照常显示 —— 玩家看到的是一个
 * 「能玩但不联网」的游戏，运营看到的是「怎么没有数据」。
 *
 * 这类问题排查一次要半天，而根因只是构建命令少传了一个环境变量。
 *
 * ## 现在的规则
 *
 * - **小游戏构建**（wx / douyin）：`API_BASE` 必须显式给，且不能是
 *   localhost / 127.0.0.1 / 0.0.0.0 —— 否则**构建直接失败**。
 * - **Web 构建**：仍然默认 `http://127.0.0.1:50001`（本地开发要的就是这个），
 *   但如果显式给了 `localhost` 之外的地址，也照常使用。
 */

/** 小游戏构建里**不允许**出现的后端地址。 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

/** 本地开发默认后端。 */
export const LOCAL_API_BASE = 'http://127.0.0.1:50001';

/** 构建目标。 */
export type BuildTarget = 'web' | 'wx' | 'douyin';

/** 解析结果。 */
export interface ResolvedApiBase {
  /** 最终注入包里的地址。空串 = 构建失败。 */
  base: string;
  /** 非空 = 构建期错误信息（构建应当失败）。 */
  error: string;
}

/**
 * 判断一个地址是不是「环回地址」。
 *
 * 用 URL 解析而不是字符串匹配：`https://127.0.0.1:8443` 里主机名
 * 就是 `127.0.0.1`，而 `https://localhost.evil.com` 的主机名不是。
 *
 * 解析失败（不是合法 URL）时返回 false —— 那不是环回地址的问题，
 * 由别处的校验去管。
 */
export function isLoopback(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.includes(host);
}

/**
 * 解析构建期的后端地址。
 *
 * @param target  构建目标
 * @param envApi  环境变量 `API_BASE`（未设则空串）
 */
export function resolveApiBase(target: BuildTarget, envApi?: string): ResolvedApiBase {
  const raw = (envApi ?? '').trim();

  // ── 小游戏：必须有真实地址 ──
  if (target !== 'web') {
    const label = target === 'wx' ? 'build:wx' : 'build:douyin';

    if (!raw) {
      return {
        base: '',
        error:
          `${label} 必须设置 API_BASE 环境变量（例：API_BASE=https://api.example.com ${label}）。\n` +
          `没有它产出的包会指向 127.0.0.1:50001 —— 线上连的是玩家自己手机的环回地址，` +
          `登录会静默失败、进度不同步、排行榜空白，且日志里没有任何报错。`,
      };
    }

    if (isLoopback(raw)) {
      return {
        base: '',
        error:
          `${label} 的 API_BASE 不能是环回地址（当前 = ${raw}）。\n` +
          `线上包连的是玩家自己手机上的 ${raw}，必然连不上。` +
          `本机调试请用 npm run dev（web），或把 API_BASE 指向一台真机可达的地址。`,
      };
    }

    if (!/^https?:\/\//i.test(raw)) {
      return {
        base: '',
        error: `${label} 的 API_BASE 必须带 http:// 或 https:// 前缀（当前 = ${raw}）。`,
      };
    }

    // 去掉尾部斜杠：`https://api.example.com/` + `/api/login` 会拼出 `//api/login`
    return { base: raw.replace(/\/+$/, ''), error: '' };
  }

  // ── Web：默认本机，可被环境变量覆盖 ──
  if (!raw) return { base: LOCAL_API_BASE, error: '' };
  if (!/^https?:\/\//i.test(raw)) {
    return { base: '', error: `API_BASE 必须带 http:// 或 https:// 前缀（当前 = ${raw}）。` };
  }
  return { base: raw.replace(/\/+$/, ''), error: '' };
}

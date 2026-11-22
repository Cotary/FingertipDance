/**
 * 把任意异常对象压成一行可上报的文本。
 *
 * ## 为什么不直接 `String(detail)`
 *
 * `String(new Error('x'))` 只留 `"Error: x"`，**栈全丢了** ——
 * 而线上定位 90% 靠栈。实时日志有单条长度限制，所以截断到 2000 字符：
 * 足够装下一条完整栈，又不至于因为超长被整条丢弃。
 */
export function stringifyDetail(detail: unknown, limit = 2000): string {
  let text: string;
  if (detail instanceof Error) {
    text = `${detail.name}: ${detail.message}\n${detail.stack ?? ''}`;
  } else if (typeof detail === 'string') {
    text = detail;
  } else {
    try {
      text = JSON.stringify(detail);
    } catch {
      // 循环引用 / BigInt 之类 —— `String()` 也可能抛（自定义 toString），再兜一层
      try { text = String(detail); } catch { text = '[unserializable]'; }
    }
  }
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

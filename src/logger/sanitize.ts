import { inspect } from 'node:util';

/**
 * 请求体日志的脱敏与截断工具，仅在 `LOG_BODY=true` 时调用。
 *
 * 原则：宁可过度脱敏，字段名命中敏感词就整值替换，不做内容嗅探。
 */

/** 命中即整值替换为 `***`（camelCase 也能匹配，如 accessToken / apiKey） */
const SENSITIVE_KEY =
  /password|passwd|pwd|secret|token|authorization|cookie|credential|api[_-]?key|private[_-]?key|session|csrf/i;

const MASK = '***';

/** 各项上限：分别挡住深层递归、超长字符串、超大数组/对象，以及整行总长 */
const MAX_DEPTH = 6;
const MAX_STRING = 200;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;
const MAX_TOTAL = 2000;

/** 请求体是否"有内容"：空对象 / 空数组 / 空白字符串 / null 都算没有 */
export function hasMeaningfulBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  if (typeof body === 'string') return body.trim().length > 0;
  if (typeof body === 'object') return Object.keys(body).length > 0;
  return true;
}

/** 递归脱敏 + 截断，返回可安全序列化的副本（不修改入参） */
export function sanitizeBody(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? truncate(value, MAX_STRING) : value;
  }
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeBody(item, depth + 1));
    if (value.length > MAX_ARRAY) {
      items.push(`…(+${value.length - MAX_ARRAY})`);
    }
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, val] of entries.slice(0, MAX_KEYS)) {
    out[key] = SENSITIVE_KEY.test(key) ? MASK : sanitizeBody(val, depth + 1);
  }
  if (entries.length > MAX_KEYS) {
    out['…'] = `(+${entries.length - MAX_KEYS} keys)`;
  }
  return out;
}

/** 脱敏后序列化成单行文本；总长受 MAX_TOTAL 约束 */
export function formatLogBody(body: unknown): string {
  const text = inspect(sanitizeBody(body), {
    depth: MAX_DEPTH,
    breakLength: Number.POSITIVE_INFINITY,
    compact: true,
  });
  return text.length > MAX_TOTAL
    ? `${text.slice(0, MAX_TOTAL)}…(truncated)`
    : text;
}

function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}…(+${text.length - max})`
    : text;
}

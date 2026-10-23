import { inspect } from 'node:util';

/** cause 链最多展开的层数：防循环引用与极深嵌套把日志刷爆 */
const MAX_CAUSE_DEPTH = 5;

/** 从错误对象上摘出的机器可读字段（pg 驱动错误 & Node 系统错误） */
const DETAIL_FIELDS = [
  'code',
  'severity',
  'detail',
  'hint',
  'constraint',
  'table',
  'column',
  'errno',
  'syscall',
  'address',
  'port',
] as const;

export interface FormatErrorOptions {
  /** 首层错误是否输出完整堆栈（cause 链只输出单行摘要） */
  includeStack?: boolean;
}

/**
 * 把任意"抛出物"格式化为日志文本，并**展开 `cause` 链**。
 *
 * 必须展开 cause：drizzle 的 `DrizzleQueryError` message 里只有 SQL 文本，
 * 真实原因（连接被掐断 / 表不存在 / 超时）全在 `cause` 上；只看外层 message，
 * 日志里就找不到可行动的信息。
 *
 * **口径约束**：`common/api-response/pg-error.ts` 的 `unwrapPgError()` 必须与本函数
 * 用同样的逐层展开与同样的层数上限（5 层）。口径不一致会出现
 * "日志有 `code=23505`、响应仍 500"这种最难查的偏差。
 *
 * 统一先格式化成字符串再交给 Logger —— ConsoleLogger 会把第二个字符串参数
 * 当作 context 解析。
 *
 * - 首层 `Error`：`includeStack` 时取 `stack`，否则取 `message`
 * - cause 链：每层一行，前缀 `caused by:`，取 `Name: message`
 * - 驱动错误：额外摘出 `code` / `detail` / `constraint` 等字段
 * - 非 Error：用 `util.inspect`，避免 `String({})` 变成 `[object Object]`
 */
export function formatError(
  error: unknown,
  options: FormatErrorOptions = {},
): string {
  const segments: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (isErrorLike(current)) {
    if (seen.has(current) || depth >= MAX_CAUSE_DEPTH) break;
    seen.add(current);
    const isRoot = depth === 0;
    segments.push(
      isRoot
        ? describe(current, true, options.includeStack === true)
        : `caused by: ${describe(current, false, false)}`,
    );
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }

  // 非 Error 的抛出物（throw 'xxx' / throw {} / undefined）走 inspect
  if (segments.length === 0) return inspect(error);

  if (depth >= MAX_CAUSE_DEPTH && isErrorLike(current)) {
    segments.push(`caused by: …（cause 链超过 ${MAX_CAUSE_DEPTH} 层，已截断）`);
  }
  return segments.join('\n');
}

/**
 * 把多行文本压成单行。
 *
 * 访问日志要求「一次请求 = 一行」：库异常的 message 常带换行，不压平会劈开日志行，
 * 让依赖「一行一事件」的 grep / 日志采集错位。
 */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isErrorLike(value: unknown): value is object {
  return (
    value instanceof Error || (typeof value === 'object' && value !== null)
  );
}

/**
 * 首层错误保持简写（业务异常本就是人写的短句）；cause 链上的库错误取
 * `Name: message`，因为光看 message 分不清是谁抛的。
 */
function describe(value: unknown, isRoot: boolean, withStack: boolean): string {
  if (!(value instanceof Error)) return inspect(value);
  const head =
    withStack && value.stack
      ? value.stack
      : isRoot
        ? value.message || value.name
        : `${value.name}: ${value.message || '(no message)'}`;
  const details = readDetailFields(value);
  return details ? `${head} ${details}` : head;
}

/** 摘出 `code=23505 constraint=users_email_alive_idx` 这类字段，比 message 更好检索 */
function readDetailFields(error: Error): string {
  const record = error as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of DETAIL_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${field}=${String(value)}`);
  }
  return parts.length > 0 ? `(${parts.join(' ')})` : '';
}

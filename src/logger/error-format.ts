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
  /** 首层错误是否输出完整堆栈（cause 链只输出单行摘要，不堆叠多层堆栈） */
  includeStack?: boolean;
}

/**
 * 把任意"抛出物"格式化为日志可读文本，并**展开 `cause` 链**。
 *
 * **为什么必须展开 cause：** 很多库把"真正失败的原因"包在外层错误里 ——
 * drizzle 的 `DrizzleQueryError`（`message` 只有 SQL 文本 + 空的 `params:`，
 * 真实原因在 `cause`）、undici 的 `TypeError: fetch failed`（真正原因在 `cause`）等。
 * 只读最外层 message/stack，日志里就只剩「某个查询失败了」，
 * 看不到「连接被掐断 / 认证失败 / 超时 / 表不存在」这类真正可行动的信息。
 * 本项目 `UserService.handlePgError` 早已在业务侧解包 `err.cause`，
 * 但**日志侧**此前没有解包，2026-10-16 的一次 500 排查就是卡在这里。
 *
 * **为什么不直接把异常当参数传给 Logger：** `@nestjs/common` 的 ConsoleLogger 会把第二个
 * 字符串参数解析成 **context**（见 `getContextAndStackAndMessagesToPrint`），
 * 传 `String(err)` 会让异常内容错位。统一先格式化成一个字符串再交给 Logger 最稳。
 *
 * - 首层 `Error`：`includeStack` 时取 `stack`，否则取 `message`（保持调用方的简写习惯）
 * - cause 链：每层一行，前缀 `caused by:`，取 `Name: message`（不堆叠多层堆栈）
 * - 驱动错误：额外摘出 `code`/`detail`/`constraint` 等字段 —— 比 message 更有诊断价值
 * - 非 Error（字符串 / 普通对象 / undefined）：用 `util.inspect`，避免 `String({})` 变成 `[object Object]`
 */
export function formatError(error: unknown, options: FormatErrorOptions = {}): string {
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
 * 访问日志行必须「一次请求 = 一行」：库抛出的 message 本身常带换行
 * （如 drizzle 的 `... is null\nparams: `），不压平会把一行日志劈成两半，
 * 也会让依赖「一行一事件」的 grep / 日志采集错位。
 */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isErrorLike(value: unknown): value is object {
  return value instanceof Error || (typeof value === 'object' && value !== null);
}

/**
 * 首层错误保持调用方习惯的简写（无堆栈时只取 `message`，业务异常本就是人写的短句）；
 * cause 链上的库错误取 `Name: message`，因为光看 message 往往分不清是谁抛的。
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

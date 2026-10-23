/**
 * 从任意"抛出物"里解出 PG 驱动的机器可读事实。
 *
 * 为什么单独成文件：**日志与响应必须用同一套解包口径**。
 * drizzle 把驱动错误包成 `DrizzleQueryError`（外层 `message` 只有 SQL 文本），
 * 真实原因在 `cause` 链上。`logging/error-format.ts` 的 `formatError()` 逐层展开
 * `cause`，本文件也必须逐层展开、且层数上限一致 —— 口径不一致的典型症状是
 * "日志里有 `code=23505`，响应却是 500"。
 */

/** 解包后的驱动事实（只取响应映射需要的最小集合） */
export interface PgErrorFacts {
  /** SQLSTATE，如 `23505`（唯一约束冲突） */
  readonly code?: string;
  /** 冲突的约束名，如 `users_email_alive_idx` */
  readonly constraint?: string;
  /** 驱动给的详情文本（只用于排障，不对外） */
  readonly detail?: string;
}

/** cause 链最多展开的层数：与 `logging/error-format.ts` 的 `MAX_CAUSE_DEPTH` 保持一致 */
const MAX_CAUSE_DEPTH = 5;

/**
 * 解包 drizzle 的 `DrizzleQueryError` 包装，返回**最内层**带 `code` 的那一层的事实。
 *
 * 规则：
 * - 从传入值开始逐层读 `(err as { cause?: unknown }).cause`，最多 5 层
 * - 循环引用 / 非对象层立刻停止（`Set` 去重，与 `formatError` 同一保护）
 * - 每个带非空字符串 `code` 的层都会刷新结果，因此"根因"胜出
 * - 一路上都没有 `code` → 返回 `undefined`（调用方据此判定"不是 PG 错误"）
 *
 * @param error 任意抛出物（通常是 service 里 `catch (err)` 拿到的东西）
 * @returns 最内层的 `{ code, constraint, detail }`，或 `undefined`
 *
 * @example
 * const facts = unwrapPgError(err);
 * if (facts?.code === UNIQUE_VIOLATION_CODE) { … }
 */
export function unwrapPgError(error: unknown): PgErrorFacts | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let facts: PgErrorFacts | undefined;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!isRecord(current) || seen.has(current)) break;
    seen.add(current);

    const record = current as {
      readonly code?: unknown;
      readonly constraint?: unknown;
      readonly detail?: unknown;
    };

    if (typeof record.code === 'string' && record.code !== '') {
      facts = {
        code: record.code,
        constraint:
          typeof record.constraint === 'string' ? record.constraint : undefined,
        detail: typeof record.detail === 'string' ? record.detail : undefined,
      };
    }

    current = (current as { readonly cause?: unknown }).cause;
  }

  return facts;
}

/** Error 与普通对象都算"可继续读 cause 的层" */
function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

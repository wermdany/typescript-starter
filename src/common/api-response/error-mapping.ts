import {
  BadRequestException,
  ConflictException,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { unwrapPgError } from '@/common/api-response/pg-error.js';

/**
 * 失败收敛：**异常 → HttpException 的唯一映射链**。
 *
 * "PG 唯一冲突转 409"只在链上实现一次，`HttpExceptionFilter` 是唯一调用方 ——
 * service 因此不必为驱动错误写 catch，也不会各自抄一份 `23505` 判断与文案。
 *
 * 链的顺序即优先级：先翻译框架的英文文案，再让 `HttpException` 直通，最后认驱动错误。
 * 都不匹配 → 返回 `null`，由过滤器落 500（对外固定「服务器内部错误」）。
 */

/** PG 唯一约束冲突的 SQLSTATE */
export const UNIQUE_VIOLATION_CODE = '23505';

/**
 * 约束名片段 → 对外文案。
 *
 * 顺序即优先级（先命中先返回）：`student_no` 是列级唯一索引，
 * `email_alive_idx` 是"只对未软删行生效"的部分唯一索引（`users_email_alive_idx`）。
 * 文案已是**对外契约**（客户端在按它做提示），改动视为破坏性变更。
 */
const UNIQUE_VIOLATION_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['student_no', '学号已存在'],
  ['email_alive_idx', '邮箱已被使用'],
];

/** 约束名没命中映射表时的兜底文案（不泄漏约束名） */
export const DEFAULT_UNIQUE_VIOLATION_MESSAGE = '数据唯一性冲突';

/** 一个映射器：命中返回可抛的 `HttpException`，不命中返回 `undefined`（交给下一个） */
export type ErrorMapper = (error: unknown) => HttpException | undefined;

/**
 * 映射器 1：`HttpException` 直通。
 *
 * 业务代码抛的 400/401/403/404/409 原样保留状态码与文案 —— 这是绝大多数失败路径。
 */
function httpExceptionPassThrough(error: unknown): HttpException | undefined {
  return error instanceof HttpException ? error : undefined;
}

/**
 * 映射器 2：multipart 解析器的英文文案 → 中文契约。
 *
 * multer 通过 Nest 的 `transformException` 变成 `HttpException`，但 `message` 是它自己的
 * 英文常量（`File too large` / `Unexpected file field - <name>`）。本项目对外只输出中文，
 * 且这些异常发生在**管道之前**，业务代码没有任何机会改文案 —— 只能在映射链上翻译。
 *
 * 用前缀匹配而不是精确匹配：multer 的字段名错误会把字段名拼在文案后面，
 * 精确匹配在它改名或拼接时静默失效，而这里失效的表现是"又冒出一句英文"。
 */
const MULTIPART_MESSAGES: ReadonlyArray<
  readonly [RegExp, 413 | 400, string]
> = [
  [/^File too large/, 413, '上传内容超过大小上限'],
  [/^Unexpected (file )?field/, 400, '表单字段名与接口约定不一致'],
  [/^Too many files/, 400, '一次请求只能上传一个文件'],
];

function multipartMessageMapper(error: unknown): HttpException | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const matched = MULTIPART_MESSAGES.find(([pattern]) =>
    pattern.test(error.message),
  );
  if (matched === undefined) return undefined;
  const [, status, message] = matched;
  return status === 413
    ? new PayloadTooLargeException(message)
    : new BadRequestException(message);
}

/**
 * 映射器 3：PG 唯一约束冲突 → 409。
 *
 * 解包口径与日志一致（逐层展开 `cause`，最多 5 层），见 `pg-error.ts`。
 */
function pgUniqueViolationMapper(error: unknown): HttpException | undefined {
  const facts = unwrapPgError(error);
  if (facts?.code !== UNIQUE_VIOLATION_CODE) return undefined;

  const constraint = facts.constraint;
  const matched = UNIQUE_VIOLATION_MESSAGES.find(
    ([fragment]) => constraint !== undefined && constraint.includes(fragment),
  );
  return new ConflictException(
    matched === undefined ? DEFAULT_UNIQUE_VIOLATION_MESSAGE : matched[1],
  );
}

/**
 * 默认映射链（顺序即优先级）。
 *
 * 新增一类"库错误 → 业务失败"的映射时**只改这里**，不要在 service 里 catch。
 */
export const DEFAULT_ERROR_MAPPERS: readonly ErrorMapper[] = [
  // 必须排在直通之前：待翻译的都是 HttpException，直通会把它们原样放过去
  multipartMessageMapper,
  httpExceptionPassThrough,
  pgUniqueViolationMapper,
];

/**
 * 跑一遍映射链，返回第一个命中的 `HttpException`。
 *
 * @param error 任意抛出物
 * @param mappers 映射链（默认 {@link DEFAULT_ERROR_MAPPERS}；测试可注入自定义链）
 * @returns 命中的 `HttpException`，全都不命中返回 `null`
 *
 * @example
 * const mapped = toHttpException(exception);
 * if (mapped) { status = mapped.getStatus(); }
 */
export function toHttpException(
  error: unknown,
  mappers: readonly ErrorMapper[] = DEFAULT_ERROR_MAPPERS,
): HttpException | null {
  for (const mapper of mappers) {
    const mapped = mapper(error);
    if (mapped !== undefined) return mapped;
  }
  return null;
}

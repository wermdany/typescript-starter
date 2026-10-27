import type { SchemaObject } from '@nestjs/swagger';

import { failureEnvelope } from './envelope.js';

/**
 * **公共错误**的唯一出处：文案 + 响应体形状。
 *
 * 这类错误不属于某个接口的业务语义，而是框架层统一产生的（守卫、过滤器、参数管道），
 * 因此文案只在这里写一次。谁来"挂"它，由知道这件事的装饰器决定：
 *
 * | 状态 | 谁会挂 | 为什么是它 |
 * | --- | --- | --- |
 * | 400 | `@ZodBody` / `@ZodQuery` / `@ZodParam` | 只有带入参的接口才可能校验失败 |
 * | 401 | `@Authenticated` / `@RequirePermission` / `@OwnerOrPermission` | 只有要登录的接口才可能未登录 |
 * | 403 | `@RequirePermission` / `@OwnerOrPermission` | `@Authenticated` 没有权限码，不会 403 |
 * | 404 | `@ZodParam` / `@ZodParams` | 有路径参数才意味着"按标识取资源" |
 * | 409 | `@Idempotent` | 只有参与幂等的写接口才有重放冲突 |
 * | 500 | `buildOpenApiDocument()` | 没有任何装饰器能预知，统一兜底 |
 *
 * 这样"哪个接口可能返回哪个错误"仍由最了解它的地方声明，而"措辞"只有一份。
 */
const COMMON_ERRORS = {
  401: '未登录或登录态已失效（token 缺失 / 过期 / 会话已吊销）',
  403: '已登录，但缺少执行该操作所需的权限',
  404: '资源不存在，或已被软删除',
  500: '服务器内部错误（细节只进服务端日志，对外固定文案）',
} as const;

export type CommonErrorStatus = keyof typeof COMMON_ERRORS;

/**
 * 公共错误的响应体（`description` + 信封 schema）。
 *
 * 返回 `{ description, schema }` 而不是完整的 `ResponseObject`：装饰器侧走
 * `@nestjs/swagger` 的 `schema` 入口（已验证可用），装配侧再包成 `content`。
 */
export function commonErrorResponse(status: CommonErrorStatus): {
  description: string;
  schema: SchemaObject;
} {
  return { description: COMMON_ERRORS[status], schema: failureEnvelope() };
}

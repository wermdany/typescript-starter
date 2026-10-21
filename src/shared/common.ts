/**
 * shared 常用件的统一出口。
 *
 * 业务代码按需从本文件取常用件，不必记住具体文件名：
 *
 * ```ts
 * import { ApiMessage, paginate, PageResponse, hashPassword } from './common.js';
 * import { trimmedShape, passwordSchema, paginationSchema } from './validation.js';
 * ```
 *
 * - 校验相关（zod）在 `validation.ts`，单独拆开是为了让 import 一眼看出来源
 * - 全局 HTTP 组件（过滤器/拦截器/校验管道）不放这里：它们只由 `app.core.module.ts` 与
 *   Controller 使用，直接从 `@/shared/http/*` 引入
 */

// 响应装饰器
export {
  ApiMessage,
  RESPONSE_MESSAGE_KEY,
} from '@/shared/decorators/api-message.decorator.js';
export {
  SkipTransform,
  SKIP_TRANSFORM_KEY,
} from '@/shared/decorators/skip-transform.decorator.js';

// 响应契约
export {
  DEFAULT_SUCCESS_MESSAGE,
  DEFAULT_VALIDATION_MESSAGE,
  type ApiFailure,
  type ApiResponse,
  type ApiSuccess,
  type FieldError,
} from '@/common/api-response/api-response.js';

// 分页
export { paginate, type PageResponse } from '@/shared/pagination/paginate.js';

// 密码哈希
export {
  hashPassword,
  verifyPassword,
} from '@/shared/crypto/password.scrypt.js';

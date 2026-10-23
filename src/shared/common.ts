/**
 * shared 常用件的统一出口。
 *
 * 业务代码按需从本文件取常用件，不必记住具体文件名：
 *
 * ```ts
 * import { paginate, type PageResponse, hashPassword } from '@/shared/common.js';
 * import { trimmedShape, passwordSchema, paginationSchema } from '@/shared/validation.js';
 * ```
 *
 * **这里只放纯工具**（分页、密码哈希、校验）：它们不依赖 Nest，也不参与
 * "一次请求经过哪些阶段"的回答。横切能力（响应装饰器、过滤器、拦截器、管道）
 * 一律在 `@/common/<功能>/`，清单见 `common/http-stages.ts`。
 *
 * - 校验相关（zod）在 `validation.ts`，单独拆开是为了让 import 一眼看出来源
 * - 响应装饰器（`@ApiMessage` / `@SkipTransform`）在
 *   `@/common/api-response/response.decorator.js`（它们服务于契约产物，跟着契约走）
 */

// 响应契约（类型 + 默认文案常量）
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

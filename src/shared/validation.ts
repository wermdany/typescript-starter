/**
 * 校验相关统一出口：首尾空白规范化、密码规则、分页 schema。
 *
 * @example
 * import { paginationSchema, passwordSchema, trimmedShape } from './validation.js';
 */
export { trimmed, trimmedShape } from '@/shared/validation/trimmed.js';
export { dateSchema } from '@/shared/validation/date.js';
export { ROLE_CODE_PATTERN, roleCodeSchema } from '@/shared/validation/role.js';
export { schemaFor } from '@/shared/validation/schema-for.js';
export {
  LEGACY_PASSWORD_MAX_LENGTH,
  PASSWORD_ALLOWED_CHARS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from '@/shared/validation/password.js';
export {
  pageOf,
  paginationSchema,
  type PaginationQuery,
} from '@/shared/pagination/pagination.schema.js';

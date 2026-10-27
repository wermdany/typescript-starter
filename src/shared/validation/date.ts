import { z } from 'zod';

/**
 * 日期字段的 zod schema（**给文档用的那一份**）。
 *
 * `z.date()` 在 JSON Schema 里属于"不可表示"的类型，`z.toJSONSchema()` 会安静地
 * 输出 `{}` —— 不报错，但 OpenAPI 里那一列就变成一个空 schema，客户端拿到的类型是
 * `any`。这类错误不会让任何检查变红，只能靠一开始就写对。
 *
 * `.meta()` 显式声明它在**传输层**的样子：`JSON.stringify(new Date())` 得到 ISO 字符串，
 * 对应 OpenAPI 的 `type: string, format: date-time`。之所以不用 `z.iso.datetime()`，
 * 是因为后者会附带一条匹配闰年的超长正则（和 `z.email()` 同款噪音），还得再清洗一遍。
 *
 * 校验侧的 `z.date()` 语义不受影响：这里只是给同一个 schema 加了描述信息。
 *
 * @example
 * export const meSchema = z.object({ createdAt: dateSchema, revokedAt: dateSchema.nullable() });
 */
export const dateSchema = z.date().meta({
  type: 'string',
  format: 'date-time',
  description: 'ISO 8601 时间字符串',
});

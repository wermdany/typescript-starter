import { z } from 'zod';

/**
 * 文本字段首尾空白规范化（单个 schema 用；多字段用 {@link trimmedShape}）。
 *
 * **只 trim，不产出 `undefined`**：trim 后为空就保持空串，交给字段自身的 `min(1)`
 * 判定。空值语义不属于 schema 层 —— query 的空值由 `ZodValidationPipe` 归一化，
 * body 的 `''` / `null` 如实校验。
 *
 * 用 `z.preprocess` 而非 `z.string().trim()`：本函数要包裹任意字段类型（enum / number
 * 等非字符串原样透传），且 `preprocess` 恒在内层校验之前执行，不会出现
 * "先过长度的空格串再被 trim 成空串"的顺序问题。
 */
export function trimmed<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    schema,
  );
}

/**
 * 把 shape 中每个顶层字段包一层 {@link trimmed}，是 DTO 的默认写法。
 *
 * - **无例外字段**：`password` 同样 trim，长度校验因此作用于 trim 后的值
 * - 不重建对象：返回值是普通 shape，调用方照常交给 `z.object(...)` /
 *   `paginationSchema.extend(...)`，其后的 `.refine()` 等不受影响
 * - 非字符串字段原样透传，无需按类型分支
 * - 只处理顶层字段；嵌套对象在其定义处自行包一层
 *
 * @example
 * export const createUserSchema = z.object(
 *   trimmedShape({
 *     nickname: z.string().min(1).max(50),
 *     password: passwordSchema,
 *   }),
 * );
 */
export function trimmedShape<T extends Record<string, z.ZodType>>(shape: T): T {
  const wrapped = Object.entries(shape).map(([key, field]) => [
    key,
    trimmed(field),
  ]);
  return Object.fromEntries(wrapped) as T;
}

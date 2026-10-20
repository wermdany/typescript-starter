import { z } from 'zod';

import { trimmed } from '@/shared/validation.js';
import { studentNoSchema } from './create-user.dto.js';

/**
 * `:id` 路径参数 schema（复用于全部 :id 路由）。
 *
 * 路径参数是顶层字符串，query 归一化与 shape 包装都覆盖不到，因此显式套 `trimmed()`。
 *
 * 不用 `z.coerce.number()`：`Number('') === 0` 会把空值误报成 `too_small`，
 * 且 `Number()` 对 `'0x10'` / `'1e0'` 这类解析过于宽松。先用 `/^\d+$/` 收紧，
 * 再 `.pipe()` 到数字域校验。
 */
export const idParamSchema = trimmed(
  z
    .string()
    .regex(/^\d+$/, { error: 'ID 必须是正整数' })
    .transform(Number)
    .pipe(z.number().int().positive()),
);

export type IdParam = z.infer<typeof idParamSchema>;

/**
 * `:studentNo` 路径参数 schema。
 *
 * 长度约束前置后，超长学号报 400，而不是触发 PG `22001` 冒泡成 500。
 */
export const studentNoParamSchema = trimmed(studentNoSchema);

export type StudentNoParam = z.infer<typeof studentNoParamSchema>;

import { z } from 'zod';

import { trimmed } from '@/shared/validation.js';

/**
 * `:id` 路径参数 schema。
 *
 * 路径参数是顶层字符串，query 归一化与 shape 包装都覆盖不到，因此显式套 `trimmed()`。
 *
 * 不用 `z.coerce.number()`：`Number('') === 0` 会把空值误报成 `too_small`，
 * 且 `Number()` 对 `'0x10'` / `'1e0'` 这类解析过于宽松。先用 `/^\d+$/` 收紧，
 * 再 `.pipe()` 到数字域校验。
 *
 * 与 user / file 模块的同形 schema 不共享：请求契约按资源各自声明
 * （`08-contract-layers.md` R4 的方向），跨模块 import 会让"改角色参数"意外改动别处。
 */
export const roleIdParamSchema = trimmed(
  z
    .string()
    .regex(/^\d+$/, { error: '角色 ID 必须是正整数' })
    .transform(Number)
    .pipe(z.number().int().positive()),
).describe('角色 ID（正整数）');

export type RoleIdParam = z.infer<typeof roleIdParamSchema>;

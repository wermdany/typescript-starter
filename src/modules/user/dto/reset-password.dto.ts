import { z } from 'zod';

import { trimmed, trimmedShape } from '../../../common/validation/trimmed.js';
import { studentNoSchema } from './create-user.dto.js';

/** 重置密码请求体 */
export const resetPasswordSchema = z.object(
  trimmedShape({
    /**
     * 新的明文密码（服务端 scrypt 哈希后存储）。
     *
     * `keepWhitespace`：与创建接口一致，空白可能是密码的熵，不规范化。
     */
    password: z.string().min(8).max(128).meta({ keepWhitespace: true }),
  }),
);

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/**
 * `:id` 路径参数 schema（数字 ID，复用于全部 :id 路由）。
 *
 * 路径参数是顶层字符串，管道层的「空串 / null 归一化」（只递归普通对象）覆盖不到，
 * 因此与 `:studentNo` 一样显式套 {@link trimmed} 做首尾空白规范化。
 *
 * 为什么不用 `z.coerce.number()`：
 *
 * 1. `Number('') === 0`，空串 / 纯空白会被误报成 `Too small: expected number to be >0`
 *    —— 看不出到底是"没传"还是"传了 0"。套 `trimmed` 后空白值等同「未提供」，
 *    报 `expected string, received undefined`，与其他参数（query / body）的缺失语义一致
 * 2. `Number()` 解析过于宽松：`'0x10'` → 16、`'1e0'` → 1、`'+1'` / `'1.'` / `'2.0'` 照收。
 *    这里用 `/^\d+$/` 前置收紧，非纯数字统一报「ID 必须是正整数」
 *
 * 数字域校验放在内层（`.pipe`）：`'0'` / `'000'` 由 `.positive()` 拦下；
 * 超出安全整数的数字串（20 位以上）报 `Too big`，不会带着失真浮点数进 DB。
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
 * 路径参数是顶层字符串，管道层的"空串/null 归一化"（只递归普通对象）与
 * shape 级包装都覆盖不到它，因此这里显式使用 `trimmed`。
 * 同时补上长度约束：学号列为 varchar(20)，超出长度会触发 PG `22001`
 * 并冒泡为 500（`handlePgError` 只处理 23505），校验前置后变为 400。
 */
export const studentNoParamSchema = trimmed(studentNoSchema);

export type StudentNoParam = z.infer<typeof studentNoParamSchema>;

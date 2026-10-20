import { z } from 'zod';

import { passwordSchema, trimmedShape } from '@/shared/validation.js';

/** 学号基础约束（创建接口与 `:studentNo` 路径参数复用） */
export const studentNoSchema = z.string().min(1).max(20);

/** 角色枚举（与 `users.schema.ts` 的 `userRoleEnum` 保持一致，创建/更新/筛选共用） */
export const userRoleSchema = z.enum(['student', 'teacher', 'admin']);

/**
 * 创建用户请求体。
 *
 * 字段统一经 `trimmedShape()` 去掉首尾空白，无例外字段。
 *
 * 请求体不做空值宽恕：`''` / 纯空白由 `min(1)` 拒绝，`null` 报类型错误。
 * "没提供"只能靠省略 key 表达。
 */
export const createUserSchema = z.object(
  trimmedShape({
    /** 学号（唯一） */
    studentNo: studentNoSchema,
    /** 邮箱（软删除友好唯一） */
    email: z.email(),
    /** 昵称 */
    nickname: z.string().min(1).max(50),
    /** 明文密码，服务端 scrypt 哈希后存储；规则与修改密码共用 */
    password: passwordSchema,
    /** 角色，默认学生 */
    role: userRoleSchema.default('student'),
    /** 积分，默认 0 */
    points: z.number().int().nonnegative().default(0),
  }),
);

export type CreateUserDto = z.infer<typeof createUserSchema>;

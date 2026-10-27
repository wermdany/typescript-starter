import { z } from 'zod';

import { ROLE_CODES } from '@/common/auth/auth.contract.js';
import { passwordSchema, trimmedShape } from '@/shared/validation.js';

/** 学号基础约束（创建接口与 `:studentNo` 路径参数复用） */
export const studentNoSchema = z.string().min(1).max(20);

/**
 * 角色码枚举（创建 / 更新 / 筛选共用）。
 *
 * 取自 `ROLE_CODES` 而不是在这里重写一遍字面量：加角色时只改契约一处，
 * DTO 的运行时校验与 `RoleCode` 类型不会分叉。
 */
export const userRoleSchema = z.enum(ROLE_CODES);

/**
 * 用户的角色集合（多角色，权限取并集）。
 *
 * - `min(1)`：不允许"零角色用户"——这种账号能登录但任何权限码都过不了，
 *   看起来像 bug，实际上是配置漏了
 * - 去重后比较：`['student','student']` 报错而不是静默合并，重复通常是客户端拼错了
 */
export const userRolesSchema = z
  .array(userRoleSchema)
  .min(1, { message: '至少提供一个角色' })
  .refine((roles) => new Set(roles).size === roles.length, {
    message: '角色不能重复',
  });

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
    studentNo: studentNoSchema.describe('学号（登录账号，全局唯一）'),
    /** 邮箱（软删除友好唯一） */
    email: z.email().describe('邮箱；软删除后可以被另一个账号重新使用'),
    /** 昵称 */
    nickname: z.string().min(1).max(50).describe('昵称，1~50 字'),
    /** 明文密码，服务端 scrypt 哈希后存储；规则与修改密码共用 */
    password: passwordSchema.describe(
      '明文密码；服务端 scrypt 哈希后存储，任何接口都不会返回它',
    ),
    /** 角色集合，默认学生 */
    roles: userRolesSchema
      .default(['student'])
      .describe('角色码集合，默认 ["student"]；权限取并集'),
    /** 积分，默认 0 */
    points: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe('初始积分，默认 0'),
  }),
);

export type CreateUserDto = z.infer<typeof createUserSchema>;

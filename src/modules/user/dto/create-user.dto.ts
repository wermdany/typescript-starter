import { z } from 'zod';

import { trimmedShape } from '../../../common/validation/trimmed.js';

/** 学号基础约束（同时被创建接口与 `:studentNo` 路径参数复用） */
export const studentNoSchema = z.string().min(1).max(20);

/**
 * 创建用户请求体。
 *
 * 字段统一经 `trimmedShape()` 去掉首尾空白，例外字段就近用
 * `.meta({ keepWhitespace: true })` 标注。
 *
 * **请求体契约（AGENTS.md 第 6 节）：这里不做任何空值宽恕。**
 * `''` / 纯空白由各字段的 `min(1)` 拒绝，`null` 报类型错误——"没提供"必须靠
 * **省略 key** 表达，而不是传 `""` 或 `null`。可选字段若要"不参与"，同样直接省掉。
 */
export const createUserSchema = z.object(
  trimmedShape({
    /** 学号（唯一） */
    studentNo: studentNoSchema,
    /** 邮箱（软删除友好唯一） */
    email: z.email(),
    /** 昵称 */
    nickname: z.string().min(1).max(50),
    /**
     * 明文密码（服务端 scrypt 哈希后存储）。
     *
     * `keepWhitespace`：密码中首尾空白可能是用户有意设置的熵，擅自规范化会导致
     * 同一密码在注册/登录两侧被不同处理，也可能让 `'        '`（8 空格）意外通过长度校验。
     */
    password: z.string().min(8).max(128).meta({ keepWhitespace: true }),
    /** 角色，默认学生 */
    role: z.enum(['student', 'admin']).default('student'),
    /** 积分，默认 0（非字符串，规范化对其无副作用） */
    points: z.number().int().nonnegative().default(0),
  }),
);

export type CreateUserDto = z.infer<typeof createUserSchema>;

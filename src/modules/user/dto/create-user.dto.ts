import { z } from 'zod';

import { passwordSchema } from '../../../common/validation/password.js';
import { trimmedShape } from '../../../common/validation/trimmed.js';

/** 学号基础约束（同时被创建接口与 `:studentNo` 路径参数复用） */
export const studentNoSchema = z.string().min(1).max(20);

/**
 * 创建用户请求体。
 *
 * 字段统一经 `trimmedShape()` 去掉首尾空白，**无例外字段**（`password` 也一样）。
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
     * 规则收敛在 {@link passwordSchema}：长度 8~18、字符仅限字母/数字/下划线、
     * 且三类至少占两类 —— 与修改密码接口**共用同一份 schema**，
     * 避免"注册能设的密码、改密设不了"这种两侧不一致。
     *
     * 与其余文本字段一致地去掉首尾空白：注册与登录两侧用同一份规则，
     * 不存在"注册 trim、校验不 trim"的不一致；顺带堵住 `'        '`（8 空格）
     * 靠长度校验蒙混过关的隐患（trim 后为空串，被长度下限拒绝）。
     */
    password: passwordSchema,
    /** 角色，默认学生 */
    role: z.enum(['student', 'admin']).default('student'),
    /** 积分，默认 0（非字符串，规范化对其无副作用） */
    points: z.number().int().nonnegative().default(0),
  }),
);

export type CreateUserDto = z.infer<typeof createUserSchema>;

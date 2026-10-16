import { z } from 'zod';

import {
  LEGACY_PASSWORD_MAX_LENGTH,
  passwordSchema,
} from '../../../common/validation/password.js';
import { trimmedShape } from '../../../common/validation/trimmed.js';

/**
 * 修改密码请求体（`PATCH /users/:id/password`）。
 *
 * 与"重置"的差别就在于**必须提交旧密码**：服务端读取该用户存储的 scrypt 哈希，
 * 用 `verifyPassword()` 恒定时间比对，不符则 401（而不是把新密码写进去）。
 *
 * 两个字段都经 `trimmedShape()` 去掉首尾空白 —— 与创建接口保持一致
 * （旧密码也是 trim 后比对：历史上所有写入路径都 trim，库里不存在带首尾空白的密码）。
 */
export const changePasswordSchema = z.object(
  trimmedShape({
    /**
     * 旧密码（明文，**只用于校验，绝不入库**）。
     *
     * ⚠️ **刻意不套 {@link passwordSchema}**：那是"设密码"的规则，不是"验密码"的规则。
     * 库里可能存着字符规则收窄之前设定的密码（如 `drizzle/0001_seed_users.sql` 的演示账号
     * `12345678`、或 19~128 位的历史密码），若在这里用新规则（含长度上限 18）把旧密码拦下，
     * 等于把老用户永久锁在门外：他们连"提交旧密码"这一步都过不去。
     *
     * 因此只做两件事：非空（`min(1)`）+ {@link LEGACY_PASSWORD_MAX_LENGTH}。
     * 后者不是安全规则，而是**输入规模兜底**：旧密码会送进 scrypt，
     * 不设上限等于允许用超长字符串放大单次校验的成本。
     */
    oldPassword: z
      .string()
      .min(1, { error: '请输入旧密码' })
      .max(LEGACY_PASSWORD_MAX_LENGTH, {
        error: `旧密码长度不能超过 ${LEGACY_PASSWORD_MAX_LENGTH} 位`,
      }),
    /** 新密码（服务端 scrypt 哈希后存储；规则见 passwordSchema） */
    password: passwordSchema,
  }),
);

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

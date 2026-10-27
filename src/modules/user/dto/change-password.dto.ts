import { z } from 'zod';

import {
  LEGACY_PASSWORD_MAX_LENGTH,
  passwordSchema,
  trimmedShape,
} from '@/shared/validation.js';

/**
 * 修改密码请求体（`PATCH /users/password/:id`）：必须同时提交旧密码。
 *
 * 服务端读取存储的 scrypt 哈希比对，不符返回 401。
 */
export const changePasswordSchema = z.object(
  trimmedShape({
    /**
     * 旧密码（明文，只用于校验，绝不入库）。
     *
     * ⚠️ 刻意不套 `passwordSchema`：那是"设密码"的规则。
     * 库里存在规则收窄前的密码，用新规则卡旧密码会把这些用户锁在门外。
     * 这里只做非空 + 长度上限（上限仅为 scrypt 输入规模兜底）。
     */
    oldPassword: z
      .string()
      .min(1, { error: '请输入旧密码' })
      .max(LEGACY_PASSWORD_MAX_LENGTH, {
        error: `旧密码长度不能超过 ${LEGACY_PASSWORD_MAX_LENGTH} 位`,
      })
      .describe('旧密码；仅本人改密时需要，管理员重置他人密码时忽略'),
    /** 新密码（规则见 passwordSchema） */
    password: passwordSchema.describe('新密码，规则见 passwordSchema'),
  }),
);

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

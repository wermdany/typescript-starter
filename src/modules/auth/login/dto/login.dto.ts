import { z } from 'zod';

import {
  LEGACY_PASSWORD_MAX_LENGTH,
  trimmedShape,
} from '@/shared/validation.js';

/**
 * 登录请求体。
 *
 * `password` **不套 `passwordSchema`**：那是"设置密码"的规则，登录只校验"提交了什么"，
 * 库里可能存在规则收窄前设定的历史密码，用新规则卡登录会把老用户锁在门外。
 */
export const loginSchema = z.object(
  trimmedShape({
    /** 学号（登录账号） */
    studentNo: z.string().min(1, { error: '请输入学号' }).max(20),
    password: z
      .string()
      .min(1, { error: '请输入密码' })
      .max(LEGACY_PASSWORD_MAX_LENGTH, {
        error: `密码长度不能超过 ${LEGACY_PASSWORD_MAX_LENGTH} 位`,
      }),
  }),
);

export type LoginDto = z.infer<typeof loginSchema>;

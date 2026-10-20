import { z } from 'zod';

/** 密码长度下限 */
export const PASSWORD_MIN_LENGTH = 8;

/** 密码长度上限（按字符计，不是字节） */
export const PASSWORD_MAX_LENGTH = 18;

/**
 * **旧密码**（`oldPassword`）的长度上限，与 {@link PASSWORD_MAX_LENGTH} 分开。
 *
 * 旧密码是**校验**而非**设置**：库里可能存在规则收窄前设定的历史密码，
 * 套用新规则会把这些用户锁在门外。
 * 128 只是 scrypt 输入规模的兜底，不是安全规则。
 */
export const LEGACY_PASSWORD_MAX_LENGTH = 128;

/**
 * 密码允许的字符**白名单**：字母、数字、下划线。
 *
 * 白名单而非黑名单：黑名单挡不住 emoji、Unicode 空白（`\u200b`）与同形字符。
 */
export const PASSWORD_ALLOWED_CHARS = /^[A-Za-z0-9_]+$/;

/** 参与"至少包含 N 种"判定的字符类别（与白名单一一对应） */
const PASSWORD_CHAR_CLASSES = [/[A-Za-z]/, /[0-9]/, /_/] as const;

/** 密码至少需要覆盖的字符类别数 */
export const PASSWORD_MIN_CHAR_CLASSES = 2;

/**
 * 密码规则（只校验，不哈希；哈希见 `common/crypto/password.scrypt.ts`）：
 *
 * 1. 长度 8~18
 * 2. 字符只能取自字母 / 数字 / 下划线
 * 3. 三类中**至少包含两类**（纯数字、纯字母、纯下划线都不合格）
 *
 * 创建用户与修改密码共用这一份。不做 trim —— 由 DTO 的 `trimmedShape()` 负责，
 * 且必须发生在本规则之前。
 *
 * ⚠️ 这是"设置密码"的规则，**不要**用于校验旧密码。
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`,
  })
  .regex(PASSWORD_ALLOWED_CHARS, {
    error: '密码只能包含字母、数字与下划线',
  })
  .refine(
    (value) =>
      PASSWORD_CHAR_CLASSES.filter((pattern) => pattern.test(value)).length >=
      PASSWORD_MIN_CHAR_CLASSES,
    { error: '密码需至少包含字母、数字、下划线中的两种' },
  );

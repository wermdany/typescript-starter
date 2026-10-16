import { z } from 'zod';

/** 密码长度下限（创建用户 / 修改密码共用同一份定义） */
export const PASSWORD_MIN_LENGTH = 8;

/** 密码长度上限（按字符计，不是字节） */
export const PASSWORD_MAX_LENGTH = 18;

/**
 * **旧密码**（`oldPassword`）的长度上限，刻意与 {@link PASSWORD_MAX_LENGTH} 分开。
 *
 * 取值 128 来自"规则收窄**之前**的上限"：老接口允许 8~128 位，因此库里存在
 * 19~128 位的历史密码。旧密码是**校验**而非**设置**——若在这里套 18，
 * 这些用户会连改密入口都进不去（提交旧密码即 400），永久锁在门外。
 *
 * 它本身不是安全规则，只是给 scrypt 输入规模兜底的界（旧密码会直接送进 scrypt）。
 */
export const LEGACY_PASSWORD_MAX_LENGTH = 128;

/**
 * 密码允许的字符**白名单**：仅字母（`A-Za-z`）、数字（`0-9`）、下划线（`_`）。
 *
 * 用白名单而非黑名单：黑名单只挡得住"想得到的"字符（空格、引号、控制字符…），
 * 挡不住 emoji、各种 Unicode 空白（`\u200b` / 全角空格）与同形字符，
 * 而这些恰恰是最容易在输入法、前后端转发、日志/命令行里被静默改写的东西。
 */
export const PASSWORD_ALLOWED_CHARS = /^[A-Za-z0-9_]+$/;

/** 参与"必须包含其中 N 种"判定的字符类别（与上面的白名单一一对应） */
const PASSWORD_CHAR_CLASSES = [/[A-Za-z]/, /[0-9]/, /_/] as const;

/** 密码至少需要覆盖的字符类别数（三类里满足两类） */
export const PASSWORD_MIN_CHAR_CLASSES = 2;

/**
 * 密码规则（**只校验，不哈希**；哈希见 `common/crypto/password.scrypt.ts`）。
 *
 * 三条约束：
 *
 * 1. 长度 8~18（{@link PASSWORD_MIN_LENGTH} / {@link PASSWORD_MAX_LENGTH}）
 * 2. 字符只能取自字母 / 数字 / 下划线（见 {@link PASSWORD_ALLOWED_CHARS}）
 * 3. 字母、数字、下划线三类**至少包含两类** —— 纯数字（`12345678`）、
 *    纯字母（`abcdefgh`）、纯下划线都不合格
 *
 * ## 首尾空白
 *
 * 本 schema **不做 trim**，按项目约定由调用方保证：多字段 DTO 用
 * `trimmedShape({...})`（`preprocess` 恒在内层校验之前），单字段可用 `trimmed()`。
 * 顺序很关键——若把 trim 写在长度/字符校验之后，`'        '`（8 空格）会先通过长度校验，
 * 再被 trim 成空串落库（AGENTS.md 第 6 节记过这个坑）。
 *
 * ## 只作用于"设置密码"，不作用于"校验密码"
 *
 * 这是**设置类**规则（注册、改密时的新密码）。**不要**拿它去校验用户提交的旧密码：
 * 库里可能存着规则收窄之前设定的密码（如种子数据的演示账号 `12345678`、
 * 或 19~128 位的历史密码），用新规则卡旧密码会把老用户永久锁在门外 ——
 * 旧密码只需非空 + {@link LEGACY_PASSWORD_MAX_LENGTH}。
 *
 * @example
 * // DTO 里这样复用（trim 由 trimmedShape 承担）
 * export const createUserSchema = z.object(
 *   trimmedShape({ password: passwordSchema }),
 * );
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

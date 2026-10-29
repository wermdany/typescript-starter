import { z } from 'zod';

import {
  dateSchema,
  LEGACY_PASSWORD_MAX_LENGTH,
  roleCodeSchema,
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
    studentNo: z
      .string()
      .min(1, { error: '请输入学号' })
      .max(20)
      .describe('学号（登录账号）'),
    password: z
      .string()
      .min(1, { error: '请输入密码' })
      .max(LEGACY_PASSWORD_MAX_LENGTH, {
        error: `密码长度不能超过 ${LEGACY_PASSWORD_MAX_LENGTH} 位`,
      })
      .describe('明文密码；登录不套「设置密码」的规则，避免锁住历史账号'),
  }),
);

export type LoginDto = z.infer<typeof loginSchema>;

/**
 * 登录 / 续期响应体的**唯一出处**。
 *
 * `refreshToken` 可选：Cookie 模式下它只进 `Set-Cookie`、从响应体剥离
 * （见 `AuthController.stripRefresh`），关掉 Cookie 开关时才回落到响应体。
 *
 * 类型一律从 schema 推（`z.infer`），不另写一份字段表 —— 抄一份就一定会漂移。
 */
export const loginResponseSchema = z
  .object({
    accessToken: z.string().describe('请求头用的短命 token'),
    refreshToken: z
      .string()
      .optional()
      .describe('仅关闭 Cookie 开关时出现在响应体；Cookie 模式下由 Set-Cookie 承载'),
    tokenType: z.literal('Bearer').describe('固定 Bearer，拼 Authorization 头时用'),
    expiresAt: dateSchema,
    expiresIn: z
      .number()
      .int()
      .describe('accessToken 剩余有效秒数，可直接做前端倒计时'),
    refreshTokenExpiresAt: dateSchema,
    refreshWindowSeconds: z
      .number()
      .int()
      .describe('refreshToken 的有效窗口（秒），决定最长多久必须重新登录'),
    user: z
      .object({
        id: z.number().int().describe('用户 ID'),
        studentNo: z.string().describe('学号'),
        nickname: z.string().describe('昵称'),
        roles: z.array(roleCodeSchema).describe('角色码集合'),
      })
      .describe('登录后立即可用的身份字段；完整资料走 GET /users/:id'),
  })
  .meta({ id: 'LoginResponse', description: '登录 / 续期响应体' });

/** 对外的 wire format（即响应信封里的 `data`） */
export type LoginResponseBody = z.infer<typeof loginResponseSchema>;

/**
 * 服务端**签发**的结果：与 wire format 同形，但 `refreshToken` 一定存在
 * —— controller 拿到它之后再决定放 Cookie 还是留在 body。
 *
 * 登录与续期两个用例共用这一个类型，不要再各自声明一份。
 */
export type LoginResult = Omit<LoginResponseBody, 'refreshToken'> & {
  refreshToken: string;
};

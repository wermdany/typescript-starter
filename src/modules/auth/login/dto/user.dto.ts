import { z } from 'zod';

import { users, type Users } from '@/database/schema/users.schema.js';
import { roleCodeSchema } from '@/shared/validation.js';

/**
 * 认证用例查询用户时使用的全量白名单（无敏感列）。
 *
 * - 与 `modules/user` 的资料投影**刻意分开**：那个是"用户资料"的对外契约，
 *   这个只服务登录/会话用例，字段需求各自演进，两模块互不 import
 * - 同样不含 `passwordHash`：需要时另行显式 select
 * - **不含角色**：多角色在 `user_roles`，由 `AccountService.findRoleCodes()` 单独取
 */
export const authUserColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/** 认证用例里的用户记录 */
export type AuthUser = Pick<Users, keyof typeof authUserColumns>;

/** 角色码的文档 schema：只描述形状，不枚举取值（角色是库里的数据） */
const roleCodesSchema = z
  .array(roleCodeSchema)
  .describe('角色码集合；按角色等级降序、角色码升序排列');

/**
 * 当前身份响应（前端刷新页面后据此重建本地登录态）。
 *
 * 嵌套结构 + 会话字段，不是表行，因此 schema 是唯一出处，类型由它推。
 *
 * `user` 比登录响应内嵌的摘要多了 `email` / `points`：这里是"当前身份"视图，
 * 登录响应只需要"登录后立即可用"的字段，两者需求不同，因此各自声明。
 */
export const meResultSchema = z
  .object({
    user: z
      .object({
        id: z.number().int().describe('用户 ID'),
        studentNo: z.string().describe('学号'),
        email: z.string().describe('邮箱'),
        nickname: z.string().describe('昵称'),
        roles: roleCodesSchema,
        points: z.number().int().describe('积分'),
      })
      .describe('当前登录用户的资料摘要'),
    sessionId: z
      .number()
      .int()
      .describe('本次请求所用会话，前端可用于在设备列表里高亮「本机」'),
  })
  .meta({ id: 'MeResult', description: '当前身份' });


export type MeResult = z.infer<typeof meResultSchema>;

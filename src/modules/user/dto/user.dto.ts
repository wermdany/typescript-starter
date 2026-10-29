import { z } from 'zod';

import { users, type Users } from '@/database/schema/users.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

/**
 * 对外公开字段**白名单**（响应契约的唯一出处）。
 *
 * 交给 Drizzle 做列投影，数据库层就不返回敏感列，也不需要映射函数：
 *
 * ```ts
 * this.db.select(userPublicColumns).from(users).where(...)
 * this.db.insert(users).values(...).returning(userPublicColumns)
 * this.db.update(users).set(...).returning(userPublicColumns)
 * ```
 *
 * 用白名单而非 `Omit` 黑名单：新增列默认不对外，列的增删改都在这里编译期暴露。
 *
 * - `passwordHash` 需要时另行显式 select，不要加进来
 * - 单个接口需要额外字段时另建投影，不要撑大这份公共白名单
 * - `deletedAt` 刻意不对外：它是软删除的持久化标记，所有读路径都带 `isNull`，
 *   未删用户返回的它恒为 `null`
 *
 * 这里只放**单表列**：`roles` 来自 `user_roles` 关联表，不能进 RETURNING
 * （PostgreSQL 的 RETURNING 不允许子查询），所以由 `UserResponse` 单独声明、
 * 由 service 用一次批量查询补齐（见 `UserService.rolesOf`）。
 */
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/** 单表列投影的结果形态（数据库直接返回的部分） */
export type UserScalars = Pick<Users, keyof typeof userPublicColumns>;

/**
 * 对外用户响应 = 公开列 + 角色集合。
 *
 * `roles` 是**派生**字段（来自 `user_roles`），与 `AuthenticatedUser.roles` 同源，
 * 客户端拿到的角色集合与鉴权时用的那一份不会有两套真相。
 * 顺序按 `roles.level` 降序、`code` 升序稳定排列。
 *
 * 类型是 `string[]` 而不是内置角色的字面量联合：角色码是库里的数据，
 * 管理端新建的角色同样会出现在这里，用联合类型声明等于对调用方撒谎。
 * 类型安全由「内置角色」这一层单独承担（`hasRole(user, 'teacher')` 的参数仍是字面量联合，
 * 拼错会编译报错）。
 */
export interface UserResponse extends UserScalars {
  roles: string[];
}

/** 把"公开列 + 角色集合"合成为响应对象 */
export function toUserResponse(
  scalars: UserScalars,
  roles: string[],
): UserResponse {
  return { ...scalars, roles };
}

/**
 * `UserResponse` 的文档 schema。
 *
 * 7 个单表列从 `userPublicColumns` 派生（字段集合、类型、可空性全部同源：
 * `passwordHash` / `deletedAt` 不在白名单里，因此也不会出现在文档里）；
 * 手工补的只有 `roles` —— 它来自 `user_roles` 关联表，白名单里没有。
 */
/**
 * `UserResponse` 的文档 schema。
 *
 * 字段与类型都写在这里，`z.ZodType<UserResponse>` 是**编译期锚定**：
 * 白名单加一列而这里没跟上、或类型/可空性写错，`pnpm typecheck` 直接红。
 * 描述就地写在字段上（`.describe()`），不需要另开一张说明表。
 */
export const userResponseSchema = schemaFor<UserResponse>()(
  z
  .object({
    id: z.number().int().describe('用户 ID'),
    studentNo: z.string().describe('学号（登录账号，全局唯一）'),
    email: z.string().describe('邮箱（软删除后可以被重新使用）'),
    nickname: z.string().describe('昵称'),
    points: z.number().int().describe('积分'),
    createdAt: dateSchema.describe('创建时间（数据库自动填充）'),
    updatedAt: dateSchema.describe('最后修改时间（更新需应用层手动写）'),
    roles: z
      .array(z.string())
      .describe('角色码集合；按角色等级降序、角色码升序稳定排列'),
  })
  .meta({ id: 'UserResponse', description: '对外用户投影' }),
);

/** 用户分页列表的文档 schema */
export const userPageSchema = pageOf(userResponseSchema).meta({
  id: 'UserResponsePage',
});

/** 健康检查响应（`GET /users/health`） */
export const healthStatusSchema = z
  .object({ status: z.literal('ok').describe('固定为 ok；能拿到它就说明进程与路由都活着') })
  .meta({ id: 'HealthStatus' });



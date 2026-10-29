import { z } from 'zod';

/**
 * 权限码的请求侧格式。
 *
 * 形如 `资源:动作`（`user:read`、`login-log:read`）。**不接受通配 `*`**：
 * 通配是超级管理员的保留码，由种子迁移授予；通过管理端发出去等于一键造出
 * 第二个超级管理员，而且事后从授权列表里看不出它意味着"全部"。
 *
 * 只校验形状，不校验存在性 —— 权限码是库里的数据（`pnpm perm:sync` 写入），
 * 是否已配置由 service 查库后回答（未配置的码给 409 而不是 400）。
 */
const permissionCodeSchema = z
  .string()
  .max(64, { error: '权限码最长 64 字符' })
  .regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, {
    error: '权限码格式应为「资源:动作」，如 user:read；通配 * 不能通过接口授予',
  })
  .describe('权限码，形如 user:read');

/**
 * 设置某个角色的权限集合。
 *
 * 语义是**整体替换**：传什么就是最终集合，空数组表示收回全部权限。
 * 不做增量（`add` / `remove` 两个字段）的理由与 `UserService.replaceRoles` 相同：
 * 增量要先读现状再算差集，两次读之间有并发写；整体替换的结果可预测。
 */
export const grantRolePermissionsSchema = z.object({
  codes: z
    .array(permissionCodeSchema)
    .max(200, { error: '一次最多设置 200 个权限码' })
    .refine((codes) => new Set(codes).size === codes.length, {
      message: '权限码不能重复',
    })
    .describe('该角色最终的权限码全集（整体替换；空数组表示收回全部权限）'),
});

export type GrantRolePermissionsDto = z.infer<
  typeof grantRolePermissionsSchema
>;

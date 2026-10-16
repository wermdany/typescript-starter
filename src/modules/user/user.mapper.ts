import type { Users } from '../../db/schema/users.schema.js';

/**
 * 对外暴露的用户响应：剔除密码哈希（`Omit` 编译期保证不泄露）。
 */
export type UserResponse = Omit<Users, 'passwordHash'>;

/**
 * Users → UserResponse 手动映射。
 *
 * 说明：未采用全局拦截器剔除（过度魔法）或 select 排除列（加列时易漏），
 * 手动映射显式、类型安全、可复用。
 */
export function toUserResponse(user: Users): UserResponse {
  const { passwordHash: _hash, ...rest } = user;
  return rest;
}

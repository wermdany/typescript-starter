import { users, type Users } from '../../db/schema/users.schema.js';

/**
 * 对外公开字段**白名单**（响应契约的唯一出处）。
 *
 * ## 为什么是白名单而不是 `Omit`
 *
 * 早期实现是 `type UserResponse = Omit<Users, 'passwordHash'>` —— 黑名单的语义是
 * **默认公开、只挡住记得住的列**，于是有三个失败模式：
 *
 * 1. 每处查询都要记得调 `toUserResponse()` 映射，漏一处就裸奔
 * 2. `deletedAt` 这类"不算敏感但也不该对外"的列会静默溜出响应
 * 3. 以后加 `idCardNo` / `phone` 等列，**不改这里就默认泄露，且编译器不会报错**
 *
 * 白名单把这三点一起解决：列的增删改都会在这里编译期暴露（`users.xxx` 不存在即报错），
 * 而**新增 DB 列默认不对外**（安全的那一侧作为默认值）。
 *
 * ## 用法：把它交给 Drizzle，让数据库层就不返回敏感列
 *
 * ```ts
 * this.db.select(userPublicColumns).from(users).where(...)          // → UserResponse[]
 * this.db.insert(users).values(...).returning(userPublicColumns)    // → UserResponse[]
 * this.db.update(users).set(...).returning(userPublicColumns)       // → UserResponse[]
 * ```
 *
 * ⚠️ 因此**不再需要 `toUserResponse()` 这类映射函数**：白名单在 SQL 层生效，TS 从列对象
 * 直接推导出响应类型，"忘了映射"这个失败模式根本不存在。完整理由见 AGENTS.md 第 5 节。
 *
 * ## 三条约束
 *
 * - 需要 `passwordHash` 的场景（登录密码校验）必须**另行显式 select 该列**，不要加进这里
 * - 某接口需要额外字段时**另建一份投影**（如 `{ ...userPublicColumns, deletedAt: users.deletedAt }`），
 *   不要扩展这份公共白名单——公共契约一旦被单个接口撑大，就退化成黑名单了
 * - 新增列时**先问"客户端真的需要吗"**，默认答案是不需要
 */
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  email: users.email,
  nickname: users.nickname,
  role: users.role,
  points: users.points,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

/**
 * 对外用户响应 —— 由白名单的键推导，与 SQL 投影天然同形。
 *
 * `as const` 让 `keyof typeof userPublicColumns` 保持字面量联合，`Pick` 才能收敛到精确字段集。
 */
export type UserResponse = Pick<Users, keyof typeof userPublicColumns>;

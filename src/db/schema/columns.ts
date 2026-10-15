import { timestamp } from 'drizzle-orm/pg-core';

/**
 * 生成每张表通用的时间戳列集合。
 *
 * 返回的是**全新的列实例**，必须作为函数调用后展开使用：
 * ```ts
 * export const users = pgTable('users', {
 *   id: integer().primaryKey().generatedAlwaysAsIdentity(),
 *   ...timestamps(),
 * });
 * ```
 *
 * @remarks
 * **为什么是函数而不是对象常量？**
 * Drizzle 的列 builder 是单次使用的——建表时会把所属表的信息回写进实例。
 * 若导出为共享对象常量并被多张表 `...spread`，同一批实例会被多张表复用，
 * 导致列名错乱、类型推导异常等问题。每次调用生成新实例即可规避。
 *
 * **三个字段的语义**
 * - `createdAt`：插入时由数据库自动填 `now()`，应用层无需传值
 * - `updatedAt`：插入时自动填 `now()`；**更新时不会自动变化**，需配合
 *   数据库触发器（`BEFORE UPDATE`）或应用层手动 `set`，见 `@see`
 * - `deletedAt`：软删除标记，`NULL` 表示未删除。所有业务查询都需带
 *   `IS NULL` 过滤条件
 *
 * @returns 包含 `createdAt` / `updatedAt` / `deletedAt` 三个列定义的普通对象，
 *          供 `pgTable` 的列定义参数展开（spread）使用
 *
 * @example
 * // 基础用法：表级时间戳
 * export const listings = pgTable('listings', {
 *   id: integer().primaryKey().generatedAlwaysAsIdentity(),
 *   price: numeric('price', { precision: 10, scale: 2 }).notNull(),
 *   ...timestamps(),
 * });
 *
 * @example
 * // 查询时过滤已软删除的行
 * import { isNull } from 'drizzle-orm';
 * const aliveUsers = await db.select().from(users).where(isNull(users.deletedAt));
 *
 * @example
 * // 软删除一条记录
 * await db.update(users)
 *   .set({ deletedAt: new Date() })
 *   .where(eq(users.id, userId));
 *
 * @see {@link https://orm.drizzle.team/docs/column-types/pg#timestamp | Drizzle timestamp 文档}
 * @see {@link https://www.postgresql.org/docs/current/datatype-datetime.html | PostgreSQL 日期时间类型}
 */
export const timestamps = () => ({
  /** 创建时间，数据库自动填充 (`DEFAULT now()`)，插入时无需传值 */
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** 更新时间，插入时自动填 `now()`；更新需触发器或应用层手动 set */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** 软删除标记，`NULL` 表示未删除 */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

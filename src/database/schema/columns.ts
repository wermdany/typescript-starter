import { timestamp } from 'drizzle-orm/pg-core';

/**
 * 每张表通用的时间戳列。
 *
 * **必须是函数调用后展开**（`...timestamps()`）：Drizzle 的列 builder 单次使用，
 * 建表时会回写所属表信息，共享对象被多表 spread 会导致列名错乱。
 *
 * - `createdAt` / `updatedAt`：插入时由数据库填 `now()`
 * - `updatedAt` **更新时不会自动变化**，update / softDelete / restore 需手动 set
 * - `deletedAt`：软删除标记，`NULL` 表示未删除
 *
 * @example
 * export const users = pgTable('users', {
 *   id: integer().primaryKey().generatedAlwaysAsIdentity(),
 *   ...timestamps(),
 * });
 */
export const timestamps = () => ({
  /** 创建时间，数据库自动填充 (`DEFAULT now()`) */
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** 更新时间，插入时自动填 `now()`；更新需应用层手动 set */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** 软删除标记，`NULL` 表示未删除 */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

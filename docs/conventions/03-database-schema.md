# 数据库访问与 drizzle schema 规范

> 本文件是 AGENTS.md 第 §8、§15 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 建表、改列、写查询与事务时读这一份。

---

## 8. 数据库与 Drizzle

- 通用列：每张表展开 `...timestamps()`（**必须函数调用**，列 builder 单次使用，共享对象会导致列名错乱）；
  `deletedAt IS NULL` 表示未删除
- **`updatedAt` 不会自动更新**：`update` / `softDelete` / `restore` 手动 `set({ updatedAt: new Date() })`
- **软删除**：所有业务查询带 `isNull(users.deletedAt)`；`restore` 带 `isNotNull`；
  删除/更新时 `where` 也带 `isNull` 以防重复操作
- **pg 错误先解包**：drizzle 把驱动错误包成 `DrizzleQueryError`，原始错误在 `err.cause`，
  读 `code` / `constraint` 前必须先解包（否则 409 会退化成 500）
- **`Pool` 必须挂 `error` 监听器**：空闲连接被掐断时没有监听器会让进程直接退出
- 唯一冲突统一转中文 409（`UserService.handlePgError()`）：`student_no` 列级 unique，
  `email` 由部分唯一索引 `users_email_alive_idx`（仅覆盖未删行）保证，
  因此恢复软删用户可能因 email 冲突 409
- 多表一致性操作用 `DatabaseService.transaction()`，不要手工 BEGIN
- **"一次请求多次写"必须包事务**（判定标准：两个写操作之间存在业务不变量）：
  - 改用户 + 吊销其会话（改密 / 删人）—— 密码已改但旧会话有效、用户已删但 token 有效，
    正是写操作要终止的风险，非原子等于白写
  - 建会话 + 写登录审计 —— 有会话没审计，审计流水出现缺口
  - 吊销全部会话 + 写重放审计 —— 同上
  - 会话上限淘汰 + 插入新会话 —— 并发登录下"查-淘汰-插"三段式会双双判未超限或重复淘汰
- **仓储写方法接受可选 `executor`**（drizzle 事务句柄）：事务外默认用 `this.db`，
  事务内传 `tx` 保证同一连接。用例层这样组合：
  ```ts
  await this.database.transaction(async (tx) => {
    const user = await tx.update(users)...;
    await this.sessions.revokeAllForUser(id, 'password_changed', { executor: tx });
  });
  ```
  不要在事务回调里做 CPU 密集操作（scrypt 哈希在**进事务之前**算好），占用连接的时间
  越短，连接池越健康
- 读多写一且无不变量约束的流程（如列表 + 计数）不需要事务，`paginate()` 的并行查询
  就是无事务的正确形态
- schema 变更后开发期用 `pnpm db:push`，需要留痕再用 `db:generate` + `db:migrate`
- 派生类型用 `typeof users.$inferSelect` / `$inferInsert`，新增 schema 在 `schema/index.ts` 导出

---

---

## 15. Schema 规范（`pgTable` 写法）

所有 `src/database/schema/*.schema.ts` 一律对齐 `users.schema.ts`，不允许各写各的。

### 15.1 骨架

```ts
import { sql } from 'drizzle-orm';
import { integer, index, pgTable, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';
import { users } from './users.schema.js';

export const xxx = pgTable(
  'xxx',                                        // ① 表名：小写 snake_case
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')                  // ② 业务列：显式物理列名
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 100 }).notNull(),
    ...timestamps(),                            // ③ 通用时间戳，必须函数调用展开
  },
  (t) => [                                      // ④ 索引：函数式返回数组
    index('xxx_user_idx').on(t.userId),                  // 外键列省略 _id，见 15.2 第 5 条
  ],
);

export type Xxx = typeof xxx.$inferSelect;      // ⑤ 两个派生类型，命名固定
export type NewXxx = typeof xxx.$inferInsert;
```

### 15.2 硬性规则

1. **显式传物理列名**：`varchar('student_no')`、`integer('points')`、`timestamp('expires_at')`。
   表里每一列都显式写，不依赖 drizzle 的列名推断 —— "有的列传、有的列不传"会让新表与
   `users` 长得不一样。例外只有 `integer().primaryKey()`（与 `users.id` 现状一致）。
2. **列键 camelCase ↔ 物理列 snake_case**，一一对应；派生类型名用 `表名单数`（`users` → `Users`）。
3. **时间戳只来自 `...timestamps()`**（`createdAt` / `updatedAt` / `deletedAt`），
   **禁止**在业务 schema 里手工定义这三个列。必须写成函数调用展开 —— 列 builder 单次使用，
   共享对象会让多表列名错乱。
4. **软删除统一用 `deletedAt`**，不加 `is_deleted` 之类的布尔列；读路径一律 `isNull(deletedAt)`。
5. **索引一律走第三个参数的函数式返回数组**，显式命名：
   - 普通索引 `表名_列名_idx`；**外键列省略 `_id` 后缀**（列 `user_id` → `..._user_idx`，
     与 `users_nickname_idx` 这类非外键的完整列名并存 —— 这是本项目既有 20+ 个索引的一致写法，
     新索引照抄同一模板，不要"补全"成 `..._user_id_idx`）
     （社区对索引命名没有唯一标准，两种模板都常见；这里选与现有库一致的那个 —— 一致性比"更规范"重要，
     改现有索引要动迁移和线上对象，不划算）
   - 部分唯一索引 `表名_列名_alive_idx`，条件写 `sql\`${t.deletedAt} IS NULL\``
   - 列级唯一用 `.unique()`（如 `student_no`），只有"软删后允许复用"才用部分唯一索引
6. **外键**用 `references(() => users.id, { onDelete })`：
   归属类数据（会话、子资源）`'cascade'`；审计类数据（登录日志）`'set null'`，用户删除后仍保留。
7. **枚举**用 `pgEnum('<名>', ['a', 'b'])`，列上显式传列名；
   新增枚举值需要迁移（`ALTER TYPE ... ADD VALUE`）。
   ⚠️ 本项目的角色**不是**枚举列：多角色走 `user_roles` 关联表，`users.role` 与
   `user_role` 枚举已在 `0006` 迁移里删除。需要固定取值集合时优先考虑
   `varchar` + 应用层校验（`ROLE_CODES`），这样加值不需要迁移。
8. 每张表在 `schema/index.ts` 导出；对外字段由 `dto/<domain>.dto.ts` 的列白名单界定，
   **token 哈希、密码哈希永不进白名单**。
9. 改完：`pnpm typecheck` → `pnpm db:generate` → 人工检查迁移 SQL → `pnpm db:migrate`。
   （日常开发**不要**跑 `pnpm build`：`nest build` 会动 `dist/` 并可能干扰正在运行的 watch 进程，
   类型检查一律用 `pnpm typecheck`，见 AGENTS.md 第 4 节）

### 15.3 反例（不要这样写）

```ts
// ❌ 省略列名，和 users 不一致
passwordHash: varchar({ length: 255 }).notNull(),
// ❌ 手工时间戳
createdAt: timestamp('created_at').notNull().defaultNow(),
// ❌ 索引写成对象或省略命名
}, { indexes: [index().on(...)] });
```

---

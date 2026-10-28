import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './columns.js';
import { users } from './users.schema.js';

/**
 * 上传文件表：一行 = 一个存储对象 + 它的归属与元数据。
 *
 * ## 为什么不只靠存储
 *
 * 磁盘/对象存储只认识 key，不知道"谁传的、叫什么、能不能被删"。归属（`owner_id`）
 * 是鉴权的依据，元数据（原始文件名、MIME、大小）是响应的依据 —— 都必须在库里，
 * 否则下载时要么再读一次存储（对象存储还要额外 HEAD 请求），要么干脆丢信息。
 *
 * ## 字段约定
 *
 * - `storage_key` 全局唯一：key 是服务端生成的 uuid 路径，同一 key 不可能对应两份内容
 * - `storage_driver` 记录**写入时**用的驱动。换实现后老行仍指向老驱动，
 *   迁移脚本据此分批搬运，而不是"切换那一刻全部失效"
 * - `original_name` 只用于展示与 `Content-Disposition`，**绝不参与路径拼接**
 * - `size` 用 `integer`：上传上限 10 MB（`upload-policy.ts`），离 2^31 很远；
 *   换成 `bigint` 只会让驱动返回字符串，收益为零
 * - `checksum` 是内容 sha256，用于排查"同一文件重复上传"与校验搬运完整性
 * - 软删除：**行留痕，对象立即删除**。因此删除**不可撤销** —— 保留行是为了审计
 *   与幂等判定（"这条 id 删过了"），不是为了当回收站；读路径一律带 `isNull(deletedAt)`。
 *   真要做回收站，就得让删除接口只打标记、由清理任务在保留期后再删对象
 */
export const files = pgTable(
  'files',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** 上传者；用户被物理删除时一并清理（软删除不走外键） */
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 存储对象键，形如 `2026/10/<uuid>.png`；不含根目录 */
    storageKey: varchar('storage_key', { length: 255 }).notNull().unique(),
    /** 写入时的存储驱动：local / oss */
    storageDriver: varchar('storage_driver', { length: 16 }).notNull(),
    /** 上传时的原始文件名（UTF-8 规范化后），仅用于展示与下载头 */
    originalName: varchar('original_name', { length: 255 }).notNull(),
    /** 服务端判定的 MIME 类型，来自允许清单而非客户端声明 */
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    /** 内容字节数 */
    size: integer('size').notNull(),
    /** 内容 sha256（hex），用于去重排查与搬运校验 */
    checksum: varchar('checksum', { length: 64 }).notNull(),
    ...timestamps(),
  },
  (t) => [
    // 「我的文件」列表的主查询路径：只扫存活行
    index('files_owner_alive_idx')
      .on(t.ownerId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 默认按上传时间倒序
    index('files_created_at_idx').on(t.createdAt),
  ],
);

export type Files = typeof files.$inferSelect;
export type NewFiles = typeof files.$inferInsert;

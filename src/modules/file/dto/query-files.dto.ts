import { z } from 'zod';

import { paginationSchema, trimmedShape } from '@/shared/validation.js';

/**
 * 「我的文件」列表查询参数。
 *
 * 默认按 `createdAt` 降序（与项目"列表默认倒序"的取向一致，但档案类资源的
 * 自然阅读顺序是"最近上传在前"，而 `updatedAt` 在文件上几乎不变化 ——
 * 文件只在软删时更新，用它排序等于按删除时间排，因此这里选 `createdAt`）。
 */
export const queryFilesSchema = paginationSchema.extend(
  trimmedShape({
    sortBy: z
      .enum(['createdAt', 'size', 'originalName'])
      .default('createdAt')
      .describe('排序字段，默认 createdAt（上传时间）'),
    order: z.enum(['asc', 'desc']).default('desc').describe('排序方向，默认降序'),
  }),
);

export type QueryFilesDto = z.infer<typeof queryFilesSchema>;

/**
 * 下载时的呈现方式。
 *
 * `inline` 让浏览器直接预览（图片、PDF 的默认期望），`attachment` 强制下载。
 * 用枚举而不是布尔：query 里的 `?download=false` 是字符串，布尔化要靠额外转换，
 * 而 `disposition=attachment` 与 HTTP 头的取值同形，读代码时不需要翻译。
 */
export const fileContentQuerySchema = z.object({
  disposition: z
    .enum(['inline', 'attachment'])
    .default('inline')
    .describe('`inline` 在浏览器中展示（默认），`attachment` 触发下载'),
});

export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;

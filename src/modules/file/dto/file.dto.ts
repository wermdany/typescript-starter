import { z } from 'zod';

import { files, type Files } from '@/database/schema/files.schema.js';
import { dateSchema, pageOf, schemaFor } from '@/shared/validation.js';

/**
 * 对外文件投影（**响应契约的唯一出处**）。
 *
 * 白名单里刻意不含 `storageKey` / `storageDriver` / `checksum` / `ownerId`：
 * - `storageKey` 暴露存储布局，且换驱动后就失去意义（客户端不该按它拼 URL）
 * - `checksum` 是内部排查手段，对外只是信息泄漏
 * - `ownerId` 恒等于"当前登录用户"，回传它没有信息量
 *
 * `contentPath` 是**派生字段**（不在表里）：它必须是应用内路径而不是存储地址 ——
 * 客户端拿到的链接因此不随存储驱动变化，也不需要知道文件存在哪。
 */
export const filePublicColumns = {
  id: files.id,
  originalName: files.originalName,
  mimeType: files.mimeType,
  size: files.size,
  createdAt: files.createdAt,
} as const;

/** 公开列投影的结果形态 */
export type FileScalars = Pick<Files, keyof typeof filePublicColumns>;

/**
 * 内部读路径需要的额外列（对外不暴露）。
 *
 * 归属判定要 `ownerId`、下载要通过 `storageKey` 定位对象 —— 属于
 * 「单个接口需要额外字段就另建投影」的那一类，不撑大公共白名单。
 */
export const fileAccessColumns = {
  ...filePublicColumns,
  ownerId: files.ownerId,
  storageKey: files.storageKey,
} as const;

/** 内部投影的结果形态 */
export type FileRecord = Pick<Files, keyof typeof fileAccessColumns>;

/** 文件内容的下载路径（应用内路由，需登录且带归属判定） */
export function contentPathOf(id: number): string {
  return `/files/${id}/content`;
}

/** 对外文件响应 = 公开列 + 下载路径 */
export interface FileResponse extends FileScalars {
  contentPath: string;
}

/**
 * 把公开列合成为响应对象。
 *
 * **逐字段挑，不用 spread**：内部读路径传进来的是 `FileRecord`（公开列 + ownerId
 * + storageKey 的超集），`{ ...scalars }` 会把内部列一起带到响应里 —— 这类泄漏
 * 在类型上完全合法（超集可赋给子集），只能靠这里显式列举拦住。
 * 白名单加列而这里没跟上时，`FileResponse` 会缺字段 → `pnpm typecheck` 报错。
 */
export function toFileResponse(scalars: FileScalars): FileResponse {
  const { id, originalName, mimeType, size, createdAt } = scalars;
  return {
    id,
    originalName,
    mimeType,
    size,
    createdAt,
    contentPath: contentPathOf(id),
  };
}

/**
 * `FileResponse` 的文档 schema。
 *
 * 字段与类型手写在这里，`schemaFor<FileResponse>()` 做**双向**锚定：
 * 白名单加减列而这里没跟上、或类型/可空性写错，`pnpm typecheck` 直接红。
 * 描述就地写在字段上（`.describe()`），不另设说明表。
 */
export const fileResponseSchema = schemaFor<FileResponse>()(
  z
    .object({
      id: z.number().int().describe('文件 ID'),
      originalName: z.string().describe('上传时的原始文件名（已规范化为 UTF-8）'),
      mimeType: z.string().describe('服务端判定的 MIME 类型，来自允许清单'),
      size: z.number().int().describe('文件字节数'),
      createdAt: dateSchema.describe('上传时间'),
      contentPath: z
        .string()
        .describe('下载/预览路径（应用内相对路径，需要登录并校验归属）'),
    })
    .meta({ id: 'FileResponse', description: '对外文件投影' }),
);

/** 文件分页列表的文档 schema */
export const filePageSchema = pageOf(fileResponseSchema).meta({
  id: 'FileResponsePage',
});

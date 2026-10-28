/**
 * multipart 上传解析后的文件对象（multer 交给 handler 的形状）。
 *
 * 刻意**不**引用 `Express.Multer.File`：
 * - 那个类型来自 `@types/multer`，为几个字段引入一份全局类型声明不划算
 * - 业务只依赖这 5 个字段，写成最小接口后，将来换解析器（busboy / 平台内置）
 *   也不影响 `upload-policy.ts` 与 `file.service.ts`
 *
 * `buffer` 存在的前提是 memory storage（multer 默认）：本项目先整块读进内存，
 * 因为要算 sha256 与魔数校验。上限 10 MB，内存代价可控；若将来允许大文件，
 * 这里要改成流式（同时校验与清理逻辑都要跟着变）。
 */
export interface UploadedFileLike {
  /** 表单字段名（应等于 `UPLOAD_FIELD_NAME`） */
  readonly fieldname: string;
  /** 客户端提供的原始文件名（**不可信**，只用于展示） */
  readonly originalname: string;
  /** 客户端声明的 MIME 类型（**不可信**，以白名单裁决） */
  readonly mimetype: string;
  /** 字节数（由 multer 统计） */
  readonly size: number;
  /** 文件内容 */
  readonly buffer: Buffer;
}

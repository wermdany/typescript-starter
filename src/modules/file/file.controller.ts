import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiMessage, SkipTransform } from '@/common/api-response/response.decorator.js';
import {
  Authenticated,
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import { ApiFailure } from '@/common/openapi/response.decorator.js';
import { ZodParam, ZodQuery } from '@/common/validation/param.decorator.js';
import { type PageResponse } from '@/shared/common.js';
import {
  filePageSchema,
  fileResponseSchema,
  type FileResponse,
} from './dto/file.dto.js';
import { fileIdParamSchema, type FileIdParam } from './dto/params.dto.js';
import {
  fileContentQuerySchema,
  queryFilesSchema,
  type FileContentQuery,
  type QueryFilesDto,
} from './dto/query-files.dto.js';
import type { UploadedFileLike } from './dto/upload-file.dto.js';
import { FileService } from './file.service.js';
import {
  UPLOAD_FIELD_NAME,
  UPLOAD_MAX_FILE_SIZE_BYTES,
  UPLOAD_MAX_FILE_SIZE_LABEL,
} from './upload-policy.js';

/**
 * multipart 解析器（multer）的配置。
 *
 * - `fileSize` 是**第一道**大小限制（够早就掐断，不用把 100 MB 读进内存再拒绝）；
 *   `upload-policy.ts` 里还会再判一次，因为内部调用绕不过 service
 * - `files: 1` 只接受单文件；多文件上传是另一个接口（多文件要事务、要部分失败语义）
 *
 * 存储引擎用 multer 的默认值（memory）：要算 sha256 与魔数就必须拿到整块内容，
 * 10 MB 上限下内存代价可控。若将来放宽上限，这里要换成流式解析 + 边写边算。
 */
const uploadInterceptor = FileInterceptor(UPLOAD_FIELD_NAME, {
  limits: { fileSize: UPLOAD_MAX_FILE_SIZE_BYTES, files: 1 },
});

/**
 * 文件接口。
 *
 * ## 访问控制
 *
 * 除 `GET /files/all` 外都是 `@Authenticated()`：文件**天然属于某个用户**，
 * 没有匿名读的场景。归属判定在 service（`FileService.loadAccessible`）而不是路由装饰器 ——
 * `@OwnerOrPermission` 比较的是"路径参数 = 自己的 user id"，而这里的 `:id` 是文件 id。
 *
 * 跨用户的能力只有两条，都靠权限码：
 * - 读/删他人文件：service 内 `holdsPermission('file:read' | 'file:delete')`。
 *   `file:read` 由 `GET /files/all` 静态声明，**`file:delete` 目前没有任何路由声明它**，
 *   因此只有持有通配 `*` 的角色（超级管理员）能删他人文件；要给某个角色单独授权时，
 *   先加一条带 `@RequirePermission('file:delete')` 的路由让 `pnpm perm:sync` 收进权限表
 * - 全量列表：`GET /files/all` 上的 `@RequirePermission('file:read')`
 *
 * ## 两条特殊路由
 *
 * - `GET /files/:id/content` 返回**二进制流**，用 `@SkipTransform()` 跳过响应契约包装
 * - 上传用 multipart，请求体文档手写（`@ZodBody` 只处理 JSON body）
 */
@ApiTags('文件')
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  /**
   * 上传单个文件。
   *
   * 幂等性：**刻意不加** `@Idempotent()`。它的指纹基于 JSON body，而 multipart
   * 的字节流每次边界都不同，重放判定不会命中；同一次上传重试本来就该得到两份记录
   * （或由客户端自己按 checksum 去重），套一层假的幂等只会误导调用方。
   */
  @Authenticated()
  @UseInterceptors(uploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '单文件上传（multipart/form-data）',
    required: true,
    schema: {
      type: 'object',
      required: [UPLOAD_FIELD_NAME],
      properties: {
        [UPLOAD_FIELD_NAME]: {
          type: 'string',
          format: 'binary',
          description: `文件内容，上限 ${UPLOAD_MAX_FILE_SIZE_LABEL}；类型白名单见 upload-policy.ts`,
        },
      },
    },
  })
  @ApiFailure('未提供文件或文件为空', 400)
  @ApiFailure(`文件超过 ${UPLOAD_MAX_FILE_SIZE_LABEL} 上限`, 413)
  @ApiFailure('文件类型不在允许清单，或内容与声明的类型不符', 415)
  @ApiMessage('上传成功')
  @ApiRoute({
    summary: '上传文件',
    description:
      '登录即可上传，文件归属于当前用户；类型与大小由服务端裁决（白名单 + 魔数校验），原始文件名只用于展示',
    data: fileResponseSchema,
  })
  @Post()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<FileResponse> {
    return this.fileService.upload(user, file);
  }

  /** 我的文件列表 */
  @Authenticated()
  @ApiRoute({
    summary: '我的文件列表（分页）',
    description: '只返回当前用户上传且未删除的文件，默认按上传时间降序',
    data: filePageSchema,
  })
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(queryFilesSchema) query: QueryFilesDto,
  ): Promise<PageResponse<FileResponse>> {
    return this.fileService.findAll(user, query);
  }

  /**
   * 全量文件列表（管理视角）。
   *
   * 必须声明在 `@Get(':id')` **之前**：Nest 按声明顺序匹配，`all` 会被 `:id` 抢先命中，
   * 然后在校验管道里变成 400「文件 ID 必须是正整数」。
   */
  @RequirePermission('file:read')
  @ApiRoute({
    summary: '全部文件列表（分页）',
    description: '需要 file:read；不按归属过滤，供管理端清理与审计',
    data: filePageSchema,
  })
  @Get('all')
  findAllVisible(
    @ZodQuery(queryFilesSchema) query: QueryFilesDto,
  ): Promise<PageResponse<FileResponse>> {
    return this.fileService.findAllVisible(query);
  }

  /** 单个文件的元数据 */
  @Authenticated()
  @ApiRoute({
    summary: '文件元数据',
    description: '只能查看自己上传的文件；他人文件返回 403，不存在或已删除返回 404',
    data: fileResponseSchema,
  })
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', fileIdParamSchema) id: FileIdParam,
  ): Promise<FileResponse> {
    return this.fileService.findOne(user, id);
  }

  /**
   * 下载或预览文件内容。
   *
   * 响应体是**文件字节流**，不是 JSON 契约（`@SkipTransform()`）。
   * 存储实现若返回预签名地址，这里会 302 跳转，客户端拿到的仍是同一份内容 ——
   * 因此客户端只要认 `contentPath` 这一个地址，换存储不用改。
   */
  @SkipTransform()
  @Authenticated()
  @ApiRoute({
    summary: '下载或预览文件',
    description:
      '返回文件二进制流（不包 JSON 契约）；`disposition=attachment` 触发下载，默认 inline 预览',
    data: null,
  })
  @Get(':id/content')
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', fileIdParamSchema) id: FileIdParam,
    @ZodQuery(fileContentQuerySchema) query: FileContentQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const { originalName, read } = await this.fileService.openContent(user, id);

    if (read.kind === 'redirect') {
      // 对象存储实现：把客户端直接导到预签名地址，不占本服务的出口带宽。
      // Nest 见 headersSent 就不再追加响应体，passthrough 下也不会重复发送
      res.redirect(HttpStatus.FOUND, read.url);
      return undefined;
    }

    res.setHeader('Content-Type', read.contentType);
    // 用数据库记录的字节数而不是 stat：两侧不一致时客户端能立刻发现文件被改过
    res.setHeader('Content-Length', String(read.size));
    res.setHeader(
      'Content-Disposition',
      contentDispositionOf(query.disposition, originalName),
    );
    // 阻止浏览器按内容猜类型：白名单里的 text/plain 若被当成 HTML 渲染就是同源 XSS
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(read.stream);
  }

  /** 删除文件（软删记录 + 删存储对象） */
  @Authenticated()
  @ApiMessage('删除成功')
  @ApiRoute({
    summary: '删除文件',
    description: '只能删除自己上传的文件；先软删记录再删存储对象，重复删除返回 404',
    data: null,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam('id', fileIdParamSchema) id: FileIdParam,
  ): Promise<void> {
    return this.fileService.remove(user, id);
  }
}

/**
 * `Content-Disposition` 头。
 *
 * 非 ASCII 文件名必须走 RFC 5987 的 `filename*`：直接拼进 `filename="..."`
 * 会让中文名在浏览器里变成乱码或被丢弃。同时保留 `filename=` 的 ASCII 兜底
 * 对现代浏览器没有意义（它们都优先读 `filename*`），因此不再手写。
 */
function contentDispositionOf(
  disposition: 'inline' | 'attachment',
  filename: string,
): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename*=UTF-8''${encoded}`;
}

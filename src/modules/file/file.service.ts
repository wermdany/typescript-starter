import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm';

import { formatError } from '@/common/logging/error-format.js';
import {
  STORAGE,
  StorageObjectMissingError,
  type StoragePort,
  type StorageReadResult,
} from '@/common/storage/storage.contract.js';
import { DatabaseService } from '@/database/database.service.js';
import { files } from '@/database/schema/files.schema.js';
import {
  PERMISSION_CHECKER,
  actorIdOf,
  assertOwnership,
  holdsPermission,
  isSystemActor,
  type Actor,
  type PermissionChecker,
  type PermissionCode,
} from '@/shared/auth.js';
import { paginate, type PageResponse } from '@/shared/common.js';
import {
  fileAccessColumns,
  filePublicColumns,
  toFileResponse,
  type FileRecord,
  type FileResponse,
} from './dto/file.dto.js';
import type { QueryFilesDto } from './dto/query-files.dto.js';
import type { UploadedFileLike } from './dto/upload-file.dto.js';
import {
  UPLOAD_FIELD_NAME,
  assertUploadable,
  buildStorageKey,
  normalizeOriginalName,
} from './upload-policy.js';

/**
 * 文件服务：上传编排、归属判定、元数据查询、删除。
 *
 * ## 只认 `StoragePort`
 *
 * 本文件不出现 `fs`、不出现 OSS SDK、不出现任何路径拼接 —— 存哪儿由
 * `common/storage/storage.module.ts` 的一行绑定决定。换对象存储时这个文件不改。
 *
 * ## 写路径的顺序（两条都不能反）
 *
 * - **上传**：先落存储，再写库。反过来会得到"库里有记录、对象不存在"的行，
 *   客户端点下载就是 500；写库失败时补偿删除对象即可回到一致状态
 * - **删除**：先软删库，再删对象。反过来一旦软删失败，记录就指向不存在的对象；
 *   而删对象失败只是留垃圾，由后续清理任务兜底
 *
 * 这两处都是"数据库事务管不到存储"的必然结果：存储不是事务参与者，
 * 只能用「先做能回滚的那一步 + 补偿」来收口。
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(PERMISSION_CHECKER)
    private readonly permissions: PermissionChecker,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * 上传单个文件。
   *
   * `file` 允许为 `undefined`：multer 在请求里没有该字段时不会报错，
   * 只会把 handler 的参数留空 —— "没传文件"必须由这里翻译成 400，
   * 否则会变成 500（读 `file.size` 时炸）。
   *
   * 首参是 `Actor` 而不是 `AuthenticatedUser`（红线 #12）：内部调用必须显式
   * 传 `systemActor('via ...')`，而系统身份在这里被拒绝 —— 文件的所有者必须是
   * 真实用户，`files.owner_id` 有外键约束，系统身份的 id 不是合法用户。
   */
  async upload(
    actor: Actor,
    file: UploadedFileLike | undefined,
  ): Promise<FileResponse> {
    if (!file) {
      throw new BadRequestException(
        `请提供要上传的文件（表单字段名：${UPLOAD_FIELD_NAME}）`,
      );
    }
    if (isSystemActor(actor)) {
      throw new ForbiddenException('系统身份不能作为文件所有者');
    }

    const rule = assertUploadable(file);
    const key = buildStorageKey(rule);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    await this.storage.put({
      key,
      body: file.buffer,
      contentType: rule.mimeType,
    });

    try {
      const [row] = await this.db
        .insert(files)
        .values({
          ownerId: actorIdOf(actor),
          storageKey: key,
          // 记录写入时的驱动：换实现后可据此分辨老对象该由谁读
          storageDriver: this.storage.driver,
          originalName: normalizeOriginalName(file.originalname),
          // 落库的是白名单裁决后的类型，不是客户端声明的那个
          mimeType: rule.mimeType,
          size: file.size,
          checksum,
        })
        .returning(filePublicColumns);
      return toFileResponse(row);
    } catch (error) {
      // 补偿：库写失败就把刚落的对象删掉，避免存储里堆无主文件。
      // 补偿自身失败只记日志 —— 原始错误必须原样抛出，否则排查时看不到真因
      await this.storage.remove(key).catch((cleanupError: unknown) => {
        this.logger.warn(
          `上传补偿失败，存储中残留 ${key}：${formatError(cleanupError)}`,
        );
      });
      throw error;
    }
  }

  /** 「我的文件」分页列表（软删除不可见） */
  findAll(
    actor: Actor,
    query: QueryFilesDto,
  ): Promise<PageResponse<FileResponse>> {
    return this.listPage(
      and(eq(files.ownerId, actorIdOf(actor)), isNull(files.deletedAt)),
      query,
    );
  }

  /**
   * 全量列表（管理视角，路由上要求 `file:read`）。
   *
   * 这里不再按归属过滤 —— 准入已经在路由的 `@RequirePermission('file:read')` 上，
   * 而 `file:read` 是**跨用户**的读权限，语义上就该看到全部。
   */
  findAllVisible(query: QueryFilesDto): Promise<PageResponse<FileResponse>> {
    return this.listPage(isNull(files.deletedAt), query);
  }

  /** 单个文件的元数据 */
  async findOne(actor: Actor, id: number): Promise<FileResponse> {
    return toFileResponse(await this.loadAccessible(actor, id, 'file:read'));
  }

  /**
   * 打开文件内容。
   *
   * 返回的是**存储层的读取结果**（流 或 重定向），不是字节本身：
   * 本实现给流，对象存储实现通常给预签名地址。控制器按 `kind` 分别处理，
   * 因此"文件存在哪"不会泄漏到路由层。
   *
   * 记录存在但对象丢失（手工删了磁盘文件、迁移漏搬）→ 404「文件内容已丢失」，
   * 不把存储的 `ENOENT` 冒泡成 500：那是数据不一致，不是代码 bug。
   */
  async openContent(
    actor: Actor,
    id: number,
  ): Promise<{ originalName: string; read: StorageReadResult }> {
    const record = await this.loadAccessible(actor, id, 'file:read');
    try {
      const read = await this.storage.read({
        key: record.storageKey,
        contentType: record.mimeType,
        size: record.size,
      });
      return { originalName: record.originalName, read };
    } catch (error) {
      if (error instanceof StorageObjectMissingError) {
        throw new NotFoundException('文件内容已丢失');
      }
      throw error;
    }
  }

  /**
   * 删除文件：软删记录 + 删存储对象。
   *
   * **不可撤销**：对象在同一请求里就被删掉了，把 `deletedAt` 置回 null 也下载不到内容。
   * 软删在这里的作用只有两个 —— 审计留痕（谁删的、删的是哪个 key）与幂等判定
   * （"这条 id 已经删过了"），它不是回收站。要可恢复，就得把删对象挪到清理任务里，
   * 代价是删除后的保留期内存储空间不回收。
   *
   * 准入 = 本人 **或** 持有 `file:delete`（管理端清理违规文件）。
   * 只做权限码的话，"持有权限码"等于"可以删所有人的文件"，一个误授权就是批量事故；
   * 只做归属的话，管理员反而删不了别人的文件 —— 两道一起才闭合。
   */
  async remove(actor: Actor, id: number): Promise<void> {
    const record = await this.loadAccessible(actor, id, 'file:delete');
    const now = new Date();
    const [deleted] = await this.db
      .update(files)
      .set({ deletedAt: now, updatedAt: now })
      // where 同时要求未删除，防并发重复删除把"删成功"变成两次
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .returning({ id: files.id });
    if (!deleted) {
      throw new NotFoundException('文件不存在');
    }

    try {
      await this.storage.remove(record.storageKey);
    } catch (error) {
      // 记录已不可见，对象残留只是垃圾：不让它把一次成功的删除变成 500
      this.logger.warn(
        `文件记录已删除，但存储对象删除失败：${record.storageKey}（${formatError(error)}）`,
      );
    }
  }

  /**
   * 分页查询的公共实现：只负责排序与分页数学，过滤条件由调用方给。
   *
   * 抽出来的原因不是"少写几行"，而是**排序字段映射**必须只有一份：
   * `sortBy` 枚举加了新值而这里没跟上时，TS 在索引处就会报错。
   */
  private listPage(
    where: SQL | undefined,
    query: QueryFilesDto,
  ): Promise<PageResponse<FileResponse>> {
    const sortColumn = {
      createdAt: files.createdAt,
      size: files.size,
      originalName: files.originalName,
    }[query.sortBy];
    const orderBy = query.order === 'desc' ? desc(sortColumn) : asc(sortColumn);

    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(filePublicColumns)
          .from(files)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)
          .then((rows) => rows.map(toFileResponse)),
        total: this.db
          .select({ value: count() })
          .from(files)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      query.page,
      query.pageSize,
    );
  }

  /**
   * 读取一条文件记录并判定准入（内部读路径的唯一入口）。
   *
   * 归属判定放在这里而不是路由装饰器：`@OwnerOrPermission` 比对的是
   * "路径参数 = 自己的 user id"，而文件的 `:id` 是文件 id，不是用户 id ——
   * 那条装饰器在这里会变成"只有 id 恰好等于自己 uid 的文件可读"，其余全 403。
   * 路由上因此只要求登录，能不能碰这条记录由本方法回答（service 侧的第二道防线）。
   *
   * 准入 = 本人 **或** 持有 `code`（读用 `file:read`、删用 `file:delete`）。
   */
  private async loadAccessible(
    actor: Actor,
    id: number,
    code: PermissionCode,
  ): Promise<FileRecord> {
    const [record] = await this.db
      .select(fileAccessColumns)
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);
    if (!record) {
      throw new NotFoundException('文件不存在');
    }
    // 404 与 403 的区分是刻意的：文件 id 是自增整数、本身可枚举，藏它没有意义，
    // 而"文件存在但不是你的"对排查越权更清楚
    if (!(await holdsPermission(this.permissions, actor, code))) {
      assertOwnership(actor, record.ownerId, '只能访问自己上传的文件');
    }
    return record;
  }
}

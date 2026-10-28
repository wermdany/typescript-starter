import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import {
  StorageObjectMissingError,
  assertStorageKey,
  type PutObjectInput,
  type ReadObjectInput,
  type StoragePort,
  type StorageReadResult,
  type StoredObject,
} from './storage.contract.js';

/**
 * 本地磁盘实现：文件落在 `FILE_STORAGE_DIR`（默认项目根目录的 `files/`）下。
 *
 * 适合单机部署与开发环境。多实例部署时这个实现**不成立**（各实例写各自的磁盘，
 * 同一份文件换实例就读不到），那时应换成对象存储实现 —— 业务代码无感知。
 *
 * 安全边界只有一条：**所有 key 必须经过 {@link assertStorageKey} 与根目录包含性检查**。
 * key 由服务端生成（uuid），但仍然按不可信输入处理：一旦将来允许"自定义路径"
 * 或做数据迁移回灌，这里就是唯一会拦住 `../../etc/passwd` 的地方。
 */
@Injectable()
export class LocalStorage implements StoragePort, OnModuleInit {
  readonly driver = 'local' as const;

  private readonly logger = new Logger(LocalStorage.name);
  /** 存储根目录（绝对路径）；`FILE_STORAGE_DIR` 的相对路径按进程 cwd 解析 */
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = path.resolve(env.FILE_STORAGE_DIR);
  }

  /**
   * 启动时建目录并 fail-fast。
   *
   * 放在这里而不是"第一次上传时再 mkdir"：目录没权限（只读卷、错误的挂载点）
   * 属于部署错误，启动时就该炸，不该等到用户上传到一半才发现。
   */
  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`文件存储目录：${this.root}`);
  }

  /**
   * 写入对象。
   *
   * 先写同目录下的临时文件再 `rename`：`rename` 在同一文件系统内是原子的，
   * 于是读端要么看不到这个 key，要么看到完整内容 —— 不会读到写了一半的图片。
   * 直接 `writeFile(target)` 在大文件下会出现这个中间态。
   */
  async put(input: PutObjectInput): Promise<StoredObject> {
    const target = this.resolvePath(input.key);
    await mkdir(path.dirname(target), { recursive: true });

    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, input.body);
      await rename(temp, target);
    } catch (error) {
      // 失败时清掉临时文件，避免存储目录里堆半截垃圾（清理失败不掩盖原始错误）
      await unlink(temp).catch(() => undefined);
      throw error;
    }

    return { key: input.key, size: input.body.byteLength };
  }

  /** 读取对象：返回可读流，由控制器交给 `StreamableFile` 吐出 */
  async read(input: ReadObjectInput): Promise<StorageReadResult> {
    const target = this.resolvePath(input.key);
    // 先探一次存在性：缺失时抛领域错误，让 service 能翻成 404 而不是 500
    await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new StorageObjectMissingError(input.key);
      }
      throw error;
    });
    return {
      kind: 'stream',
      stream: createReadStream(target),
      // 大小以数据库记录为准：两侧不一致说明文件被外部改动过，
      // 用记录值能让客户端拿到正确的 Content-Length 并暴露问题
      size: input.size,
      contentType: input.contentType,
    };
  }

  /** 删除对象；`ENOENT` 视为成功（删除的目标就是"不存在"） */
  async remove(key: string): Promise<void> {
    await unlink(this.resolvePath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  /**
   * key → 绝对路径。
   *
   * 两道校验：`assertStorageKey` 收紧字符集，这里再确认解析结果仍在根目录之内
   * （防符号链接之外的路径拼接失误）。
   */
  private resolvePath(key: string): string {
    assertStorageKey(key);
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error(`存储 key 越界：${key}`);
    }
    return target;
  }
}

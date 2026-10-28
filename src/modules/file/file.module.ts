import { Module } from '@nestjs/common';

import { FileController } from './file.controller.js';
import { FileService } from './file.service.js';

/**
 * 文件模块。
 *
 * `DatabaseModule` 与 `StorageModule` 都是 @Global，无需 import：
 * 服务拿到的 `STORAGE` 是一个 `StoragePort` 接口，具体实现（本地磁盘 / 对象存储）
 * 由 `common/storage/storage.module.ts` 决定 —— 本模块对"文件存在哪"没有任何声明。
 */
@Module({
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}

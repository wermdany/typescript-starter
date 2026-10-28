import { Global, Module } from '@nestjs/common';

import { LocalStorage } from './local-storage.js';
import { STORAGE } from './storage.contract.js';

/**
 * 文件存储的**装配处**：把端口 `STORAGE` 绑定到一个具体实现。
 *
 * ## 换存储只改这里一行
 *
 * ```ts
 * { provide: STORAGE, useClass: LocalStorage }   // ← 单机磁盘
 * { provide: STORAGE, useClass: OssStorage }     // ← 对象存储
 * ```
 *
 * 业务模块（`modules/file`）注入的一直是 `STORAGE` 这个 token 与 `StoragePort` 这个接口，
 * 因此换实现不会波及上传 / 下载 / 删除三条路径的任何一行代码。
 * 新实现的落地清单见 `storage.contract.ts` 头注释。
 *
 * 为什么是 `@Global`：与 `DatabaseModule` 同理 —— 存储是基础设施，不是某个业务域的能力，
 * 任何模块都可能要用（将来头像、导入导出），逐模块 `imports` 只会制造噪音。
 */
@Global()
@Module({
  providers: [{ provide: STORAGE, useClass: LocalStorage }],
  exports: [STORAGE],
})
export class StorageModule {}

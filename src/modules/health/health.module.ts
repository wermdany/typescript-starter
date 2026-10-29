import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * 健康检查模块（运维能力，与业务域分离）。
 *
 * 独立成模块而不是塞进 `UserModule` 的两个实际收益：
 * - 探活方不需要知道业务域划分，路由在根上
 * - 将来只把业务接口关掉（维护模式）时，健康检查仍是活的 —— 摘掉业务模块的
 *   `imports` 一行不影响这里
 *
 * `DatabaseService` 由 `@Global` 的 `DatabaseModule` 提供，因此不写 `imports`。
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

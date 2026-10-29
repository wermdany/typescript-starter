import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { formatError } from '@/common/logging/error-format.js';
import { DatabaseService } from '@/database/database.service.js';
import type { HealthReadiness, HealthStatus } from './dto/health.dto.js';

/**
 * 健康检查（运维端点，不属于任何业务域）。
 *
 * ## 为什么要拆成两条路由
 *
 * 合成一条是常见的错：要么探了 DB（DB 抖动时编排器把活着的进程一起重启，故障被放大），
 * 要么不探（进程活着但连不上库，流量照旧打进来）。
 * - `check()` 只回答"进程还在跑" → 失败才重启
 * - `ready()` 回答"能接流量吗" → 失败只摘流量，不重启
 *
 * 依赖通过 `DatabaseService`（`@Global`）注入，本模块不 import 任何业务模块。
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly database: DatabaseService) {}

  /** 存活：不产生任何 I/O */
  check(): HealthStatus {
    return { status: 'ok' };
  }

  /**
   * 就绪：探一次数据库。
   *
   * 失败翻译成 503 而不是 500：这是"暂时不可用、可以重试"，不是"代码有 bug"。
   * 原始错误进日志（含 cause 链），响应体只给一句结论 —— 探活接口不该泄漏连接串。
   */
  async ready(): Promise<HealthReadiness> {
    try {
      await this.database.ping();
    } catch (error) {
      this.logger.warn(`就绪检查失败，数据库不可达：${formatError(error)}`);
      throw new ServiceUnavailableException('数据库不可达');
    }
    return { status: 'ok', database: 'ok' };
  }
}

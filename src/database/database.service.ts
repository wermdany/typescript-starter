import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.js';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

import { formatError } from '@/common/logging/error-format.js';
import * as schema from '@/database/schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // 没有 'error' 监听器时，空闲连接被掐断会让 pg 在 Pool 上 emit error，
    // Node 将其升级为 uncaughtException 直接杀进程。连接池本可自愈，只记 warn。
    this.pool.on('error', (err: unknown) => {
      this.logger.warn(
        `数据库空闲连接异常（连接池已剔除该连接，下次请求会重建）：${formatError(err)}`,
      );
    });
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * 启动期探活：失败即启动失败（fail-fast）。
   *
   * 不在这里 catch —— 连不上库的应用起起来也只会给每个请求回 500，
   * 不如让编排器直接看到进程崩溃并重试。
   */
  async onModuleInit() {
    await this.ping();
  }

  /**
   * 单次 `SELECT 1`：启动探活与就绪检查（`modules/health`）共用。
   *
   * 两处的差别不在写法而在语义：启动期只证明"起得来"；运行期才回答
   * "连接池此刻还可不可用" —— DB 重启 / 网络分区时进程照样活着，只有就绪检查能发现。
   */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  /** 事务助手 */
  transaction<T>(
    fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(fn);
  }

  /** 连接池状态 */
  get stats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /** 应用退出时释放连接池 */
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

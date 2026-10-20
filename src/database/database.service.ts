import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

import { formatError } from '@/logger/error-format.js';
import * as schema from '@/database/schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DB_POOL_MAX', 10),
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

  /** 启动时探活，连不上直接启动失败 */
  async onModuleInit() {
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

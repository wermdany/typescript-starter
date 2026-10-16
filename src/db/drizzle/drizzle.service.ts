import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

import { formatError } from '../../logger/error-format.js';
import * as schema from '../schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DrizzleService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DrizzleService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DB_POOL_MAX', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // 空闲连接被网络中断 / DB 重启 / 容器暂停掐断时，pg 会在 Pool 上 emit 'error'。
    // **没有监听器时 Node 会把该事件升级为 uncaughtException，进程直接退出** ——
    // 一次环境抖动就能把服务打死，而这类连接池已自动剔除该连接、本可自愈。
    // 这里只记一条 warn，让下一次请求重建连接。
    this.pool.on('error', (err: unknown) => {
      this.logger.warn(
        `数据库空闲连接异常（连接池已剔除该连接，下次请求会重建）：${formatError(err)}`,
      );
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit() {
    await this.pool.query('SELECT 1');
  }

  /** 事务助手 */
  transaction<T>(
    fn: (tx: NodePgDatabase<typeof schema>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(fn);
  }

  /** 健康检查数据 */
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

import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, appConfig } from './app-config.js';
import { loadEnv, type Env } from './env.js';

/** Env 的 provider token（业务层 `@Inject(ENV)` 注入用） */
export const ENV = Symbol('ENV');

/** loadEnv 的模块级缓存：main.ts 启动时解析一次，本模块复用（process.env 不会变） */
let cachedEnv: Env | undefined;

/** 供 ConfigProviderModule 的工厂取已解析的 env（优先复用 main.ts 的那次） */
export function getEnv(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

/**
 * 配置模块（**配置的统一注入口**）。
 *
 * 两类配置分开存放：
 * - `ENV` → 底层/运维配置（.env 注入，`env.ts` 校验；数据库连接串等原始键名场景使用）
 * - `APP_CONFIG` → 业务配置（写在 `app-config.ts`，与部署环境无关），
 *   业务层 `config.accessTtlMs` 直取，无分组无二次解构
 *
 * 启动时序：`main.ts` 必须先 `loadEnv()`（FileLogger 要在 DI 容器之前就绪），
 * 本模块复用那次解析结果，不会重复读 process.env。
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: getEnv },
    {
      provide: APP_CONFIG,
      useValue: appConfig,
    },
  ],
  exports: [ENV, APP_CONFIG],
})
export class ConfigProviderModule {}

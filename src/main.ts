import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { FileLogger } from './logger/file-logger.js';
import { getLogLevels } from './logger/log-levels.js';
import type { Env } from './config/env.js';

import './config/env.js';

async function bootstrap() {
  // create 阶段：屏蔽启动噪音但保留框架错误/警告（不要 logger: false，会静默致命错误）
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'fatal'],
  });

  const configService = app.get<ConfigService<Env, true>>(ConfigService);

  const logLevel = configService.get('LOG_LEVEL', { infer: true });
  const logFile = configService.get('LOG_FILE', { infer: true });

  app.useLogger(
    new FileLogger({ logLevels: getLogLevels(logLevel), filePath: logFile }),
  );

  await app.listen(configService.get('PORT', { infer: true }));
}

await bootstrap();

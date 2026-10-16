import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { zhCN } from 'zod/locales';

import { AppModule } from './app.module.js';
import {
  describeBoundAddress,
  listAccessibleUrls,
} from './common/startup/local-addresses.js';
import { loadEnv } from './config/env.js';
import { accessLogMiddleware } from './logger/access-log.middleware.js';
import { formatError } from './logger/error-format.js';
import { FileLogger } from './logger/file-logger.js';
import { getLogLevels } from './logger/log-levels.js';
import { registerProcessErrorHandlers } from './logger/process-error.js';
import { traceContextMiddleware } from './logger/trace.middleware.js';

z.config(zhCN());

const startup = new Logger('Bootstrap'); // 与下方 catch 同 context，便于一把 grep

async function bootstrap() {
  const startedAt = performance.now();

  // 日志配置要早于 DI 容器（FileLogger 直接注入 create），故复用同一份 zod schema
  const env = loadEnv();

  const logger = new FileLogger({
    logLevels: getLogLevels(env.LOG_LEVEL),
    filePath: env.LOG_FILE, // 空串 = 只输出控制台
  });

  // 注入 create 而非事后 useLogger：create 阶段的日志早于 useLogger，只有这样才能一并落盘
  const app = await NestFactory.create(AppModule, { logger });

  // ⚠️ 顺序不可换，且都必须早于 listen()：
  // 1) traceContextMiddleware 先建请求上下文（app.use 即时转发，早于 init() 里的 body parser，
  //    才能让 malformed JSON 的 400 / 未命中路由的 404 也拿到 traceId）
  // 2) accessLogMiddleware 紧随其后 —— 它在入口捕获 traceId，供响应收尾时写 access 行；
  //    放到 trace 之前就会丢 traceId
  app.use(traceContextMiddleware);
  app.use(accessLogMiddleware);

  // 进程级兜底要在 logger 接管之后注册，否则 new Logger() 会落到默认 logger
  registerProcessErrorHandlers();
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  // 只借 getUrl() 的协议前缀：它的 host 会把 IPv6 通配 '::' 错映射成 '[::1]'，
  // 局域网地址由 listAccessibleUrls() 自行枚举
  const baseUrl = await app.getUrl();
  const protocol = baseUrl.slice(0, baseUrl.indexOf('://'));

  startup.log(
    `服务已就绪，监听 ${describeBoundAddress(app.getHttpServer().address())}`,
  );

  const accessible = listAccessibleUrls(env.PORT, { protocol });
  for (const { url, label } of accessible) {
    startup.log(`可访问地址：${url}（${label}）`);
  }
  if (accessible.length === 1) {
    startup.log('可访问地址：未检测到局域网 IPv4 网卡，仅本机回环可用');
  }

  startup.log(`启动耗时 ${Math.round(performance.now() - startedAt)}ms`);
}

try {
  await bootstrap();
} catch (err) {
  startup.fatal(`应用启动失败：${formatError(err, { includeStack: true })}`);
  process.exit(1);
}

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { zhCN } from 'zod/locales';

import { loadEnv } from '@/config/env.js';
import { formatError } from '@/logger/error-format.js';
import { FileLogger } from '@/logger/file-logger.js';
import { getLogLevels } from '@/logger/log-levels.js';
import { createApp } from './server.js';
import {
  describeBoundAddress,
  listAccessibleUrls,
} from '@/startup/local-addresses.js';

// 校验报错统一输出中文
z.config(zhCN());

/** 与 catch 块同 context，便于按 `[Bootstrap]` 检索启动相关日志 */
const startup = new Logger('Bootstrap');

async function bootstrap() {
  const startedAt = performance.now();

  // FileLogger 必须早于 DI 容器，只能在这里直接取配置（同一份 envSchema）
  const env = loadEnv();

  const logger = new FileLogger({
    logLevels: getLogLevels(env.LOG_LEVEL),
    filePath: env.LOG_FILE, // 空串 = 只输出控制台
  });

  const app = await createApp(logger);
  await app.listen(env.PORT);

  // 只借 getUrl() 的协议前缀：它的 host 会把 IPv6 通配 '::' 错映射成 '[::1]'
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

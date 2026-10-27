import { Logger, type INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';

import type { Env } from '@/config/env.js';
import { buildOpenApiDocument } from './document.js';

const logger = new Logger('OpenAPI');

/**
 * 是否挂载文档端点。
 *
 * 默认只在 `development` 打开：文档站是直接挂在 express 上的路由，
 * **不经过 `AccessGuard`**（守卫只对 Nest 路由生效），开在生产环境等于
 * 把全量路由、权限码、字段约束公开出去。生产要用就显式设 `SWAGGER_ENABLED=true`，
 * 并且只放在内网或网关后面。
 */
function isOpenApiEnabled(env: Env): boolean {
  return env.SWAGGER_ENABLED || env.NODE_ENV === 'development';
}

/** 去掉首尾斜杠，避免 `//api-docs` 这种路径 */
function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '') || 'api-docs';
}

/**
 * 挂载 Swagger UI 与 OpenAPI JSON。
 *
 * 位置约束：必须在 `registerRequestStages()` 之后、`listen()` 之前调用。
 * 早于 `listen()` 才能随应用一起就绪；晚于中间件注册才能让文档请求也带上 traceId。
 *
 * @param app 尚未 listen 的应用实例
 * @param env 配置对象（整对象注入，不逐键取）
 */
export function setupOpenApi(app: INestApplication, env: Env): void {
  if (!isOpenApiEnabled(env)) {
    return;
  }

  const path = normalizePath(env.SWAGGER_PATH);
  const document = buildOpenApiDocument(app, {
    title: 'typescript-starter API',
    description:
      '统一响应契约：成功 `{ success: true, message, data }`，失败 `{ success: false, message, data: null, errors? }`。\n' +
      '`success` 与 HTTP 状态码同真同假，客户端只需按 `success` / 状态码分支。',
    version: '1.0.0',
    serverUrl: `http://localhost:${env.PORT}`,
  });

  SwaggerModule.setup(path, app, document, {
    jsonDocumentUrl: `${path}/json`,
    yamlDocumentUrl: `${path}/yaml`,
    customSiteTitle: '接口文档',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      // 默认展开列表与详情：接口只有 20 多条，收起反而增加点击
      docExpansion: 'list',
    },
  });

  logger.log(`接口文档已挂载：/${path}（JSON: /${path}/json）`);
}

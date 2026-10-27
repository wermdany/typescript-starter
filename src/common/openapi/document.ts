import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type OperationObject,
} from '@nestjs/swagger';

import { commonErrorResponse } from './errors.js';
import { openApiComponentSchemas } from './json-schema.js';
import { validateOpenApiDocument } from './validate.js';

/** `securitySchemes` 里 bearer 方案的名字：`@ApiBearerAuth(BEARER_SCHEME)` 必须与此一致 */
export const BEARER_SCHEME = 'bearer';

export interface OpenApiDocumentInfo {
  title: string;
  description: string;
  version: string;
  serverUrl: string;
}

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

/**
 * 组装 OpenAPI 文档。
 *
 * 只借 `@nestjs/swagger` 的 `DocumentBuilder` / `createDocument` / `setup`；
 * 字段约束全部来自 zod（`json-schema.ts`），本文件负责两件后处理：
 *
 * 1. **补 500** —— 没有任何装饰器能预知它，只能统一兜底
 * 2. **合并命名模型** —— 装饰器阶段登记进 components 的那些
 *
 * 最后跑一遍 `validateOpenApiDocument()`：缺描述 / 空 schema / 断链直接抛错。
 *
 * ## 响应的显示顺序
 *
 * 期望是「成功 → 业务失败 → 通用失败」，但**协议层做不到**：OpenAPI 的 `responses`
 * 是对象，而 JS 对象的整数键恒定按**数值升序**枚举（`{400: …, 200: …}` 迭代出来也是
 * 200 在前），插入顺序对这类键无效。实际顺序因此是：
 *
 * `2xx → 4xx（按状态码升序）→ 5xx`
 *
 * 这正好也是 OpenAPI 工具链的默认预期，所以不再试图重排。
 */
export function buildOpenApiDocument(
  app: INestApplication,
  info: OpenApiDocumentInfo,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(info.title)
    .setDescription(info.description)
    .setVersion(info.version)
    .addServer(info.serverUrl)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          '`POST /auth/login` 返回的 accessToken。身份与角色每次请求都按会话查库，' +
          '因此改角色、删用户、踢设备对下一次请求立即生效。',
      },
      BEARER_SCHEME,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // 命名 schema 是在装饰器执行时登记的（早于 createDocument），这里合并进 components。
  // 不能依赖 extraModels：那个入口只收 class，收不了 zod schema。
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...openApiComponentSchemas(),
    },
  };

  finalizeOperations(document);

  const violations = validateOpenApiDocument(document);
  if (violations.length > 0) {
    throw new Error(
      `OpenAPI 文档不完整，共 ${violations.length} 处（规范见 docs/conventions/08-contract-layers.md §20.6）：\n` +
        violations.map((item) => `  - ${item}`).join('\n'),
    );
  }

  return document;
}

/** 遍历所有 operation，补上没人能预知的 500 */
function finalizeOperations(document: OpenAPIObject): void {
  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item?.[method] as OperationObject | undefined;
      if (!operation) {
        continue;
      }
      operation.responses ??= {};
      if (!operation.responses['500']) {
        const fallback = commonErrorResponse(500);
        operation.responses['500'] = {
          description: fallback.description,
          content: { 'application/json': { schema: fallback.schema } },
        };
      }
    }
  }
}

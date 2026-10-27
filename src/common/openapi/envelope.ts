import type { OpenApiSchema } from './json-schema.js';

/**
 * 响应**信封**的文档描述。
 *
 * 这是接 OpenAPI 时最容易漏、后果最严重的一环：`TransformInterceptor` 与
 * `HttpExceptionFilter` 决定真实 wire format，handler 的返回值只是 `data` 的内容。
 * 文档若照抄返回值，前端按它生成的 client 会全错。
 *
 * 两条不变量与 `common/api-response/api-response.ts` 一一对应：
 * 成功体只有拦截器产出（`success: true`），失败体只有过滤器产出（`success: false`）。
 */

/**
 * `data` 为空时的描述。
 *
 * OpenAPI 3.0 没有 `null` 类型，只能靠 `nullable` 表达；这里跟 zod 对
 * `z.null()` 的 3.0 输出保持同形，避免渲染器把它当成自由结构。
 */
const NULL_SCHEMA: OpenApiSchema = {
  type: 'string',
  nullable: true,
  enum: [null],
  description: '无返回体时恒为 null',
};

/** 字段级校验错误（`errors[]` 的元素） */
const fieldErrorSchema: OpenApiSchema = {
  type: 'object',
  required: ['path', 'message'],
  properties: {
    path: {
      type: 'string',
      description: '出错字段的点路径；根级为空串',
      example: 'email',
    },
    message: {
      type: 'string',
      description: '该字段的具体错误说明',
      example: '邮箱格式不正确',
    },
  },
};

/**
 * 成功响应信封。
 *
 * @param data `data` 的 schema；传 `null` 表示该接口无返回体（如修改密码）
 * @param messageExample `message` 的示例值，默认 `ok`
 */
export function successEnvelope(
  data: OpenApiSchema | null,
  messageExample = 'ok',
): OpenApiSchema {
  const dataSchema = withDescription(
    data ?? NULL_SCHEMA,
    '业务数据；无返回体的操作恒为 null',
  );

  return {
    type: 'object',
    required: ['success', 'message', 'data'],
    properties: {
      success: {
        type: 'boolean',
        enum: [true],
        description: '成功标识；与 HTTP 状态码（2xx）同真同假',
      },
      message: {
        type: 'string',
        description: '可直接展示给用户的文案（不是机器判据）',
        example: messageExample,
      },
      data: dataSchema,
    },
  };
}

/** `$ref` 不能带兄弟字段，只有内联 schema 才补默认描述 */
function withDescription(
  schema: OpenApiSchema,
  description: string,
): OpenApiSchema {
  if ('$ref' in schema || schema.description) {
    return schema;
  }
  return { ...schema, description };
}

/** 失败响应信封（400 / 401 / 403 / 404 / 409 / 500 共用同一形状） */
export function failureEnvelope(): OpenApiSchema {
  return {
    type: 'object',
    required: ['success', 'message', 'data'],
    properties: {
      success: {
        type: 'boolean',
        enum: [false],
        description: '失败标识；与 HTTP 状态码（4xx / 5xx）同真同假',
      },
      message: {
        type: 'string',
        description: '可直接展示给用户的文案，不是机器判据',
        example: '参数校验失败',
      },
      data: NULL_SCHEMA,
      errors: {
        type: 'array',
        description: '字段级详情；仅参数校验失败（400）时出现',
        items: fieldErrorSchema,
      },
    },
  };
}

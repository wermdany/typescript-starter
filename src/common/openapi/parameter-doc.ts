import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { ZodType } from 'zod';

import { ApiCommonError, ApiFailure } from './response.decorator.js';
import { toOpenApiSchema } from './json-schema.js';

/**
 * 参数的文档描述：把 `@ZodBody` / `@ZodQuery` / `@ZodParam` / `@ZodParams`
 * 手里的同一份 schema 同时交给校验管道与文档。
 *
 * **调用点不需要写 `@ApiBody` / `@ApiQuery` / `@ApiParam`** —— 20 多个 handler 一个都不用改，
 * 因为"参数的形状"只声明了一次。这些函数只被 `common/validation/param.decorator.ts` 调用。
 */

/** 取 zod object 的字段表；非 object schema 属于用法错误，尽早暴露 */
function requireShape(schema: ZodType): Record<string, ZodType> {
  const shape = (schema as { shape?: Record<string, ZodType> }).shape;
  if (!shape) {
    throw new Error(
      'OpenAPI 文档要求 @ZodQuery / @ZodParams 接收 z.object(...)：' +
        'query 与多路径参数需要逐字段展开，无法用单个 schema 描述',
    );
  }
  return shape;
}

/**
 * 字段是否必填。
 *
 * 用 `safeParse(undefined)` 判定而不是读内部标记：`.optional()` 与 `.default()`
 * 都会让"省略该字段"合法，二者在 OpenAPI 里同样是 `required: false`。
 */
function isRequired(schema: ZodType): boolean {
  return !schema.safeParse(undefined).success;
}

/** 请求体文档；空对象能通过校验时（字段全部可选）不标必填，与运行时行为一致 */
export function apiBodyDoc(schema: ZodType): MethodDecorator {
  return ApiBody({
    required: !schema.safeParse({}).success,
    schema: toOpenApiSchema(schema, 'input'),
  });
}

/** query 参数文档：object schema 逐字段展开成独立的 query parameter */
export function apiQueryDoc(schema: ZodType): MethodDecorator {
  const shape = requireShape(schema);
  return applyDecorators(
    ...Object.entries(shape).map(([name, property]) => {
      const documented = toOpenApiSchema(property, 'input');
      return ApiQuery({
        name,
        required: isRequired(property),
        // 描述来自 zod 的 `.describe()`，提到参数层是为了在 UI 里紧跟参数名显示
        ...(documented.description ? { description: documented.description } : {}),
        schema: documented,
      });
    }),
  );
}

/** 单个路径参数文档；带路径参数意味着"按标识取资源"，因此顺带声明 404 */
export function apiParamDoc(key: string, schema: ZodType): MethodDecorator {
  const documented = toOpenApiSchema(schema, 'input');
  return applyDecorators(
    ApiParam({
      name: key,
      required: true,
      ...(documented.description ? { description: documented.description } : {}),
      schema: documented,
    }),
    ApiCommonError(404),
  );
}

/** 多个路径参数文档：object schema 逐字段展开 */
export function apiParamsDoc(schema: ZodType): MethodDecorator {
  const shape = requireShape(schema);
  return applyDecorators(
    ...Object.entries(shape).map(([name, property]) => {
      const documented = toOpenApiSchema(property, 'input');
      return ApiParam({
        name,
        required: true,
        ...(documented.description ? { description: documented.description } : {}),
        schema: documented,
      });
    }),
    ApiCommonError(404),
  );
}

/**
 * 参数校验失败的文档（400 + 字段级 `errors`）。
 *
 * 只有带参数的接口才可能 400，因此由参数装饰器自己挂上，
 * 而不是让每个 controller 都声明一遍。
 */
export function apiValidationFailureDoc(): MethodDecorator {
  return ApiFailure('参数校验失败，`errors` 为字段级详情', 400);
}

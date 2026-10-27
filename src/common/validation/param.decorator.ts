import { Body, Param, Query } from '@nestjs/common';
import type { ZodType } from 'zod';

import {
  apiBodyDoc,
  apiParamDoc,
  apiParamsDoc,
  apiQueryDoc,
  apiValidationFailureDoc,
} from '@/common/openapi/parameter-doc.js';
import {
  createZodValidationPipe,
  type ZodValidationPipeOptions,
} from '@/common/validation/zod-validation.pipe.js';

/**
 * 参数校验装饰器：把「`@Body(...)` + zod 管道」压成一个装饰器。
 *
 * **组合而非重写**：校验逻辑仍然只有 `ZodValidationPipe` 一份（构造走
 * `createZodValidationPipe()`），这里只负责把 schema 与来源（body / query / param）
 * 绑到一起，调用点不出现管道构造；静态 grep 能直接数出"有多少个参数被校验"。
 *
 * **同时是文档的声明点**：同一份 schema 顺带写进 OpenAPI（`common/openapi/parameter-doc.ts`），
 * 因此 20 多个 handler 不需要再写 `@ApiBody` / `@ApiQuery` / `@ApiParam`，
 * 也不会出现"校验改了、文档没跟上"。
 *
 * 与全局管道的区别：zod 管道必须携带自己的 schema，无法无参全局注册，
 * 因此只能按参数声明 —— 这也是"每个参数显式写明 schema"这一约定的来源。
 *
 * @example
 * ```ts
 * create(@ZodBody(createUserSchema) dto: CreateUserDto) {}
 * findAll(@ZodQuery(queryUsersSchema) query: QueryUsersDto) {}
 * findOne(@ZodParam('id', idParamSchema) id: IdParam) {}
 * revoke(@ZodParams(userSessionParamsSchema) params: UserSessionParams) {}
 * ```
 */

/** Nest 的参数装饰器形态（`propertyKey` 对构造参数为 undefined） */
type ParameterTarget = object;
type ParameterKey = string | symbol | undefined;

/**
 * 把一个方法装饰器应用到"当前参数所属的 handler"上。
 *
 * 为什么需要它：`applyDecorators()` 只接受类/方法/属性装饰器，**不接受参数装饰器**，
 * 而这里要在参数位置上同时写两份元数据。参数装饰器执行时方法已在原型上，
 * 因此可以取到描述符并原样应用一次 —— 文档装饰器做的只是 `Reflect.defineMetadata`，
 * 不依赖执行顺序。
 */
function applyToHandler(
  decorator: MethodDecorator,
  target: ParameterTarget,
  key: ParameterKey,
): void {
  if (key === undefined) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  (decorator as (t: object, k: string | symbol, d?: PropertyDescriptor) => void)(
    target,
    key,
    descriptor,
  );
}

/** 请求体校验（严格：不做空值宽恕，只做 schema 层的 trim） */
export const ZodBody = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => {
  const pipe = createZodValidationPipe(schema, options);
  return (target: ParameterTarget, key: ParameterKey, index: number): void => {
    Body(pipe)(target, key, index);
    applyToHandler(apiBodyDoc(schema), target, key);
    applyToHandler(apiValidationFailureDoc(), target, key);
  };
};

/** URL query 校验（唯一宽容通道：空串归一化为"未提供"） */
export const ZodQuery = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => {
  const pipe = createZodValidationPipe(schema, options);
  return (target: ParameterTarget, key: ParameterKey, index: number): void => {
    Query(pipe)(target, key, index);
    applyToHandler(apiQueryDoc(schema), target, key);
    applyToHandler(apiValidationFailureDoc(), target, key);
  };
};

/** 单个路径参数校验（顶层字符串，因此归一化不生效，schema 自己 trim） */
export const ZodParam = <S extends ZodType>(
  key: string,
  schema: S,
  options?: ZodValidationPipeOptions,
) => {
  const pipe = createZodValidationPipe(schema, options);
  return (
    target: ParameterTarget,
    propertyKey: ParameterKey,
    index: number,
  ): void => {
    Param(key, pipe)(target, propertyKey, index);
    applyToHandler(apiParamDoc(key, schema), target, propertyKey);
    applyToHandler(apiValidationFailureDoc(), target, propertyKey);
  };
};

/**
 * 多个路径参数一起校验（生成 `{ id, sessionId }` 这种对象）。
 *
 * 不传 key 时 Nest 传入整个 `req.params` 对象，适合"路由里有多个参数且需要联合校验"。
 */
export const ZodParams = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => {
  const pipe = createZodValidationPipe(schema, options);
  return (target: ParameterTarget, key: ParameterKey, index: number): void => {
    Param(pipe)(target, key, index);
    applyToHandler(apiParamsDoc(schema), target, key);
    applyToHandler(apiValidationFailureDoc(), target, key);
  };
};

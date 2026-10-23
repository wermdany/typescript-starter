import { Body, Param, Query } from '@nestjs/common';
import type { ZodType } from 'zod';

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

/** 请求体校验（严格：不做空值宽恕，只做 schema 层的 trim） */
export const ZodBody = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => Body(createZodValidationPipe(schema, options));

/** URL query 校验（唯一宽容通道：空串归一化为"未提供"） */
export const ZodQuery = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => Query(createZodValidationPipe(schema, options));

/** 单个路径参数校验（顶层字符串，因此归一化不生效，schema 自己 trim） */
export const ZodParam = <S extends ZodType>(
  key: string,
  schema: S,
  options?: ZodValidationPipeOptions,
) => Param(key, createZodValidationPipe(schema, options));

/**
 * 多个路径参数一起校验（生成 `{ id, sessionId }` 这种对象）。
 *
 * 不传 key 时 Nest 传入整个 `req.params` 对象，适合"路由里有多个参数且需要联合校验"。
 */
export const ZodParams = <S extends ZodType>(
  schema: S,
  options?: ZodValidationPipeOptions,
) => Param(createZodValidationPipe(schema, options));

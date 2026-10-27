import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { ZodType } from 'zod';

import { successEnvelope } from './envelope.js';
import { toOpenApiSchema } from './json-schema.js';

/**
 * 一个路由的**文档声明**：这个请求做什么 + 成功时返回什么。
 *
 * 之所以是一个装饰器而不是两个：`summary` / `description` / 响应形状描述的是同一件事
 * （"这个接口对外长什么样"），拆开会让调用点把同一句话写在两个地方。
 *
 * ## 只负责文档
 *
 * 运行时的成功文案仍由 `@ApiMessage()` 单独声明（那是 `TransformInterceptor` 的输入，
 * 不是文档）。两者不共享参数、不互相读取。
 *
 * ## 参数只要三个
 *
 * `status` 不再手写：从 `@HttpCode()` 推导，没有则按方法取默认值（POST 是 201，其余 200）
 * —— 与 Nest 的实际行为一致，所以文档不会和真实响应脱节。
 *
 * @example
 * ```ts
 * @ApiMessage('创建成功')
 * @ApiRoute({
 *   summary: '创建用户',
 *   description: '管理员专用；带 Idempotency-Key 时重复提交不会建出两个账号',
 *   data: userResponseSchema,
 * })
 * @Post()
 * ```
 *
 * @example 无返回体的接口
 * ```ts
 * @ApiRoute({ summary: '退出登录', description: '幂等；同时清 Cookie', data: null })
 * ```
 */
export interface ApiRouteOptions {
  /** 一句话说明这个请求做什么（显示在接口列表里） */
  summary: string;
  /** 前置条件 / 副作用 / 幂等语义等补充说明 */
  description?: string;
  /** 成功响应的 `data` 形状；`null` 表示无返回体（`data` 恒为 null） */
  data: ZodType | null;
}

/**
 * 声明路由文档。
 *
 * **位置要求**：必须写在 `@Get` / `@Post` 等 HTTP 装饰器**之上**。装饰器自下而上执行，
 * 写在下面时读不到方法元数据 —— 这种情况直接抛错，不会静默生成错误的状态码。
 */
export const ApiRoute = (options: ApiRouteOptions): MethodDecorator => {
  const operation = ApiOperation({
    summary: options.summary,
    ...(options.description ? { description: options.description } : {}),
  });
  // 在装饰器执行期转换：顺带把命名 schema 登记进 components
  const dataSchema = options.data
    ? toOpenApiSchema(options.data, 'output')
    : null;

  return (target, key, descriptor): void => {
    const handler = descriptor?.value;
    if (typeof handler !== 'function') {
      throw new Error(
        `@ApiRoute 只能用在路由 handler 上（${String(key)} 不是方法）`,
      );
    }

    const status = successStatusOf(handler, String(key));
    ApiResponse({
      status,
      description: '成功',
      schema: successEnvelope(dataSchema),
    })(target, key, descriptor);
    operation(target, key, descriptor);
  };
};

/**
 * 成功状态码：`@HttpCode()` 优先，否则按 HTTP 方法取 Nest 的默认值。
 *
 * 取值与 Nest 的 `RouterResponseController` 一致 —— POST 默认 201，其余 200。
 * 因此文档永远等于真实响应，不需要在每个路由上手写 `status`。
 */
function successStatusOf(handler: object, methodName: string): number {
  const explicit = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    handler,
  ) as number | undefined;
  if (typeof explicit === 'number') {
    return explicit;
  }

  const method = Reflect.getMetadata(
    METHOD_METADATA,
    handler,
  ) as RequestMethod | undefined;
  if (method === undefined) {
    throw new Error(
      `@ApiRoute 必须写在 @Get / @Post 等 HTTP 装饰器之上，否则读不到请求方法（${methodName}）`,
    );
  }
  return method === RequestMethod.POST ? 201 : 200;
}

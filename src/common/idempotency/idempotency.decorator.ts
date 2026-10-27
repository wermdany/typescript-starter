import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension, ApiHeader } from '@nestjs/swagger';

import { ApiFailure } from '@/common/openapi/response.decorator.js';

/**
 * `IdempotencyInterceptor` 读取该 metadata 判断路由是否参与幂等。
 *
 * 与 `Idempotency-Key` 请求头是**双条件**：任一缺失就不拦截（见拦截器注释）。
 */
export const IDEMPOTENT_KEY = 'platform:idempotent';

/**
 * 声明这条路由支持 `Idempotency-Key` 重放。
 *
 * 只该加在**非幂等的写接口**上（创建 / 恢复 / 支付 / 提交订单这类"重复执行有副作用"
 * 的路由）。GET / PUT / DELETE 本身幂等，加标记只是多一次内存查找。
 *
 * 不要加在**响应含凭据**的接口上（`/auth/login`、`/auth/refresh`）：
 * 快照只存 `{ status, body }`，不含 `Set-Cookie`；重放会返回一个"没有 Cookie 的登录成功"，
 * 客户端拿到 accessToken 却续不了期 —— 比报错更难查。
 *
 * 文档侧随之带出请求头与 409（同 key 指纹不符）—— 行为与文档在同一个装饰器里声明。
 *
 * @example
 * @Idempotent()
 * @Post()
 */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      required: false,
      description:
        '重放键：同一键重复提交返回首次的响应体，不会重复执行；' +
        '请求体与首次不一致时返回 409。缺省则不做幂等处理。',
    }),
    ApiExtension('x-idempotent', true),
    ApiFailure('同一 Idempotency-Key 的请求体与首次提交不一致', 409),
  );


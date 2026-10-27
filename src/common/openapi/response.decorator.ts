import { ApiResponse } from '@nestjs/swagger';

import { commonErrorResponse, type CommonErrorStatus } from './errors.js';
import { failureEnvelope } from './envelope.js';

/**
 * 失败响应的文档装饰器。
 *
 * 成功侧不在这里 —— 它是 `@ApiRoute` 的一部分（见 `route.decorator.ts`）。
 * 这里只剩"失败"：公共错误（401/403/404/500）走 `ApiCommonError`，文案只有一份；
 * 业务失败（400 校验 / 409 幂等冲突）走 `ApiFailure`，由最了解它的装饰器挂上。
 */

/** 业务失败响应（统一信封）：400 参数校验、409 幂等冲突等 */
export const ApiFailure = (description: string, status = 400) =>
  ApiResponse({ status, description, schema: failureEnvelope() });

/**
 * 公共错误响应：文案与形状取自 `errors.ts`，调用点只挑状态码。
 *
 * @example
 * ApiCommonError(401)
 */
export const ApiCommonError = (status: CommonErrorStatus) =>
  ApiResponse({ status, ...commonErrorResponse(status) });

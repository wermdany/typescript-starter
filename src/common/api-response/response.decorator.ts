import { SetMetadata } from '@nestjs/common';

/**
 * 响应**产物**装饰器：控制响应长什么样，与"放不放行"无关。
 *
 * 两个装饰器原本分散在 `shared/decorators/`，但它们服务的都是同一个产物
 * —— `TransformInterceptor` 的输出 —— 因此合并到 `common/api-response/`。
 */

/** `TransformInterceptor` 读取该 metadata 作为成功响应的 message */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/** `TransformInterceptor` 命中该 metadata 时跳过响应包装 */
export const SKIP_TRANSFORM_KEY = 'skipTransform';

/**
 * 覆盖接口成功响应的 message 文案（默认 `DEFAULT_SUCCESS_MESSAGE` = 'ok'）。
 *
 * 文案会直接展示给用户，请写完整、自足的一句话，不要写成给机器看的短码。
 *
 * @example
 * @ApiMessage('创建成功')
 * @Post()
 */
export const ApiMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);

/**
 * 跳过统一响应契约包装，直接返回 handler 原始结果。
 * 适用于健康检查、文件下载等响应体不是契约 JSON 的特殊端点。
 *
 * 与 `@ApiMessage()` 同时出现时本标记优先（不包装就无所谓 message）。
 *
 * @example
 * @SkipTransform()
 * @Get('download')
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

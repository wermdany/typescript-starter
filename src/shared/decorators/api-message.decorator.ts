import { SetMetadata } from '@nestjs/common';

/** TransformInterceptor 读取该 metadata 作为成功响应的 message */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

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

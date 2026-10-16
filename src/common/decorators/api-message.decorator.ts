import { SetMetadata } from '@nestjs/common';

/** TransformInterceptor 读取该 metadata 作为成功响应的 message */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/**
 * 覆盖接口成功响应的 message 文案（默认 'ok'）。
 *
 * @example
 * @ApiMessage('创建成功')
 * @Post()
 */
export const ApiMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);

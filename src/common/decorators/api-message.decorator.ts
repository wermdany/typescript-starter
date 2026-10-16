import { SetMetadata } from '@nestjs/common';

/** TransformInterceptor 读取该 metadata 作为成功响应的 message */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/**
 * 覆盖接口成功响应的 message 文案（默认 `DEFAULT_SUCCESS_MESSAGE` = 'ok'）。
 *
 * 该文案会**直接展示给用户**（toast），因此请写完整、自足的一句话，
 * 不要写成 "success" / "created" 这类给机器看的短码 —— 客户端禁止按 message
 * 做分支判断（见 api-response.ts 的不变量说明）。
 *
 * @example
 * @ApiMessage('创建成功')
 * @Post()
 */
export const ApiMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);

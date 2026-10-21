import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { HttpExceptionFilter } from './http-exception.filter.js';
import { TransformInterceptor } from './transform.interceptor.js';

/**
 * HTTP 契约子模块：**成功响应包装 + 失败响应转换**的全局注册。
 *
 * 全局组件自注册（APP_* 写在自己这里）——"谁提供了什么全局能力"看本目录就知道，
 * 不需要去应用装配模块里对账。`zod-validation.pipe` 是按参数显式注册的管道，
 * 不走全局机制，因此不在此列。
 */
@Module({
  providers: [
    // 失败契约：所有异常 → { success:false, message, data:null }（唯一失败出口）
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // 成功契约：handler 返回值 → { success:true, message, data }
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class HttpContractModule {}

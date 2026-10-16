import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { envSchema } from './config/env.js';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { RequestLoggingInterceptor } from './logger/request-logging.interceptor.js';

import { DrizzleModule } from './db/drizzle/drizzle.module.js';
import { UserModule } from './modules/user/user.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: envSchema,
    }),
    DrizzleModule,
    UserModule,
  ],
  controllers: [],
  providers: [
    // 拦截器顺序：RequestLogging 保持最外层，Transform 紧随其后（日志统计完整耗时）
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}

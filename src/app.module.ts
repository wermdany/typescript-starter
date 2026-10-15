import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { envSchema } from './config/env.js';

import { RequestLoggingInterceptor } from './logger/request-logging.interceptor.js';

import { DrizzleModule } from './db/drizzle/drizzle.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: envSchema,
    }),
    DrizzleModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}

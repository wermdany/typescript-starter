import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigModule } from './app.config.js';
import { envSchema } from './config/env.js';
import { DatabaseModule } from '@/database/database.module.js';
import { AuthModule } from '@/modules/auth/auth.module.js';
import { UserModule } from '@/modules/user/user.module.js';

@Module({
  imports: [
    // 不能用 `ignoreEnvFile`：那会让 ConfigService 直接读 process.env，schema 的默认值
    // 全部失效（未显式设置的变量拿到 undefined）。环境变量一律经 `envSchema.parse`
    // 产出，与 `main.ts` 的 `loadEnv()` 共用同一份 schema。
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    UserModule,
  ],
})
export class AppModule {}

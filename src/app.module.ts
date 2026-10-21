import { Module } from '@nestjs/common';

import { AppCoreModule } from './app.core.module.js';
import { ConfigProviderModule } from './config/config.module.js';
import { DatabaseModule } from '@/database/database.module.js';
import { AuthModule } from '@/modules/auth/auth.module.js';
import { UserModule } from '@/modules/user/user.module.js';

@Module({
  imports: [
    // 配置统一注入：ENV（底层配置，.env 注入）与 APP_CONFIG（业务配置，app-config.ts）都从这里来
    ConfigProviderModule,
    AppCoreModule,
    DatabaseModule,
    AuthModule,
    UserModule,
  ],
})
export class AppModule {}

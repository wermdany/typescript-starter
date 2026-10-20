import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigModule } from './app.config.js';
import { DatabaseModule } from '@/database/database.module.js';
import { UserModule } from '@/modules/user/user.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    AppConfigModule,
    DatabaseModule,
    UserModule,
  ],
})
export class AppModule {}

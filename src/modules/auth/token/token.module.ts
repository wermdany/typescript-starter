import { Module } from '@nestjs/common';

import { ConfigProviderModule } from '@/config/config.module.js';
import { TokenService } from './token.service.js';

/** 令牌子域：签发与时效（纯计算，不碰数据库） */
@Module({
  imports: [ConfigProviderModule],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}

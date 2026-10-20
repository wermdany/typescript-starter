import { Global, Module } from '@nestjs/common';

import { AuthConfigService } from '@/config/auth.config.js';
import { TokenService } from './token.service.js';

/**
 * 认证配置模块（@Global，全应用唯一）。
 *
 * 放在 token 子域下是它的「最小天然归属」：配置是被所有子域消费的基础件，
 * 而 token 是依赖链的最底端（session、login 都依赖 token）——在这里声明全局导出，
 * 其它子域无需重复 import，也不会形成模块间循环。
 */
@Global()
@Module({
  providers: [AuthConfigService],
  exports: [AuthConfigService],
})
export class AuthConfigModule {}

/** 令牌子域：签发与时效（纯计算，不碰数据库） */
@Module({
  imports: [AuthConfigModule],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}

import { Module } from '@nestjs/common';

import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

/**
 * 用户管理模块。
 *
 * `DatabaseModule` 与 `AuthDependenciesModule` 都是 @Global，无需 import：
 * 用户服务在改密 / 删人后要吊销会话，因此直接注入 `SessionService` 而不是依赖整个认证模块。
 */
@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}

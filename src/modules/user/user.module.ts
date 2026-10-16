import { Module } from '@nestjs/common';

import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

/**
 * 用户管理模块。
 *
 * DrizzleModule 为 @Global，无需在此 import 即可注入 DrizzleService。
 */
@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}

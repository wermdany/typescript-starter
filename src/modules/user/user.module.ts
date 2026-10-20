import { Module } from '@nestjs/common';

import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

/** 用户管理模块（DatabaseModule 为全局模块，无需 import） */
@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}

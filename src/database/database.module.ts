import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

/** 全局数据库模块：其他模块无需 import 即可注入 DatabaseService */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

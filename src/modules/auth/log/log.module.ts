import { Module } from '@nestjs/common';

import { LoginLogController } from './login-log.controller.js';
import { LoginLogService } from './login-log.service.js';

/**
 * 登录审计子域：流水记录、失败限流的数据源、登录记录查询接口。
 *
 * 依赖 login 子域的 `AccountService`（管理员查询前确认目标账号存在）。
 */
@Module({
  controllers: [LoginLogController],
  providers: [LoginLogService],
  exports: [LoginLogService],
})
export class LogModule {}

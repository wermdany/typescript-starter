import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '@/common/auth/access.decorator.js';
import { ApiRoute } from '@/common/openapi/route.decorator.js';
import {
  healthReadinessSchema,
  healthStatusSchema,
  type HealthReadiness,
  type HealthStatus,
} from './dto/health.dto.js';
import { HealthService } from './health.service.js';

/**
 * 健康检查接口。
 *
 * 路径刻意放在根上（`/health`、`/health/ready`）而不是挂到某个业务前缀下：
 * 探活方（k8s、负载均衡、监控）不该知道业务域的划分。
 *
 * 两条都是 `@Public()`：探活方没有账号。但**只暴露这两个字段**，
 * 不返回版本号、连接池大小、依赖拓扑 —— 公开路由上的每一个字段都是侦察材料。
 */
@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** 存活检查：进程与路由活着即可 */
  @Public()
  @ApiRoute({
    summary: '存活检查',
    description: '公开路由；只证明进程与路由存活，不探任何依赖（失败的含义是"该重启了"）',
    data: healthStatusSchema,
  })
  @Get()
  check(): HealthStatus {
    return this.healthService.check();
  }

  /** 就绪检查：探数据库，不可达返回 503 */
  @Public()
  @ApiRoute({
    summary: '就绪检查',
    description: '公开路由；探一次数据库（`SELECT 1`），不可达返回 503（含义是"先摘流量"，不是"该重启"）',
    data: healthReadinessSchema,
  })
  @Get('ready')
  ready(): Promise<HealthReadiness> {
    return this.healthService.ready();
  }
}

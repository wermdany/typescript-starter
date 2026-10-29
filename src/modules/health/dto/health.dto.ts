import { z } from 'zod';

/**
 * 健康检查的两个响应契约。
 *
 * 分开两份 schema 的理由就是分开两条路由的理由：
 * - 存活（liveness）：进程与路由活着。**不碰任何依赖**，挂在这里回答"要不要重启"
 * - 就绪（readiness）：依赖可用。探数据库，失败时由 service 抛 503，因此这里的
 *   成功形状里只可能出现 `ok` —— 不是文档偷懒，而是失败走的是另一条出口
 */

/** 存活检查响应（`GET /health`） */
export const healthStatusSchema = z
  .object({
    status: z
      .literal('ok')
      .describe('固定为 ok；能拿到它就说明进程与路由都活着'),
  })
  .meta({ id: 'HealthStatus', description: '存活检查结果' });

/** 就绪检查响应（`GET /health/ready`） */
export const healthReadinessSchema = z
  .object({
    status: z
      .literal('ok')
      .describe('固定为 ok；数据库不可达时该路由返回 503，而不是这个响应体'),
    database: z.literal('ok').describe('数据库探活结果：`SELECT 1` 已通过'),
  })
  .meta({ id: 'HealthReadiness', description: '就绪检查结果（含依赖探活）' });

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type HealthReadiness = z.infer<typeof healthReadinessSchema>;

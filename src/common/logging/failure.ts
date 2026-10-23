/**
 * 失败摘要：过滤器写入 `res.locals`，访问日志中间件读取并拼成日志行。
 *
 * 这里只放类型与键名，不放逻辑 —— `HttpExceptionFilter` 依赖本文件即可，
 * 不必依赖日志中间件本身（两者都在 `common/logging/`，但方向是单向的）。
 */

/** `res.locals` 上承载失败摘要的键 */
export const FAILURE_LOCALS_KEY = 'accessLogFailure';

/** 失败的结构化事实：原因 + 出错字段路径，文案拼装属日志层 */
export interface AccessLogFailure {
  /** 简短原因：4xx 用响应里的 message；5xx 若是未预期异常则为「未捕获异常：…」 */
  summary: string;
  /** 完整的出错字段路径列表 */
  fields?: string[];
}

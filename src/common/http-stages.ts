import type { NextFunction, Request, Response } from 'express';
import type { INestApplication, InjectionToken, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AccessGuard } from '@/common/auth/access.guard.js';
import { HttpExceptionFilter } from '@/common/api-response/exception.filter.js';
import { TransformInterceptor } from '@/common/api-response/transform.interceptor.js';
import { traceContextMiddleware } from '@/common/context/trace.middleware.js';
import { IDEMPOTENCY_STORE } from '@/common/idempotency/idempotency.contract.js';
import { IdempotencyInterceptor } from '@/common/idempotency/idempotency.interceptor.js';
import { MemoryIdempotencyStore } from '@/common/idempotency/memory-store.js';
import { accessLogMiddleware } from '@/common/logging/access-log.middleware.js';
import { RequestLoggingInterceptor } from '@/common/logging/request-logging.interceptor.js';

/**
 * # HTTP 阶段装配 —— **一个文件看完 5 个阶段**
 *
 * 拦截器 / 守卫 / 过滤器的顺序由下面数组的字面量顺序确定，不依赖"哪个模块先被
 * import"这种隐式事实。回答"重放请求会不会先被包装"这类问题只看本文件。
 *
 * ## 分层不变式（新增 `common/*` 代码前先读这里）
 *
 * `common/{auth,api-response,validation,context,logging,idempotency}/*` 允许依赖
 * `@nestjs/*`、express、zod、rxjs 与 Node 内置模块；
 * **禁止** import `@/modules/*`、`@/logger/*`、`@/shared/*`、`@/database/*`。
 * 理由：`common` 是被所有业务模块使用的横切层，一旦反向依赖业务代码，
 * `bootstrap.spec.ts` 里的整条 HTTP 链路就会变成循环依赖。
 *
 * `common/context/*` 额外要求**不 import `@nestjs/common` 的运行时**：
 * `logger/file-logger.ts` 要单向引用它，而 FileLogger 必须先于 DI 容器构造出来。
 *
 * ## 为什么 P1 中间件不能进这个模块的 providers（重要）
 *
 * `traceContextMiddleware` / `accessLogMiddleware` / `cookieParser` / 认证中间件
 * 只能在 `createApp()` 里用 `app.use()` 即时挂载，**不能**写成 `NestModule.configure()`：
 *
 * - `app.use()` 是即时挂载，调用时立刻排到 Express 中间件栈上（早于 `listen()`）
 * - `configure()` 要等 `app.init()` 才执行，而 Nest 在 `init()` 内部**先**注册
 *   Express 内置 body parser 与路由，**后**才跑 `configure()`
 * - 结果：走 provider 的 trace 中间件会排在 body parser 之后 ⇒
 *   malformed JSON 的 400（body parser 抛的）与未匹配路由的 404（路由表兜底）
 *   都拿不到 traceId
 *
 * 这不是理论推测：`docs/conventions/07-pitfalls.md` 有实测记录，
 * `src/__tests__/bootstrap.spec.ts` 的「malformed JSON 带 x-trace-id」与
 * 「未命中路由的 404 带 x-trace-id」两条用例把它锁成了回归断言。
 *
 * 因此本文件同时导出两半：
 * - {@link HTTP_STAGE_PROVIDERS} / {@link HTTP_STAGE_DEPENDENCIES}：能走 DI 的守卫 / 拦截器 / 过滤器
 * - {@link registerRequestStages}：只能即时挂载的 4 个中间件（顺序写死在函数体里）
 */

/** 阶段名：读代码时先定位"这段逻辑在请求生命周期的哪一段" */
export type HttpStage =
  /** P1：Express 中间件层（早于 body parser；只能 `app.use()`） */
  | 'middleware'
  /** P1.5：守卫（早于管道与拦截器） */
  | 'guard'
  /** P2：拦截器外层（先于内层拿到响应流，可短路内层） */
  | 'interceptor:pre'
  /** P2：拦截器内层（决定响应产物形态） */
  | 'interceptor:post'
  /** P3：过滤器（失败的唯一出口） */
  | 'filter';

/**
 * 一条阶段注册项。
 *
 * `provide` 的类型刻意写成 {@link InjectionToken} 而不是 `unknown`：
 * 否则 `providers: [...HTTP_STAGE_PROVIDERS]` 展开时 typecheck 会红
 * （`Provider.provide` 要求 `InjectionToken`）。
 */
export interface StageProvider {
  /** 该组件在请求生命周期里的位置 */
  readonly stage: HttpStage;
  /** DI token：`APP_*` 表示全局注册，其余为普通 provider */
  readonly provide: InjectionToken;
  /** 实现类 */
  readonly useClass: Type<unknown>;
  /** 为什么放在这个位置 —— 顺序不是自由选择，是正确性要求 */
  readonly note: string;
}

/**
 * 全局阶段注册表：**数组顺序即执行顺序**。
 *
 * 顺序被三条约束钉死：
 * 1. 守卫在最前（P1.5）：未登录的请求不该付出拦截器的成本
 * 2. `RequestLoggingInterceptor` 在 `IdempotencyInterceptor` 之前：body 行必须在
 *    重放短路之前落盘，否则"重放请求没有 body 行"
 * 3. `IdempotencyInterceptor` 在 `TransformInterceptor` 之前：重放时短路内层，
 *    快照体不会被二次包装
 */
export const HTTP_STAGE_PROVIDERS: readonly StageProvider[] = [
  {
    stage: 'guard',
    provide: APP_GUARD,
    useClass: AccessGuard,
    note: '唯一放行闸门：登录态 + 权限码 + 归属三层合一；未声明意图按 authenticated（fail-closed）；本人分支不查权限表，因此权限码解析必须是懒求值（见 common/auth/access.ts）',
  },
  {
    stage: 'interceptor:pre',
    provide: APP_INTERCEPTOR,
    useClass: RequestLoggingInterceptor,
    note: '最外层：LOG_BODY 的 body 行必须在所有短路之前写出，否则幂等重放 / @SkipTransform 之后就没有 body 行可查',
  },
  {
    stage: 'interceptor:pre',
    provide: APP_INTERCEPTOR,
    useClass: IdempotencyInterceptor,
    note: '必须在 Transform 之前：重放时短路内层，快照体不会被二次包装（快照存的本来就是已包装的成功契约体）',
  },
  {
    stage: 'interceptor:post',
    provide: APP_INTERCEPTOR,
    useClass: TransformInterceptor,
    note: '最内层：返回值 → 成功契约；@ApiMessage 覆盖 message、@SkipTransform 跳过包装；不计时不写日志（耗时归 access 中间件）',
  },
  {
    stage: 'filter',
    provide: APP_FILTER,
    useClass: HttpExceptionFilter,
    note: '唯一失败出口：先过错误映射链（HttpException 直通 → PG 23505 → 409），映射不到落 500；只记 5xx（4xx 由 access 行留痕）',
  },
];

/**
 * 阶段**依赖**（不是 `APP_*` 注册项）：保证 {@link HTTP_STAGE_PROVIDERS} 里只有
 * 真正的全局注册，读那张表不会被"业务 provider"打扰。
 *
 * 换存储实现时只改这里的一行 —— 这也是 `note` 要把边界写清楚的原因。
 */
export const HTTP_STAGE_DEPENDENCIES: readonly StageProvider[] = [
  {
    stage: 'interceptor:pre',
    provide: IDEMPOTENCY_STORE,
    useClass: MemoryIdempotencyStore,
    note: '幂等快照存储：单进程内存版（Map + TTL + 条目上限，无定时器）；换 Postgres 只改这一行；多实例部署前必须换掉，否则同 key 落到不同实例会失去幂等',
  },
];

/** Express 风格中间件（`app.use()` 的入参） */
export type RequestMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

/** `registerRequestStages()` 需要的运行时部件（由 `createApp()` 从容器取出后传入） */
export interface RequestStageParts {
  /**
   * 认证中间件：把 accessToken 翻译成 `req.user`。
   *
   * 以函数形式传入而不是在这里 `app.get(XxxService)`：本文件因此不需要知道
   * 认证实现，也不会为了一个中间件把整个 `modules/auth` 拽成 `common` 的依赖。
   */
  readonly authenticate: RequestMiddleware;
}

/**
 * 挂载 P1 中间件（**顺序不可换**）。
 *
 * 1. `traceContextMiddleware` —— 最先：建立请求上下文并回写 `x-trace-id`，
 *    必须早于 body parser，否则 malformed JSON 的 400 没有 traceId
 * 2. `accessLogMiddleware` —— 紧随其后：入口就要捕获 traceId（写日志时恢复上下文），
 *    且要覆盖"到不了拦截器"的 404 / 400
 * 3. `cookieParser()` —— 认证要读 refreshToken Cookie
 * 4. `authenticate` —— 最后：解析 token → `req.user`（守卫在其后读它）
 *
 * 全部必须早于 `app.listen()`：`app.use()` 是即时挂载，晚于初始化就排不到 body parser 前面。
 *
 * @param app Nest 应用实例（尚未 listen）
 * @param parts 运行时部件（认证中间件）
 */
export function registerRequestStages(
  app: INestApplication,
  parts: RequestStageParts,
): void {
  app.use(traceContextMiddleware);
  app.use(accessLogMiddleware);
  app.use(cookieParser());
  app.use(parts.authenticate);
}

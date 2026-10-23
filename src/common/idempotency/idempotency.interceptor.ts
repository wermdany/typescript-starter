import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

import { APP_CONFIG, type AppConfig } from '@/config/app-config.js';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_STORE,
  type IdempotencyScope,
  type IdempotencyStore,
} from '@/common/idempotency/idempotency.contract.js';
import { IDEMPOTENT_KEY } from '@/common/idempotency/idempotency.decorator.js';

/** 幂等键的字符白名单：1..200 个可见 ASCII（不含空格与控制字符） */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,200}$/;

/** 服务端派生键的前缀：与其它 sha256 用途区分开（便于日志里辨认） */
const KEY_PREFIX = 'idem';

/** 指纹不含 actor：actor 已在 `key` 里，重复计入只会让"换人重放"更难排查 */
const FINGERPRINT_SEPARATOR = '|';

/**
 * HTTP 幂等拦截器（`@Idempotent()` + `Idempotency-Key` 头）。
 *
 * ## 生效条件（双条件，缺一不拦）
 *
 * 请求带 `Idempotency-Key` 头 **且** handler 标了 `@Idempotent()`。
 * 任一缺失 → 首行直接 `return next.handle()`，零分配、零 await ——
 * 绝大多数请求不受影响，因此这个拦截器可以安全地全局注册。
 *
 * ## 键与指纹
 *
 * - 键：`sha256('idem|' + actorId + '|' + method + '|' + 路由路径 + '|' + clientKey)`
 *   `actorId` 在最前 ⇒ 同一 key 跨用户不会命中（匿名用 `'anon'`）
 * - 指纹：`sha256(method|url|稳定序列化 body)`
 *   body **只参与哈希、不落库**（可能含密码）；同 key 不同指纹 → 422
 * - header 白名单 `/^[\x21-\x7E]{1,200}$/`，非法 → **400**（不静默忽略：
 *   忽略等于让客户端以为自己有幂等保护，实际上没有）
 *
 * ## 快照时机（为什么挂在 `res.once('finish')`）
 *
 * `@HttpCode(201)` 是拦截器**之后**才 `res.status()` 的，拦截器内读到的
 * `res.statusCode` 永远是 200。只有 `finish` 时刻的 `res.statusCode` 才准。
 * 因此：`finish` 时读状态码 → `status < 400` 则 `complete()`，否则 `release()`；
 * `close` 且 `!writableFinished` 说明客户端中断 → `release()`。**失败不缓存。**
 *
 * ## 并发同 key
 *
 * 后到者立刻 409 + `Retry-After: 1`，**不排队**（排队会把连接池和客户端超时一起拖垮）。
 * 占位 TTL 由 `inFlightTimeoutMs` 控制，超时视为陈旧允许接管（防进程内死锁）。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const rawKey = request.headers[IDEMPOTENCY_HEADER];
    // 头缺失：99% 的请求走这里，直接透传（不建 scope、不 await）
    if (rawKey === undefined) return next.handle();

    const annotated = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 没标注：同上，直接透传
    if (annotated !== true) return next.handle();

    return this.handleIdempotent(context, next, request, rawKey);
  }

  /** 真正参与幂等的分支（只有"头 + 标注"同时成立才会走到） */
  private async handleIdempotent(
    context: ExecutionContext,
    next: CallHandler,
    request: Request,
    rawKey: string | string[],
  ): Promise<Observable<unknown>> {
    // 同名头重复出现时 express 给数组，取第一个（与 traceId 的处理一致）
    const clientKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (typeof clientKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(clientKey)) {
      throw new BadRequestException(
        `${IDEMPOTENCY_HEADER} 必须是 1-200 个可见 ASCII 字符`,
      );
    }

    const response = context.switchToHttp().getResponse<Response>();
    const scope: IdempotencyScope = {
      key: this.deriveKey(request, clientKey),
      fingerprint: deriveFingerprint(request),
      ttlMs: this.config.idempotencyTtlMs,
    };

    const outcome = await this.store.begin(scope);

    if (outcome.kind === 'fingerprint-mismatch') {
      throw new UnprocessableEntityException(
        `${IDEMPOTENCY_HEADER} 已用于内容不同的请求，请换一个新的键`,
      );
    }
    if (outcome.kind === 'in-flight') {
      // 不排队：立刻让客户端重试，避免同 key 请求堆积
      response.setHeader('retry-after', '1');
      throw new ConflictException('相同请求正在处理中，请稍后重试');
    }
    if (outcome.kind === 'replay') {
      response.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      response.status(outcome.status);
      // 预包装好的契约体直接回放；内层 Transform 已被短路（不会被二次包装）
      return of(outcome.body);
    }

    return this.trackCompletion(scope, response, next);
  }

  /**
   * 拿到执行权后：监听响应收尾写快照，同时把 handler 的产出记下来。
   *
   * 捕获 body 用 `tap` 而不是改写 `res.json`：`IdempotencyInterceptor` 在
   * `TransformInterceptor` **之外**，`next.handle()` 发出的已经是包装后的契约体，
   * 因此 `tap` 拿到的就是最终响应体，不必碰 express 的响应方法。
   */
  private trackCompletion(
    scope: IdempotencyScope,
    response: Response,
    next: CallHandler,
  ): Observable<unknown> {
    let capturedBody: unknown;

    response.once('finish', () => {
      const status = response.statusCode;
      if (status >= 400) {
        // 失败不缓存：让客户端能用同一个 key 原样重试
        this.settle('release', () => this.store.release(scope));
        return;
      }
      this.settle('complete', () =>
        this.store.complete(scope, {
          status,
          body: capturedBody === undefined ? null : capturedBody,
        }),
      );
    });

    response.once('close', () => {
      // finish 之后的 close 是正常收尾（writableFinished=true），不重复处理
      if (response.writableFinished) return;
      this.settle('release', () => this.store.release(scope));
    });

    return next.handle().pipe(
      tap((data: unknown) => {
        capturedBody = data;
      }),
    );
  }

  /**
   * 收尾写存储：**失败只记 warn**。
   *
   * 这段跑在响应收尾回调里，抛错会变成 unhandledRejection 直接杀进程；
   * 而"快照没写成功"的最坏后果只是"该 key 可以再执行一次"，不值得让进程退出。
   */
  private settle(action: string, run: () => Promise<void>): void {
    void run().catch((error: unknown) => {
      this.logger.warn(`幂等存储 ${action} 失败：${String(error)}`);
    });
  }

  /** 服务端派生键：actor 在最前，跨用户重放不会命中 */
  private deriveKey(request: Request, clientKey: string): string {
    const actorId = request.user === undefined ? 'anon' : String(request.user.id);
    return sha256(
      [
        KEY_PREFIX,
        actorId,
        request.method,
        routePathOf(request),
        clientKey,
      ].join(FINGERPRINT_SEPARATOR),
    );
  }
}

/** sha256 十六进制摘要（同步、无 key，仅用于标识而非保密） */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 路由路径：优先用路由模板（`/users/:id`），拿不到时退回实际路径。
 *
 * 用模板而不是 `originalUrl`：模板天然不含 query，同一条路由的键才稳定。
 * 路径参数带来的差异由指纹兜住（内容不同 → 422 而不是错误放行）。
 */
function routePathOf(request: Request): string {
  const route = (request as Request & { route?: { path?: unknown } }).route;
  const path = route?.path;
  return typeof path === 'string' ? path : request.path;
}

/** 请求内容指纹：`method|url|稳定序列化 body` */
function deriveFingerprint(request: Request): string {
  return sha256(
    [
      request.method,
      request.originalUrl,
      stableStringify(request.body),
    ].join(FINGERPRINT_SEPARATOR),
  );
}

/**
 * 稳定序列化：对象键按字典序重排后 `JSON.stringify`。
 *
 * 必须稳定：`{a,b}` 与 `{b,a}` 的业务语义相同，键序抖动会让同一份内容算出两个指纹，
 * 表现为"同一个 key 重试却被判 422"。
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value)) ?? 'undefined';
}

/** 递归重排对象键（数组保持顺序：顺序本身是语义） */
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalise(item));
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = normalise(source[key]);
    }
    return sorted;
  }
  return value;
}

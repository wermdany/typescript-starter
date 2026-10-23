/**
 * HTTP 幂等的**纯契约**：请求头名、DI token、作用域/结果类型、存储端口。
 *
 * 分层用意：拦截器只依赖 {@link IdempotencyStore} 端口，具体存储（进程内存 /
 * Postgres / Redis）由 `http-stages.ts` 的一行 provider 决定。
 *
 * 设计边界（按需重新评估，不要默默放宽）：
 * - **只用于"带 `Idempotency-Key` 且显式标注 `@Idempotent()`"的路由**，
 *   不做全局兜底：没标注的接口重复提交是业务语义问题，不该由框架悄悄改写
 * - **失败不缓存**：只有 2xx/3xx 的已包装成功体才会被快照，4xx/5xx 一律释放键，
 *   让客户端能原样重试（缓存一次 500 是最糟的产品行为）
 * - **不缓存响应头 / Cookie / 耗时 / traceId**：重放只重放"业务结果"，
 *   登录态与链路追踪必须由本次请求重新生成
 */

/** 幂等键的请求头名（小写：Node 的 `req.headers` 键恒为小写） */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** 重放响应上标记来源的响应头（`true` 表示这条响应来自快照） */
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';

/** 存储实现的 DI token（实现类由 `http-stages.ts` 的 `HTTP_STAGE_DEPENDENCIES` 提供） */
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/**
 * 一次幂等判定的作用域。
 *
 * `key` 已经把"谁 + 什么方法 + 哪条路由 + 客户端给的键"揉进哈希，
 * 因此 `fingerprint` 只需回答"这次的内容和上次一样吗"。
 */
export interface IdempotencyScope {
  /** 服务端派生键（sha256，已含 actor，跨用户不会命中） */
  readonly key: string;
  /** 请求内容指纹（sha256(method|url|稳定序列化的 body)） */
  readonly fingerprint: string;
  /** 成功快照的保留时长（毫秒） */
  readonly ttlMs: number;
}

/** `begin()` 的四种结果 */
export type IdempotencyOutcome =
  /** 拿到执行权：正常往下走，收尾时 `complete()` / `release()` */
  | { readonly kind: 'acquired' }
  /** 命中成功快照：直接把上次的 `{ status, body }` 回放 */
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  /** 同 key 的首次请求还在处理：不排队，立刻 409 */
  | { readonly kind: 'in-flight' }
  /** 同 key 但内容不同：客户端复用了键，422 */
  | { readonly kind: 'fingerprint-mismatch' };

/**
 * 幂等存储端口。
 *
 * 三个方法必须都是**幂等**的：`complete()` / `release()` 作用在已过期的键上
 * 不得抛错（响应收尾是异步回调，抛错只会变成 unhandledRejection）。
 */
export interface IdempotencyStore {
  /** 申请执行权 / 读快照 */
  begin(scope: IdempotencyScope): Promise<IdempotencyOutcome>;
  /** 写入成功快照（仅 `status < 400` 时由拦截器调用） */
  complete(
    scope: IdempotencyScope,
    snapshot: { readonly status: number; readonly body: unknown },
  ): Promise<void>;
  /** 释放执行权（失败 / 中断 / 无法缓存时调用） */
  release(scope: IdempotencyScope): Promise<void>;
}

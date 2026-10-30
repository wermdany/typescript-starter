import { takeToken, type BucketState } from './token-bucket.js';

/** 被拒日志的最小间隔：限流一旦生效就是每请求一次，逐条 warn 会把日志刷爆 */
const REJECT_LOG_INTERVAL_MS = 10_000;

/** 一次淘汰的比例：淘汰太频繁会白白扫描，太少又挡不住增长 */
const EVICT_RATIO = 0.1;

/** 限流判定结果（含"这条要不要写日志"） */
export interface RateLimitDecision {
  readonly allowed: boolean;
  /** 被拒时建议的重试间隔（毫秒）；放行时为 0 */
  readonly retryAfterMs: number;
  /** 本次被拒是否应当落一条 warn（按时间窗口采样） */
  readonly shouldLog: boolean;
}

/**
 * 进程内的令牌桶集合：`键 → 桶状态`。
 *
 * ## 单进程内存是刻意的
 *
 * 与 `idempotency/memory-store.ts` 同一取向：不引入 Redis，单实例部署下够用，
 * 且不需要为限流单独准备一套基础设施。代价必须写清楚：
 *
 * - **多实例部署时各算各的**：4 个实例意味着实际阈值是配置值的 4 倍。
 *   多实例之前必须把 `buckets` 换成 Redis（`takeToken` 已是纯函数，
 *   换成 `INCRBY` / Lua 后状态可以原样搬过去）
 * - **分布式洪水下会退化**：键数打满 `maxKeys` 后按最久未使用淘汰，
 *   被淘汰的键下次出现时拿到一个满桶 —— 攻击者用海量 IP 可以借此绕过限流。
 *   这是内存方案的固有缺陷，不是可以靠调参修掉的；真遇到要换 Redis
 *
 * ## 为什么用 Map 而不是对象
 *
 * 客户端 IP 是不可信输入，用作对象键会碰到 `__proto__` / `constructor` 这类原型链
 * 污染；`Map` 只认严格相等的键，不存在这个问题。
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private lastRejectLogAt = 0;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxKeys: number,
  ) {}

  /** 结算一次请求（会更新该键的桶状态） */
  take(key: string, now: number): RateLimitDecision {
    const decision = takeToken(
      this.buckets.get(key),
      now,
      this.capacity,
      this.refillPerSecond,
    );

    // 先删再插：Map 的迭代顺序即插入顺序，重新插入等于把它挪到队尾，
    // 淘汰时先丢的就是"最久没动过"的键（近似 LRU）
    this.buckets.delete(key);
    this.buckets.set(key, decision.next);
    if (this.buckets.size > this.maxKeys) {
      this.evict();
    }

    const shouldLog =
      !decision.allowed && now - this.lastRejectLogAt >= REJECT_LOG_INTERVAL_MS;
    if (shouldLog) {
      this.lastRejectLogAt = now;
    }

    return {
      allowed: decision.allowed,
      retryAfterMs: decision.retryAfterMs,
      shouldLog,
    };
  }

  /** 批量淘汰最久未使用的键：一次丢 10%，避免每来一个新键就做一次全量扫描 */
  private evict(): void {
    const drop = Math.ceil(this.maxKeys * EVICT_RATIO);
    let removed = 0;
    for (const key of this.buckets.keys()) {
      if (removed >= drop) break;
      this.buckets.delete(key);
      removed += 1;
    }
  }
}

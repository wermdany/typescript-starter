/**
 * 令牌桶的**纯计算**：给定上次状态与当前时间，判断这一次请求能否放行。
 *
 * ## 为什么是令牌桶
 *
 * - **固定窗口**（每分钟清零）实现最简单，但窗口边界会放过两倍突发：
 *   59 秒打满、61 秒再打满，两个窗口各放 100 次，实际是 2 秒内 200 次
 * - **滑动窗口日志**精确，但要为每个来源保存整段请求时间戳，内存随流量线性增长
 * - **令牌桶**每个来源只存「剩余令牌 + 上次更新时间」，O(1) 且天然平滑，
 *   代价是"长期平均速率"与"瞬时突发"需要分别配置（capacity / refillPerSecond）
 *
 * ## 为什么是无状态函数
 *
 * 状态由调用方持有（内存 Map，将来换 Redis 时也一样）。这样算法可以脱离
 * 时钟与存储单独验证，也不会在函数内部偷偷调用 `Date.now()` 让结果不可复现。
 */

/** 一个来源的桶状态（可安全序列化，便于将来搬到 Redis） */
export interface BucketState {
  /** 当前剩余令牌数，可能带小数（按时间连续补充） */
  readonly tokens: number;
  /** 上次结算的时间戳（毫秒） */
  readonly updatedAt: number;
}

/** 单次判定的结果 */
export interface BucketDecision {
  /** 本次请求是否放行 */
  readonly allowed: boolean;
  /** 结算后的状态，调用方负责写回 */
  readonly next: BucketState;
  /** 被拒时距离下一个令牌的毫秒数；放行时为 0 */
  readonly retryAfterMs: number;
}

/**
 * 取走一个令牌。
 *
 * @param previous 该来源上次的状态；首次出现传 `undefined`（视为满桶）
 * @param now 当前时间戳（毫秒），由调用方传入以保证可测
 * @param capacity 桶容量，决定瞬时突发上限
 * @param refillPerSecond 每秒补充令牌数，决定长期平均速率
 *
 * @example
 * // 容量 2、每秒补 1 个：连续三次请求，第三次被拒且提示约 1 秒后重试
 * takeToken(undefined, 0, 2, 1)   // allowed
 * takeToken(result.next, 0, 2, 1) // allowed
 * takeToken(result.next, 0, 2, 1) // rejected, retryAfterMs ≈ 1000
 */
export function takeToken(
  previous: BucketState | undefined,
  now: number,
  capacity: number,
  refillPerSecond: number,
): BucketDecision {
  // 距上次结算过去了多久，就补多少令牌；上限是桶容量（多余的直接丢弃，
  // 否则空闲一整天会攒出一次"超级突发"）
  const tokens = previous
    ? Math.min(
        capacity,
        previous.tokens +
          ((now - previous.updatedAt) / 1000) * refillPerSecond,
      )
    : capacity;

  if (tokens >= 1) {
    return {
      allowed: true,
      next: { tokens: tokens - 1, updatedAt: now },
      retryAfterMs: 0,
    };
  }

  return {
    allowed: false,
    // 被拒时也要写回 `updatedAt`：否则"一直被打"的键永远停在旧时间戳，
    // 下次结算会一次性补满 —— 相当于把持续攻击变成周期性放行
    next: { tokens, updatedAt: now },
    retryAfterMs: Math.ceil(((1 - tokens) / refillPerSecond) * 1000),
  };
}

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@/config/app-config.js';
import {
  type IdempotencyOutcome,
  type IdempotencyScope,
  type IdempotencyStore,
} from '@/common/idempotency/idempotency.contract.js';

/**
 * 单进程内存版幂等存储。
 *
 * 适用边界（写清楚，避免被当成生产方案）：
 * - **单进程**：多实例部署时同一个 key 会落到不同进程，幂等失效
 *   ⇒ 多实例前必须换成共享存储（Postgres / Redis），**只改
 *   `http-stages.ts` 里 `HTTP_STAGE_DEPENDENCIES` 的那一行**
 * - **无定时器**：TTL 靠惰性 sweep（每次 `begin()` 顺路清理）+ 条目上限淘汰，
 *   进程空闲时不会留下计时器，也不影响优雅退出
 * - **上限按插入序淘汰**：Map 的迭代序即插入序；达到 `maxEntries` 时删最旧的一条，
 *   宁可丢旧快照也不让内存无界增长（丢快照的后果只是"该 key 可以重放一次"）
 */

/** 执行中的占位（还没有可回放的快照） */
interface InFlightEntry {
  readonly kind: 'in-flight';
  readonly fingerprint: string;
  /** 开始时间，用于判定"陈旧占位可被接管" */
  readonly startedAt: number;
}

/** 已完成：`{ status, body }` 快照可回放 */
interface CompletedEntry {
  readonly kind: 'completed';
  readonly fingerprint: string;
  readonly status: number;
  readonly body: unknown;
  /** 快照过期时间戳（`ttlMs` 之后视为新请求） */
  readonly expiresAt: number;
}

type Entry = InFlightEntry | CompletedEntry;

@Injectable()
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly inFlightTimeoutMs: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // 配置项本身已由 zod 校验为正整数，这里只兜住"被人改成 0"的边界
    this.maxEntries = Math.max(1, config.maxEntries);
    this.inFlightTimeoutMs = Math.max(1, config.inFlightTimeoutMs);
  }

  async begin(scope: IdempotencyScope): Promise<IdempotencyOutcome> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.entries.get(scope.key);
    if (existing !== undefined) {
      if (!this.isExpired(existing, now)) {
        // 内容不同 ⇒ 客户端复用了同一个 key，属于用法错误而非重复提交
        if (existing.fingerprint !== scope.fingerprint) {
          return { kind: 'fingerprint-mismatch' };
        }
        if (existing.kind === 'completed') {
          return { kind: 'replay', status: existing.status, body: existing.body };
        }
        return { kind: 'in-flight' };
      }
      // 过期（快照超 TTL / 占位超时）：视为陈旧，允许接管
      this.entries.delete(scope.key);
    }

    this.admit(scope.key, {
      kind: 'in-flight',
      fingerprint: scope.fingerprint,
      startedAt: now,
    });
    return { kind: 'acquired' };
  }

  async complete(
    scope: IdempotencyScope,
    snapshot: { readonly status: number; readonly body: unknown },
  ): Promise<void> {
    // 先删再插：Map 的插入序即淘汰序，重新插入让该键回到"最新"
    this.entries.delete(scope.key);
    this.admit(scope.key, {
      kind: 'completed',
      fingerprint: scope.fingerprint,
      status: snapshot.status,
      body: snapshot.body,
      expiresAt: Date.now() + scope.ttlMs,
    });
  }

  async release(scope: IdempotencyScope): Promise<void> {
    this.entries.delete(scope.key);
  }

  /** 写入并维持条目上限（插入序淘汰最旧的一条） */
  private admit(key: string, entry: Entry): void {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, entry);
  }

  /** 惰性清扫：不开定时器，代价是只在有请求时回收（对本用途足够） */
  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry, now)) {
        this.entries.delete(key);
      }
    }
  }

  private isExpired(entry: Entry, now: number): boolean {
    return entry.kind === 'completed'
      ? entry.expiresAt <= now
      : now - entry.startedAt > this.inFlightTimeoutMs;
  }
}

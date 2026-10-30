# 消息队列接入 · 方案（v1）

> 目标工程：NestJS 12 + TypeScript 6 + 纯 ESM + PostgreSQL 17 + drizzle-orm + zod v4。
> 本文只出设计与落地清单，不含实现代码的最终版本；代码块是骨架，语义已确定，签名以安装版本的类型定义为准。

---

## 0. 结论速览

| 议题 | 结论 | 一句话理由 |
| --- | --- | --- |
| 后端选型 | **pg-boss**，不用 BullMQ | 复用现有 PG，CI 零改动；BullMQ 要多一个 Redis 服务，成本大于当前收益 |
| 落点 | **`src/common/queue/`**，第 9 个横切功能目录 | 与 `storage/`、`idempotency/` 同构：端口 + 适配器 + 装配处 |
| 是否进 `http-stages.ts` | **不进** | 该文件管 HTTP 请求生命周期；队列是启动期装配，和 `openapi/` 同级 |
| 业务怎么用 | 注入 `JOB_QUEUE` 端口，**不 import pg-boss** | 换 Redis / NATS 只改 `queue.module.ts` 一行 |
| 任务类型安全 | 任务名 → 载荷**映射表** | 新增任务先登记，投递与消费两侧由编译器强制对齐 |
| 原子投递 | 默认**不做** outbox，只在"不可丢"场景补 | 多数任务是可丢的；outbox 多一条轮询链路，starter 不该先背着 |
| 幂等 | **消费者自己负责**，队列不提供 | 至少一次投递是队列的契约，去重是业务语义 |
| traceId | 入队写进载荷，消费时 `runWithTraceId()` 恢复 | 否则 worker 日志全部无链路，排查等于盲人摸象 |
| 配置分工 | `QUEUE_ENABLED` / `QUEUE_CONCURRENCY` 进 env；重试策略进 `app-config.ts` | 沿用项目既有分工：env 管部署，APP_CONFIG 管业务 |
| 首个任务 | `auth.login-failed`（登录失败告警） | 触发点现成、异步不阻塞登录、失败不影响主流程 |
| 预计改动 | 新增 6 文件 + 改 8 处；新增 1 张表 | 见 §9 |

---

## 1. 现状与约束：为什么不能"装个包就完事"

| # | 约束 | 出处 | 对队列设计的影响 |
| --- | --- | --- | --- |
| 1 | `common/**` 禁止 import `@/modules/*`、`@/shared/*`、`@/database/*`、`@/logger/*` | `http-stages.ts` 头注释 | 端口层只能依赖 `@nestjs/*` + Node 内置；**不能**在 `common/queue` 里注入 `DatabaseService` |
| 2 | 本地导入带 `.js`，跨目录用 `@/` | 红线 #2，`convention-audit` | 适配器内部 import pg-boss 是包名，不受影响；跨目录引用必须写别名 |
| 3 | 文件后缀黑名单含 `handler` / `use-case` / `projection` / `policy` | 红线 #3，`file-suffix` 规则 | **消费者不能叫 `xxx.handler.ts`**，用 `xxx.service.ts` |
| 4 | `envSchema` 与 `.env.example` 一一对应 | 红线 #16，`env-example-sync` 规则 | 新增 env 必须两边同时改 |
| 5 | 业务配置不进环境变量 | `app-config.ts` 头注释 | 重试次数、退避、告警阈值写代码里 |
| 6 | 本地不跑 `test` / `build`，CI 是唯一执行者 | 红线 #24，`09-ci.md` | 队列实现的验证靠 `pnpm verify` + 一次真实触发，不写"跑一遍看看" |
| 7 | 单轮需求不写测试 | AGENTS §4 | 内存实现只为可测性存在，不是为了这次写单测 |
| 8 | 日志走 `Logger`，禁止 `console.log` | 红线 #9 | 适配器与消费者都用 `new Logger('Queue')` |
| 9 | 注释只写当前设计与其理由 | 红线 #18 | 本文与代码注释都不写"以前用 BullMQ"这类脉络 |

第 1 条是硬约束，它直接决定了端口层的形状：**队列适配器不能拿 `DatabaseService`**。pg-boss 自己建连接池（`connectionString` 从 `ENV` 取），这恰好匹配；如果选一个必须共享 drizzle 连接的方案，反而要在 `common/` 里破例。

---

## 2. 选型

| | **pg-boss** | BullMQ | in-process（`setTimeout`） |
| --- | --- | --- | --- |
| 额外服务 | 无（复用 PG） | Redis | 无 |
| 新增依赖 | 1 个（纯 JS，无安装脚本） | 3 个（`bullmq` + `ioredis` + `@nestjs/bullmq`） | 0 |
| CI 改动 | **0** | 需在第 09 节的 pipeline 里加 redis service | 0 |
| 持久化 | 是（表） | 是（Redis，需 AOF/RDB 策略） | 否，重启即丢 |
| 重试 / 退避 / 死信 | 有 | 有，且更细（限流、优先级、分组、flow） | 无 |
| 延迟任务 | 有 | 有 | 有，但进程重启失效 |
| 多实例消费 | 有（`SKIP LOCKED`） | 有 | **无**（每个实例各跑一遍） |
| 吞吐 | 千~万/秒级 | 万/秒级 | 受进程限制 |
| 运维成本 | 0（就是一个 schema） | 多一个中间件要备份、要监控 | 0，但不可靠 |

**结论：pg-boss。** 判据不是"哪个更强"，而是"当前规模下哪个总成本最低"。这个项目一天的任务量在万级以下，Redis 唯一能换来的是吞吐与更细的调度，而代价是一条新的故障域、一套新的备份策略、一次 CI 改造。

端口层的价值就在这里：真到需要 BullMQ 的那天，改的是 `queue.module.ts` 的一行 `useClass`，业务侧零改动。

---

## 3. 落点与目录

```
src/common/queue/
  queue.contract.ts     # 纯契约：JobPayloads 映射 + JobQueuePort + JOB_QUEUE token
  queue.module.ts       # @Global 装配处：一行 useClass 决定实现
  pg-boss-queue.ts      # 唯一 import pg-boss 的文件
  memory-queue.ts       # 测试用内存实现（对齐 idempotency/memory-store.ts 的先例）
  __tests__/
    memory-queue.spec.ts
```

**为什么不是 `src/modules/queue/`**：队列不是业务域，任何模块都可能投递；放 `modules/` 会让 `auth` 依赖 `modules/queue`，横向耦合比放 `common/` 更糟。

**为什么 `@Global()`**：与 `StorageModule` 同理 —— 它是基础设施，逐模块 `imports` 只会制造噪音。

**为什么消费者不在 `common/queue/`**：消费者是业务语义（"登录失败要告警"），必须放 `modules/<域>/`。`common/queue/` 只提供"能投递、能消费"的能力，以及一张任务名 → 载荷形状的登记表。

**为什么登记表放契约而不是业务模块**：若把 `JobPayloads` 放 `modules/auth/`，`JobQueuePort` 就得反向 import 业务类型，`common` 的依赖方向立刻破掉。而放 `common/queue/queue.contract.ts` 与 `common/auth/auth.contract.ts`（登录文案契约）是同一套做法：**契约是公共知识，实现才是业务的事**。载荷在这里只声明结构，不 import 任何业务类型。

未登记任务时 `JobName` 为 `never`，`enqueue('typo')` 直接编译不过 —— 这是刻意的 fail-closed。

---

## 4. 端口契约

```ts
// src/common/queue/queue.contract.ts

/**
 * 任务名 → 载荷形状。
 *
 * 新增任务在这里登记一行：投递侧与消费侧都会因此被编译器钉住，
 * 不会出现"发的是 userId、收的是 storageKey"这种只能靠运行时才发现的问题。
 *
 * 载荷只用纯结构类型（不 import 任何 `modules/` 类型）—— 一旦这里出现业务类，
 * `common` 就被业务反向依赖了。
 */
export interface JobPayloads {
  'auth.login-failed': {
    /** 提交登录时用的学号（账号可能不存在，因此不是 userId） */
    readonly studentNo: string;
    /** 命中真实账号时才有；不存在账号的尝试为空 */
    readonly userId?: number;
    readonly ip: string;
    readonly userAgent: string;
    /** 窗口内累计失败次数（含本次） */
    readonly failureCount: number;
    /**
     * 幂等键，**由投递侧生成**（`学号|IP|分钟桶`）。
     *
     * 消费侧不许自己算时间桶：任务重试可能跨分钟，重算会得到不同的键，
     * 唯一约束就失效了。幂等键必须随载荷一起冻结。
     */
    readonly dedupeKey: string;
    /** 投递请求的 traceId，用于把 worker 日志接回原请求 */
    readonly traceId?: string;
  };
}

export type JobName = keyof JobPayloads;

/** 单个任务载荷的取用方式：业务侧需要具名类型时用它，不要再抄一遍结构 */
export type JobPayload<N extends JobName> = JobPayloads[N];

/** 队列实现的 DI token */
export const JOB_QUEUE = Symbol('JOB_QUEUE');

/** 单次投递的覆盖项；不传则用 app-config 的默认策略 */
export interface EnqueueOptions {
  /** 首次投递延迟（毫秒）；用于实现"冷却期"类需求 */
  readonly delayMs?: number;
  /** 覆盖默认重试次数（仅在确有可重试性时降低，不要上调） */
  readonly retries?: number;
}

/**
 * 队列端口。
 *
 * `consume` 的回调**抛错即重试**，正常返回即确认。因此：
 * - 可重试的失败（上游超时、连接被重置）→ 直接抛
 * - 不可重试的失败（参数非法、业务拒绝）→ 捕获后记录并正常返回，否则永远堆积
 */
export interface JobQueuePort {
  /** 打开连接与消费循环；由 Nest 生命周期调用，业务侧不要手动调 */
  start(): Promise<void>;
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options?: EnqueueOptions,
  ): Promise<string>;
  /** 同名任务只能注册一个消费者：重复注册在启动期抛错，不静默覆盖 */
  consume<N extends JobName>(
    name: N,
    concurrency: number,
    fn: (payload: JobPayloads[N]) => Promise<void>,
  ): void;
  /** 优雅关闭：等在飞任务跑完再断开 */
  stop(): Promise<void>;
}
```

三条设计边界（不要默默放宽）：

1. **`enqueue` 不返回"是否成功投递"**，只返回任务 id。投递失败直接抛错，由调用方决定吞掉还是上抛 —— 队列层不该替业务做"失败静默"的决定
2. **`consume` 在 `start()` 之前注册**，`start()` 统一拉起。这样消费者注册顺序与连接建立解耦，单测里可以直接调 `consume` 后断言
3. **不做全局钩子**（onCompleted / onFailed 之类）。需要留痕就在消费者里写，框架层的"全局监听"最后都会变成一堆隐式行为

---

## 5. 三个必须做对的地方

### 5.1 原子性：默认不做 outbox

"业务写库成功、投递失败"会导致任务丢失；反过来"投递成功、事务回滚"会导致任务凭空多出来。彻底解法是 outbox：

```
事务内： INSERT users ... + INSERT outbox_jobs ...
事务外： dispatcher 轮询 → enqueue → 标记 sent_at
```

**但这套东西的代价是常驻一条轮询链路**（或一个定时任务），而绝大多数任务根本不需要它。判断标准只有一条：

| 任务性质 | 例子 | 做法 |
| --- | --- | --- |
| **可丢**（丢了不影响一致性） | 欢迎邮件、缓存失效、埋点、告警 | 事务提交后直接 `enqueue`，失败 `logger.warn` |
| **不可丢**（必须与业务同生共死） | 扣款后发券、下单后扣库存 | 才加 `outbox_jobs` |

本方案**先只做前者**。出现第一个"不可丢"场景时，按 §10 的清单补 outbox，届时不需要改端口。

### 5.2 幂等：消费者自己负责

队列的投递语义是 **at-least-once**，同一个任务被执行两次是正常现象，不是 bug。消费者必须自带幂等，且只有两种可靠做法：

1. **依赖业务唯一约束**：`INSERT ... ON CONFLICT DO NOTHING`，重复执行不产生第二行
2. **依赖状态机**：`UPDATE ... WHERE status = 'pending'`，按受影响行数判断"这次是不是我干的"

不要用"先查再写"：那是 check-then-act，两个 worker 同时查到"没有"就会各写一行。

### 5.3 失败分类：不可重试的错误必须 ack

这是队列落地后最常见的线上事故来源：参数错误被当成可重试错误，任务无限重试直到打满重试次数，然后堆在失败集里没人看。

| 失败类型 | 处理 |
| --- | --- |
| 网络抖动、上游 5xx、数据库连接被重置 | **抛出**，让队列退避重试 |
| 载荷非法（缺字段、类型不对）、业务规则拒绝（"该用户已注销"） | **捕获 → 记 `error` 日志 → 正常返回** |

判断不了的时候按"不可重试"处理：丢一条告警的代价，远小于一个毒消息拖垮整个队列。

---

## 6. traceId 与生命周期

### 6.1 traceId 必须跨进程传递

`common/context/trace.ts` 的 `AsyncLocalStorage` 只在当前进程的异步链里有效。任务从 HTTP 请求投递出去、在另一个 worker 里执行时，上下文已经丢了 —— 不显式传递，worker 的日志就只有 `[traceId=-]`。

做法是把 traceId 写进载荷（而不是 header / metadata）：pg-boss 的 metadata 查询不便，而载荷本来就要过 JSON，多一个字段零成本。

```ts
// 投递侧（在 HTTP 请求内）
await queue.enqueue('auth.login-failed', {
  ...payload,
  traceId: getTraceId(),
});

// 消费侧
queue.consume('auth.login-failed', 5, (p) =>
  // 没有入站 traceId（如定时触发）时生成一个新的，保证 worker 日志至少可聚合
  runWithTraceId(p.traceId ?? randomUUID(), () => this.handle(p)),
);
```

载荷里的 `traceId` 声明为 `string | undefined`：`common/queue` 不能依赖 `common/context` 的运行时，由业务侧负责填。

### 6.2 生命周期

| 时机 | 动作 |
| --- | --- |
| `onModuleInit` | `await queue.start()` —— 必须在 `DatabaseService.onModuleInit`（`SELECT 1`）之后，避免库没起就拿连接串 |
| `onApplicationShutdown` | `await queue.stop()` —— `server.ts` 已 `app.enableShutdownHooks()`，这条链是通的 |
| 关闭超时 | 30s。超过则强断，并在日志里明确写"有 N 个任务被中断"，而不是静默丢弃 |

**不要**在 `main.ts` 里 `process.on('SIGTERM')` 手动收尾：`enableShutdownHooks` 已经在做，两套钩子会互相抢跑。

### 6.3 pg-boss 自己的 schema（重要）

pg-boss 在 `boss.start()` 时会自动创建并迁移自己的 schema（默认 `pgboss`），**不经过 drizzle 迁移**。三个后果：

1. `pnpm db:migrate` 不会建这些表，也不需要建 —— 首次启动时自动完成
2. 数据库账号需要 `CREATE SCHEMA` 权限。生产环境若用受限账号，必须提前授予，否则启动即失败
3. `drizzle-kit generate` 不会感知这些表，因此**不要**把 `pgboss` schema 纳入 drizzle 的 schema 目录，否则会生成删表迁移

`files.storage_driver` 的做法在这里同样适用：把"用的哪个实现"记录下来（`queue_driver` 可选），换实现时能按批迁移在飞任务，而不是切换瞬间全部失效。

---

## 7. 配置分工

按 `env.ts` / `app-config.ts` 的既有分工：

**进 env（随部署环境变化）**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QUEUE_ENABLED` | `false` | 关掉时 `enqueue` 变空操作并 `warn`，消费者不注册。测试环境靠它避免拉起连接池 |
| `QUEUE_CONCURRENCY` | `5` | 单实例同时处理的任务数；与 `DB_POOL_MAX` 是同一类运行参数 |

必须同步写进 `.env.example`，否则 `env-example-sync` 规则红。

**进 `app-config.ts`（业务策略，不随环境变）**

```ts
// ─── 队列 ───
/** 默认可重试次数：2 次足够覆盖瞬时抖动，再多只是在放大故障 */
jobRetries: z.number().int().min(0),
/** 退避基数（毫秒）：第 n 次重试等待 base * 2^(n-1) */
jobRetryDelayMs: z.number().int().positive(),
/** 登录失败告警阈值：窗口内失败达到该次数时投递一次告警 */
loginAlertThreshold: z.number().int().positive(),
```

`loginAlertThreshold` 取值建议为 `loginMaxAttempts` 的一半（当前 10 → 5）：留出余量，让告警在"被限流之前"就发出。

---

## 8. 首个任务：`auth.login-failed`

### 8.1 为什么选它

- **触发点现成**：`login.service.ts:88` 的 `bad_credentials` 分支，已经在写审计流水
- **不影响主流程**：告警失败不能让登录返回 500 —— 天然适合异步
- **有真实价值**：撞库告警是登录模块本来就该有的能力，不是为了验证队列而造的假任务
- **可观测**：跑一次就能在日志里看到完整链路，验证成本最低

### 8.2 触发点（精确到行）

```ts
// src/modules/auth/login/login.service.ts，bad_credentials 分支内
if (!account || !matched) {
  await this.loginLogs.record({ ... failureReason: 'bad_credentials' ... });

  // 复用第 1 步已经查到的 failures，不额外查库。
  // 只在"刚好跨过阈值"时投递：撞库时每秒钟几百次失败，
  // 每次都投递等于用攻击流量把队列打满。
  if (failures + 1 === this.config.loginAlertThreshold) {
    await this.queue
      .enqueue('auth.login-failed', {
        studentNo,
        userId: account?.user.id,
        ip: client.ip,
        userAgent: client.userAgent,
        failureCount: failures + 1,
        // 幂等键在这里定死：消费侧重试跨分钟时，键不能变
        dedupeKey: `${studentNo}|${client.ip}|${minuteBucket(new Date())}`,
        traceId: getTraceId(),
      })
      .catch((err: unknown) => {
        // 告警是旁路：投递失败只 warn，绝不能把 401 变成 500
        this.logger.warn(`登录失败告警投递失败：${formatError(err)}`);
      });
  }

  throw new UnauthorizedException(BAD_CREDENTIALS_MESSAGE);
}
```

`failures + 1 === threshold` 这个等式同时解决了两件事：**每窗口最多告警一次**（计数只增，等号只成立一瞬），以及**不额外查询**。

### 8.3 载荷

形状已在 §4 的 `JobPayloads` 里登记，消费侧直接取别名，**不要**再定义一份（红线 #20 的同一条精神：同一形状只有一处真相）：

```ts
import type { JobPayload } from '@/common/queue/queue.contract.js';

type LoginFailedPayload = JobPayload<'auth.login-failed'>;
```

字段取舍：

- 用 `studentNo` 而不是 `userId` 作主体：账号可能不存在，撞库尝试恰恰是告警最该覆盖的情况，此时没有 `userId`
- 带 `failureCount`：告警正文要写"累计几次"，worker 再去查一次会引入时间差
- `dedupeKey` 必须由投递侧生成并随载荷冻结 —— 见 §4 的注释，这是幂等能不能成立的关键
- `traceId` 可选：定时触发的任务没有入站 traceId，消费侧兜底生成

`minuteBucket(date)` 放在 `@/shared/common.js`（纯函数，与 `paginate` 同级）：

```ts
/** 分钟桶：把时间压成 `YYYYMMDDHHmm`，用于"同分钟内同类事件只留一条"的去重键 */
export function minuteBucket(at: Date): string {
  return at.toISOString().slice(0, 16).replace(/\D/g, '');
}
```

### 8.4 消费者

落点：`src/modules/auth/log/login-alert.service.ts`（**不能**命名为 `*.handler.ts`）。

```ts
@Injectable()
export class LoginAlertService implements OnModuleInit {
  private readonly logger = new Logger('LoginAlert');

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit() {
    this.queue.consume('auth.login-failed', 5, (p) =>
      runWithTraceId(p.traceId ?? randomUUID(), () => this.persist(p)),
    );
  }

  private async persist(p: LoginFailedPayload): Promise<void> {
    // 幂等靠唯一约束：dedupeKey 由投递侧冻结，重试 / 并发 / 重复投递都只会命中 DO NOTHING。
    // 不自己算分钟桶 —— 重试跨分钟会让键变掉，去重直接失效。
    await this.database.db
      .insert(securityAlerts)
      .values({
        kind: 'login_failed',
        studentNo: p.studentNo,
        userId: p.userId ?? null,
        ip: p.ip,
        userAgent: p.userAgent,
        failureCount: p.failureCount,
        dedupeKey: p.dedupeKey,
      })
      .onConflictDoNothing({ target: securityAlerts.dedupeKey });

    this.logger.warn(`登录失败告警：${p.studentNo} 累计 ${p.failureCount} 次`);
  }
}
```

### 8.5 需要新增的表

```ts
// src/database/schema/security-alerts.schema.ts
export const securityAlerts = pgTable(
  'security_alerts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** 告警类型：目前只有 login_failed */
    kind: varchar('kind', { length: 32 }).notNull(),
    studentNo: varchar('student_no', { length: 20 }).notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    ip: varchar('ip', { length: 45 }).notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    failureCount: integer('failure_count').notNull(),
    /** 幂等键（学号|IP|分钟桶），由投递侧生成；消费端依赖它做 ON CONFLICT DO NOTHING */
    dedupeKey: varchar('dedupe_key', { length: 128 }).notNull().unique(),
    ...timestamps(),
  },
  (t) => [index('security_alerts_created_idx').on(t.createdAt)],
);
```

`dedupeKey` 用**分钟桶**而不是"每窗口一次"：worker 重试可能跨秒但不跨分钟，分钟桶足以吸收重复，又不会把真正连续的两次攻击合成一条。桶宽再细（秒级）会让重试重新插入，再粗（小时级）会把不同批次的攻击合并。

### 8.6 失败策略

| 情况 | 处理 |
| --- | --- |
| 写库失败（连接抖动） | 抛错 → 队列退避重试（默认 2 次） |
| 唯一冲突 | `onConflictDoNothing` 吞掉，视为成功（这正是幂等的体现） |
| 重试耗尽 | 落 pg-boss 的失败集，靠 `error` 日志与 `pnpm dev:probe` 的日志尾行发现；不单独做死信表 |
| 队列整体关闭（`QUEUE_ENABLED=false`） | `enqueue` 是空操作，只 `warn`；登录行为完全不变 |

---

## 9. 落地清单

### 9.1 依赖（由你本人执行）

```bash
pnpm add pg-boss
pnpm ignored-builds   # 必须确认 "Automatically ignored" 为 None，否则 CI 干净安装会失败
```

pg-boss 是纯 JS，预期无安装脚本；但按 `09-ci.md` 的教训，这一步不能省 —— 本地 node_modules 已存在时不会触发，只在 CI 的干净安装里炸。

### 9.2 新增文件

| 文件 | 作用 |
| --- | --- |
| `src/common/queue/queue.contract.ts` | `JobPayloads`、`JobQueuePort`、`JOB_QUEUE` |
| `src/common/queue/queue.module.ts` | `@Global()`，一行 `useClass` 装配 |
| `src/common/queue/pg-boss-queue.ts` | 适配器，唯一 import pg-boss 处 |
| `src/common/queue/memory-queue.ts` | 同文件两个导出：`MemoryQueue`（单测，任务立即执行）、`NoopQueue`（`QUEUE_ENABLED=false`，投递只 `warn` 不执行）。语义不同，不要合并成一个类 |
| `src/modules/auth/log/login-alert.service.ts` | 消费者 |
| `src/database/schema/security-alerts.schema.ts` | 表定义 + `index.ts` 导出 |

### 9.3 改动文件

| 文件 | 改什么 |
| --- | --- |
| `src/app.module.ts` | `imports` 加 `QueueModule` |
| `src/config/env.ts` + `.env.example` | `QUEUE_ENABLED`、`QUEUE_CONCURRENCY`（两边同时） |
| `src/config/app-config.ts` | `jobRetries`、`jobRetryDelayMs`、`loginAlertThreshold` |
| `src/modules/auth/login/login.service.ts` | 注入 `JOB_QUEUE`，`bad_credentials` 分支加阈值投递 |
| `src/modules/auth/log/log.module.ts` | 注册 `LoginAlertService` |
| `src/shared/common.ts` | 新增 `minuteBucket()`（纯函数） |
| `src/database/schema/index.ts` | 导出 `securityAlerts` |
| `drizzle/*.sql` | `pnpm db:generate` 产出 `security_alerts` 迁移，**人工看 SQL** |

### 9.4 验证（按 §4 分级，不超过 3 条）

```bash
pnpm verify                                  # typecheck + lint + perm:audit
pnpm db:generate                             # 只看生成的 SQL 是否只含 security_alerts
# 起服务后连续失败 5 次，然后看日志
grep '登录失败告警' logs/app.log
```

判定标准：worker 那行日志的 `[traceId=...]` 与第 5 次登录请求的 `x-trace-id` 一致 —— 这一条同时验证了投递、消费、traceId 恢复三件事。

### 9.5 CI 影响

**零改动。** `09-ci.md` 的 `test` job 已有 pg service，`db:migrate` 之后 `security_alerts` 表就绪；pg-boss 的 schema 由 `boss.start()` 自建。这也是选 pg-boss 的核心理由 —— 选 BullMQ 时要在这里加 redis service 并更新该文档。

---

## 10. 何时补 outbox / 死信表

明确触发条件，避免"以后再说"变成永远不做：

| 机制 | 触发条件 |
| --- | --- |
| `outbox_jobs` 表 + dispatcher | 出现第一个"任务丢失会导致业务不一致"的场景（如支付回调、库存扣减） |
| 死信表 + 告警 | 失败集里的任务超过 50 条，或出现"重试耗尽但无人知晓"的线上问题 |
| 队列指标接入 `/health/ready` | 多实例部署，需要区分"服务活着"与"消费卡住" |
| 换 BullMQ | 单日任务量 > 百万，或需要优先级队列 / 限流 / 任务流编排 |

---

## 11. 与项目红线的对齐

| 红线 | 本方案如何满足 |
| --- | --- |
| #2 导入后缀 / 别名 | 适配器内 import `pg-boss` 是包名；跨目录一律 `@/common/queue/queue.contract.js` |
| #3 文件后缀 | 消费者叫 `login-alert.service.ts`，**不叫** `.handler.ts` |
| #9 日志 | 全部 `new Logger('Queue')` / `new Logger('LoginAlert')` |
| #13 一次请求多次写必须包事务 | 告警是旁路写，不与登录的事务合并；登录原有事务不动 |
| #16 env 同步 | `QUEUE_ENABLED` / `QUEUE_CONCURRENCY` 两边同时改 |
| #18 注释不写历史 | 注释只解释"为什么是这个形状"，不写"之前用什么" |
| #24 测试只在 CI 跑 | 验证靠 `pnpm verify` + 一次真实触发，不本地跑 `test` |

**分层不变式自查**：`common/queue/*` 不得 import `@/modules/*`、`@/shared/*`、`@/database/*`、`@/logger/*`。连接串从 `ENV` 取，因此 `pg-boss-queue.ts` 只依赖 `@/config/config.module.js` 与 `@/config/env.js` —— 与 `database.service.ts` 取 `ENV` 的方式一致，但**不注入** `DatabaseService`。

---

## 12. 未决事项

1. **pg-boss 的连接池与 drizzle 的连接池是两个**。默认各开一份，`DB_POOL_MAX` 只约束后者。上线前要按"`DB_POOL_MAX + QUEUE_CONCURRENCY` ≤ PG 的 `max_connections`"核算，否则高峰期会互相挤掉连接
2. **`QUEUE_ENABLED=false` 时消费者不注册**，此时 `enqueue` 静默丢弃。开发环境这是一种有用的降噪，但必须在日志里 `warn` 一次"队列已关闭，任务被丢弃"，否则会出现"本地怎么都不触发"的排查困难
3. **多实例下的告警去重**：`dedupeKey` 的分钟桶在多实例场景仍然有效（唯一约束在库上），但 `failures + 1 === threshold` 这个判断是每实例各自算的 —— 两个实例同时处理同一学号的失败请求时，可能各投递一次，最终由唯一约束吸收。这是可接受的（最多多一次投递），不需要额外加分布式锁
4. **`security_alerts` 的保留期**：与 `LOGIN_LOG_RETENTION_DAYS` 一样需要清理策略，暂定同样 90 天，等 §10 的定时任务落地后一起接

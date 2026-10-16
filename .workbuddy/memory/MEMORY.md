# typescript-starter 项目记忆

> **约定细节以仓库内 `AGENTS.md` 为准（唯一来源）**；本文件只记**决策要点**与**易踩回来**的规则。
> 逐日过程见同目录 `YYYY-MM-DD.md`。章节号对应 AGENTS.md。

## 技术栈
NestJS 12 + 纯 ESM（`type: module`，导入带 `.js` 后缀）、pnpm、Vitest 4、oxlint、Drizzle + PG。

## env（§4）
- 全部环境变量集中在 `src/config/env.ts` 的 zod schema（**不是** env.validation.ts）；ConfigModule 启动 fail-fast。
- 取配置一律 `ConfigService<Env, true>` + `get('KEY', { infer: true })`，禁 `process.env`；仅 `main.ts` 取日志配置用 `loadEnv()`（FileLogger 早于 DI 容器）。
- 布尔变量**禁用 `z.coerce.boolean()`**（`Boolean('false') === true`），用 `envBoolean()`。
- ⚠️ zod v4 的 transform 里 `throw` **不会被 `safeParse` 接住**（绕过统一错误聚合）→ 要报失败请用 `z.enum` 之类产出 issue。
- 用户自管 `.env`；本地覆盖 `.env.local`；`.env.example` 已删除、不再维护。

## 业务模块（§5–§7）
### 对外字段 = 列白名单投影
- `src/modules/<domain>/<domain>.projection.ts`：`export const userPublicColumns = { id: users.id, … } as const` + `type UserResponse = Pick<Users, keyof typeof userPublicColumns>`。
- `select()` / `returning()` 一律传它 → **SQL 层就不返回敏感列**；**不要写 `toXxxResponse()`**（"忘了映射"这个失败模式不存在了）。文件名叫 `.projection.ts`，不是 `.mapper.ts`。
- **禁止 `Omit<Users,'passwordHash'>` 黑名单**：默认公开、漏一列就泄露且编译期不报错。
- **`deletedAt` 刻意不对外**（用户拍板的破坏性变更）：读路径恒 `isNull` 过滤 → 未删用户返回它恒为 `null`，是纯噪音且误导客户端拿它判断软删除。
- 需敏感列（登录取 `passwordHash`）**另行显式 select**；某接口要额外字段**另建投影**，不要扩展公共白名单（会被单接口撑成黑名单）。
- `*.projection.spec.ts` 把字段集合冻结成断言（逻辑名 + 物理列名），加列即测试失败。
- 备选 B（zod 响应 schema）已评估**未采用**：性能不是问题（实测单行 0.28 µs、100 行 +0.025 ms = 请求的 0.14%、常驻内存零增长），真实代价是 **strip 静默** + 双份维护。将来若要叠加，**只写结构断言**，别抄 `.email()/.max()`（成本约 3 倍）。

### 响应契约
- 成功 `{ success: true, message: <'ok' | @ApiMessage>, data }`；失败 `{ success: false, message, data: null }`，**参数校验失败额外带 `errors: [{path, message}]`**。
- **无 `code` 字段**（历史决策，别加回来）：因此是 TS 判别联合 `ApiResponse<T>`。
- ⚠️ **不变量：`success === (HTTP 状态码 2xx)`**，禁止 `200 + success:false`。
- `message` 是给用户读的 toast 文案：客户端**禁止**按 message 分支；只有中文、不 i18n；**改文案不算契约变更**。常量在 `src/common/response/api-response.ts`。
- 无返回值接口保持 `200 + data:null`（**不改 204**，否则前端失去唯一判别字段）；`@SkipTransform()` 是例外。
- 分页元数据 `items/total/page/pageSize/totalPages` 保持不动。

### 入参归一化
- **只有 URL query 宽容**：`ZodValidationPipe.transform` 读 `metadata.type`，**仅 `type === 'query'`** 时把 `''`/纯空白 → `undefined`；body / param **原样进 schema**，注册处零改动。
- body 契约：**"没提供"只能靠省略 key 表达**；`""` 由字段 `min(1)` 拒、`null` 报 `received null`。依据 RFC 7396（`null` = 删除该字段）——吃 `null` 会让 PATCH 无法表达"清空"。
- 只对 query 宽容的依据：URL 值是字符串装配产物（清空的输入框天生 `?keyword=`，`URLSearchParams` 无法表达"键不存在"），属**传输层假象**。
- 只递归普通对象、数组元素不动；直调 `pipe.transform(v)` 不传 metadata 走**严格**分支（写单测要显式传 `{ type: 'query' }`）。

### 首尾空白
- `src/common/validation/trimmed.ts`：`trimmedShape({...})` 是 DTO **默认写法**（`z.object(trimmedShape({...}))`），非字符串字段透传无副作用。
- ⚠️ **`trimmed` 只 trim，不产出 `undefined`**（旧的"trim 后为空 = 未提供"已废弃）。
- **无例外字段**：`password` 同样 trim → `'        '`（8 空格）会被 `min(8)` 拒；落库哈希基于 trim 后串。
- 只处理**顶层字段**；`.optional()/.default()` 写在内层（形式约定）。
- `trimmed(schema)` 仅用于**顶层非 shape** 场景（`:studentNo` / `:id` 路径参数）。
- **数字 `:id` 不要用 `z.coerce.number()`**：`Number('') === 0` 会把空值误报成 `Too small`，且 `Number()` 认 `'0x10'`→16、`'1e0'`→1。现行写法 `trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`（trim 由外层 `trimmed()` 的 preprocess 保证排在 `.regex()` 之前）。
- ⚠️ **原生 `.trim()` 必须紧跟 `z.string()`、排在长度/格式校验之前**：zod 的 check 按**链式顺序**求值，`z.string().min(8).max(128).trim()` 会让 `'        '`（8 空格）先通过 `min(8)`、再被 trim 成空串落库（= 允许把密码设成 `''`，zod 4.6.7 实测 + 服务端复现过）。`trimmed()` / `trimmedShape()` 用 `preprocess`，恒在内层校验之前，不存在该顺序问题 —— 这是多字段 DTO 仍默认用它的原因。

### 密码规则与改密（§9）
- `src/common/validation/password.ts` 的 `passwordSchema` 是**创建用户 + 修改密码共用的唯一出处**：长度 **8~18**（`PASSWORD_MIN/MAX_LENGTH`）、字符白名单 `^[A-Za-z0-9_]+$`（仅字母/数字/下划线）、三类**至少占两类**（纯数字/纯字母/纯下划线都不合格）。纯校验、**不涉及 DB 结构**（明文从不入库），历史密码照旧可校验。
- ⚠️ **`oldPassword` 不要套 `passwordSchema`**：它是"设密码"规则，不是"验密码"规则；库里存在收窄前设定的密码（种子演示账号 `12345678`、8~128 位历史密码），套用 = 把老用户锁死。旧密码只 `min(1)` + `LEGACY_PASSWORD_MAX_LENGTH`(128，= 收窄前上限，仅为 scrypt 输入规模兜底)。
- `PATCH /users/:id/password` = **自助改密**：body `{ oldPassword, password }`；服务层显式 `select({ passwordHash })` → 404 → `verifyPassword()` 不符 **401「旧密码不正确」**（不是 400：参数合法、失败在凭据）→ 通过后才 `hashPassword()` 写库。先判存在再验旧密码，别为不存在的 id 白跑 scrypt。
- DTO 已重组：`reset-password.dto.ts` 拆为 `dto/change-password.dto.ts`（改密 body）+ `dto/params.dto.ts`（`idParamSchema` / `studentNoParamSchema`）。
- 遗留：种子演示账号（`2019010002`/`2019010003`，id 200018/200019）密码仍是 `12345678`，能登录但不符合新规则；改密时会被要求换合规密码。

### 其他
- 分页：列表 DTO 用 `paginationSchema.extend(...)`，查询走 `paginate()` 回调式助手。
- **列表默认排序一律 `updatedAt` 降序**：DTO `sortBy` 默认值 + 枚举都要有该项，Service `sortColumn` 映射表同步补项（漏项 TS 会报错，靠它兜底）。
- 密码：Node 内置 `node:crypto` scrypt（**用户明确拒绝 bcrypt**），格式 `scrypt$N$r$p$saltHex$hashHex`，工具 `src/common/crypto/password.scrypt.ts`。
- Drizzle：`updatedAt` **不自动更新**，update/restore 必须手动 set；pg 错误被包成 `DrizzleQueryError`，需从 `err.cause` 解包再判 23505。
- ⚠️ **pg `Pool` 必须挂 `error` 监听器**（`drizzle.service.ts`）：空闲连接被掐断时 pg-pool 会 `emit('error')`，**无监听器 → uncaughtException 直接杀进程**；只记 warn。
- 拦截器顺序：RequestLoggingInterceptor 在 TransformInterceptor **之前**（保持最外层，统计完整耗时）。

## 日志与 traceId（§10，2026-10-16 重构）
- ⚠️ **logger 必须传 `NestFactory.create({ logger })`**，不能用 `app.useLogger()`（create 阶段日志更早，永远进不了文件）。**`bufferLogs: true` 在本项目无效**（`init()` 末尾即被默认 logger 清空）。
- `LOG_FILE` 默认 `logs/app.log`；显式 `LOG_FILE=`（空串）才关闭文件写入。写入用**同步 fd 写**（openSync/writeSync）：进程级兜底记完 fatal 立刻 `exit(1)`，异步流不保证落盘。
- **失败时的行数契约**：4xx 命中路由 = **1 行**（access warn，含原因+字段）；5xx = **2 行**（filter 堆栈行在前 → access error 在后，traceId 相同）；404 / malformed JSON 400 = **1 行** 且带耗时；客户端中断 = **1 行**（warn，此时 statusCode 是假的 200）。
- `accessLogMiddleware` 在**中间件层**写唯一一行：`finish` + `close` 双监听 + 单次守卫；**必须紧跟 `traceContextMiddleware`**（入口要 `getTraceId()`）。
- ⚠️ `finish`/`close` 回调**不一定在请求的 ALS 上下文内**（**客户端中断时 `getTraceId()` 为 `undefined`**）→ 入口先捕获 traceId，写日志时 `runWithTraceId` 显式恢复。
- 失败摘要：过滤器只写结构化 `res.locals.accessLogFailure`，「失败: 」「（字段错误：…）」等文案拼装归 `formatFailureSuffix()`。
- `RequestLoggingInterceptor` 只剩 `LOG_BODY` 的 body 行；**拦截器顺序不再承载日志正确性**。
- traceId 走 `AsyncLocalStorage`（`src/logger/trace.ts`）：`runWithTraceId` / `getTraceId()`；入站 `x-trace-id`→`x-request-id`→UUID，入站值须过 `^[A-Za-z0-9._-]{1,128}$` 清洗（防日志注入）。
- 日志行**不手写** `[traceId=...]`：`FileLogger` 按 ALS **前置**附加（堆栈是多行，前置才恒定落首行）；无上下文则不追加。
- **`formatError()` 必须展开 `error.cause` 链**（≤5 层）并摘出 `code=` 驱动字段——只读最外层会丢根因；写单行日志还要过 `toSingleLine()`。
- `LOG_BODY=true`（默认 false）多输出一行 `body: {...}`，经 `sanitize.ts` 脱敏 + 限额截断；**独立成行**、不并入 access 行（中间件层早于 body parser，读不到 `req.body`）。
- 给 `Logger.error/warn` 传第二个**字符串**参数会被 ConsoleLogger 当 **context** → 一律先拼成单条完整消息。
- 调试：`.vscode/launch.json` attach 9229；`start*` 已加 `--enable-source-maps`（**改 script 需重启 dev server**）。

## 启动检测（§10「启动日志」）
- `main.ts` 启动日志：`服务已就绪，监听 …` / `可访问地址：…（label）`×N / 无局域网降级说明 / `启动耗时 123ms`。**只记总耗时**（四段拆分已按用户要求移除，别加回来）。
- ⚠️ `app.getUrl()` 返回 `http://[::1]:8000`（绑 IPv6 通配）→ **地址枚举必须用 `src/common/startup/local-addresses.ts`**，`getUrl()` 只借协议前缀。该文件规则：回环恒第一、只取非 internal IPv4、跳过 `169.254.*`、按地址去重、`en*` 优先 `utun*`、`interfaces` 可注入便于单测。
- ⚠️ `app.use(traceContextMiddleware)` 必须写在 **`listen()` 之前**（`app.use` 即时转发、body parser 在 `init()` 里注册）——否则 malformed JSON 400 / 无路由 404 丢 traceId。**不显式调 `app.init()`**。不设 `HOST`，维持通配监听。

## 数据库迁移（2026-10-15 起）
- 走 **drizzle-kit 迁移**流程（非 `db:push`）。种子/自定义 DDL 一律用**自定义迁移**：`pnpm db:generate --custom --name=xxx` → 写 SQL → `pnpm db:migrate`。
- 种子范式见 `drizzle/0001_seed_users.sql`：单条 `INSERT ... SELECT generate_series` + 分层 CTE（PG 不允许在同一 SELECT 列表引用输出别名）、`setseed()` 固定分布、`ON CONFLICT DO NOTHING` 幂等。
- 可 `psql` 在 `BEGIN ... ROLLBACK` 里试跑（`--> statement-breakpoint` 本身是合法 SQL 注释）。
- ⚠️ **identity 序列不参与事务回滚**：反复试跑会烧掉序列值（id 不从 1 开始）。

## 环境限制 / 待办
- ⚠️ **本沙箱无法启动任何新的监听进程**（`run_in_background`、前台 `spawn`、shell `&` 全试过：无输出、不 listen、不建日志文件）→ **只能用 curl 打已在运行的 dev server（8000）验证**；需要"另一套配置（如 `LOG_BODY=true`）的实例"时改走单测或请用户重启。
- `pnpm exec tsc -p tsconfig.build.json` 可增量编译，绕开 `nest build` 的删 dist 保护（`deleteOutDir` 触发 safe-delete，>50 文件需用户确认）。
- `src/modules/user/user.e2e-spec.ts` 尚待编写（断言按响应契约 v2 写）；旧 e2e（期望 Hello World）已删除。

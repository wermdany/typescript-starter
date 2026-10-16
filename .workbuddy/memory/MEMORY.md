# typescript-starter 项目记忆

## 项目约定
- NestJS 12 + 纯 ESM（`type: module`，导入需 `.js` 后缀），pnpm，Vitest 4，oxlint
- 2026-10-14 引入 `@nestjs/config` + `zod` 管理 env：
  - 所有环境变量集中在 `src/config/env.ts` 的 zod schema 中声明（注意文件名是 env.ts 不是 env.validation.ts），ConfigModule `validationSchema` 启动时 fail-fast 校验（v12 走 Standard Schema，zod v4 原生支持；transform 后的值会进 ConfigService）
  - 业务代码取配置用 `ConfigService<Env, true>` + `get('KEY', { infer: true })`，禁止直接 `process.env`
  - **布尔环境变量禁用 `z.coerce.boolean()`**（等价 `Boolean(value)`，`Boolean('false')===true`）；用 `env.ts` 里的 `envBoolean()` 助手
  - **zod v4 的 transform 里 `throw` 不会被 `safeParse` 接住**（直接冒泡，绕过统一错误聚合）——要报校验失败请落到 `z.enum` 之类 issue
  - 新增 env 变量必须同步更新 schema（用户自管 `.env` 文件，`.env.example` 已被用户删除，不再维护）
  - 本地覆盖用 `.env.local`（gitignore），敏感配置由部署平台注入
## 业务模块约定（2026-10-15 起，User 模块为首个范式）
- 目录：业务模块放 `src/modules/<domain>/`（module/controller/service/mapper/dto），通用件放 `src/common/`
- **响应契约（2026-10-16 改为 `success` 判别，详见 AGENTS.md §5）**
  - 成功 `{ success: true, message: <默认 'ok' | @ApiMessage>, data }`；失败 `{ success: false, message: <短文案>, data: null }`，**参数校验失败额外带 `errors: [{path, message}]`**（zod issues 映射而非透传）
  - **`code` 字段已删除**：它曾同时承载"成功 0"与"失败 HTTP 状态"两个尺度（RFC 9457 明确反对复用状态码当业务码，`{"code":402}` 没提供状态行之外的信息）；换成布尔 `success` 后语义无歧义、不与状态码抢位置，且成为 TS **判别联合** `ApiResponse<T> = ApiSuccess<T> | ApiFailure`
  - ⚠️ **不变量：`success === (HTTP 状态码 2xx)`**，绝不允许 `200 + success:false`（会同时废掉重试策略/网关规则/错误率监控）
  - **`message` 是给用户看的 toast 文案**（用户明确要求"错误 message 应该直接给用户读取的 toast 信息"）：客户端**禁止**按 message 字符串分支（只能靠 `success`/HTTP 状态码/`errors[].path`）；服务端只有中文、不 i18n；**改文案不算契约变更**
  - 文案自定义入口：校验失败 `new ZodValidationPipe(schema, { message: '…' })`（默认 `DEFAULT_VALIDATION_MESSAGE`「参数校验失败」）；成功默认 `DEFAULT_SUCCESS_MESSAGE`（`'ok'`）。两个常量都在 `src/common/response/api-response.ts`，改常量即全局生效
  - **无返回值接口保持 200 + `data:null`，不改 204**（判别字段 `success` 在 body 里，204 无 body 会让前端失去唯一判据）；`@SkipTransform()` 仍是明确例外（其响应体不是契约 JSON）
  - 选型过程：对比过 A 收敛信封 / B 裸资源+RFC 9457 / C 轻信封 data+meta，用户选择"保留信封但去 code、换 success、message 当 toast"。分页元数据 `items/total/page/pageSize/totalPages` **保持现状不动**
- 请求校验：zod v4 + `ZodValidationPipe` **按参数注册**（`@Body(new ZodValidationPipe(schema))`），不用 class-validator
- **入参归一化：只有 URL query 宽容（2026-10-16 重定契约）**——`ZodValidationPipe.transform(value, metadata)` 读 Nest 给的 `metadata.type`，**仅 `type === 'query'` 时**把 `''`/纯空白 → `undefined`（→ optional 通过、default 回落）；`@Body`/`@Param` **原样进 schema、不做任何空值宽恕**，注册处零改动。
  - 用户要求：「清空现在空串/null 过滤，制定契约必须由前端处理；如果参数在 url query 则做处理」
  - body 契约（AGENTS.md §6）：**"没提供" 只能靠省略 key 表达**；`""` 由字段自身 `min(1)` 拒（`Too small`），`null` 报 `received null`。依据 RFC 7396 / JSON Merge Patch：JSON 里 `null`=删除该字段、`""`=长度为 0 的真实值，**吃 null 会让 PATCH 无法表达"清空"**
  - 只对 query 宽容的依据：URL 值是字符串装配产物（清空的输入框天生 `?keyword=`，`URLSearchParams` 无法表达"键不存在"），属**传输层假象**
  - 仅递归普通对象、数组元素不动；直调 `pipe.transform(v)` 不传 metadata 走**严格**分支（写单测要显式传 `{ type: 'query' }`）
- **首尾空白规范化（DTO schema 层，2026-10-15）**：`src/common/validation/trimmed.ts` 导出两个工具
  - `trimmedShape({...})` 是**默认写法**：`z.object(trimmedShape({...}))` / `paginationSchema.extend(trimmedShape({...}))`，自动给每个顶层字段包 trim（非字符串字段透传无副作用）
  - ⚠️ **`trimmed` 只 trim，不再产出 `undefined`**（2026-10-16 改）：trim 后为空就保持空串，交字段自身约束判定。旧语义「trim 后为空即视为未提供」已废弃——那让同一份 schema 无法区分"谁在宽容"，也把 body 空串一并吞掉了
  - 需要保留空白的字段（仅 `password`）在字段上写 `.meta({ keepWhitespace: true })` 就近声明例外
  - `trimmed(schema)` 仅用于顶层非 shape 场景（如 `:studentNo` 路径参数——query 归一化与 shape 包装都覆盖不到 path 参数）
  - 只处理顶层字段，嵌套对象需在其定义处自行包一层；`.optional()/.default()` 写在内层（现仅形式约定，两种写法语义已一致）
- **数字路径参数（`:id`，2026-10-15 约定）**：`trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`，全部 `:id` 路由复用它。**不要用 `z.coerce.number()`**——`Number('') === 0` 会把空值误报成 `Too small`（看不出"没传"还是"传了 0"），且 `Number()` 会把 `'0x10'` 当 16、`'1e0'` 当 1。空白值现在落到 `/^\d+$/` 报「ID 必须是正整数」（不再是 `received undefined`）。数字 ID 由 DB 生成、不接受客户端指定，故不额外约束业务范围（int4 上限不处理）
- 分页：列表 DTO 用 `paginationSchema.extend(...)`，查询走 `paginate()` 回调式助手，返回 `PageResponse<T>`
- **列表默认排序一律 `updatedAt` 降序**（AGENTS.md 第 7 节，user 模块已对齐）：DTO `sortBy` 默认 `'updatedAt'` + 枚举含该项，Service `sortColumn` 映射表必须同步补项（漏项 TS 会报错，新增排序字段时靠它兜底）
- 密码：用 Node 内置 `node:crypto` scrypt（用户明确拒绝 bcrypt），格式 `scrypt$N$r$p$saltHex$hashHex`；工具在 `src/common/crypto/password.scrypt.ts`
- Drizzle 注意：`updatedAt` 不会自动更新，update/restore 必须手动 set；**pg 错误被 drizzle 包装为 DrizzleQueryError，需从 `err.cause` 解包再判断 23505**（日志侧 `formatError()` 也会展开 cause 链）
- **pg `Pool` 必须挂 `error` 监听器**（`drizzle.service.ts`）：空闲连接被网络中断/DB 重启/容器暂停掐断时 pg-pool 会 `pool.emit('error')`（`pg-pool@3.14.0/index.js:62`），**无监听器时 Node 升级为 uncaughtException 直接杀进程**；只记 warn，让下次请求重建连接
- 拦截器顺序：RequestLoggingInterceptor 必须排在 TransformInterceptor 前面（保持最外层，统计完整耗时）

## 日志与异常记录（2026-10-16 重构）
- `LOG_FILE` 默认 `logs/app.log`（env.ts 里给默认值 + `.env` 显式声明）；显式 `LOG_FILE=`（空串）才关闭文件写入。
  **logger 必须注入 `NestFactory.create({ logger })`，不要用 `app.useLogger()`**（create 阶段日志早于 useLogger，会永远进不了文件）
- ⚠️ **`bufferLogs: true` 在本项目无效**：`NestApplication.init()` 末尾先 `flushLogsIfAutoFlushEnabled()`（`autoFlushLogs` 默认 true），缓冲在 `useLogger()` 之前就被默认 logger 清空；且 `NestFactory.create()` 并不调用 `instance.init()`（`RoutesResolver` 等是 `listen()` 打的）
- 文件写入用**同步 fd 写**（`openSync`/`writeSync`）：进程级兜底记完 fatal 立刻 `process.exit(1)`，异步流不保证落盘；写失败降级为仅控制台且只警告一次
- 异常记录四层：`registerProcessErrorHandlers()`（uncaughtException / unhandledRejection 都 fatal 后 exit(1)）→ `HttpExceptionFilter`（4xx warn 附字段、5xx error 带堆栈）→ `RequestLoggingInterceptor`（只写 access 行，不打印堆栈避免重复）→ traceId 由 `FileLogger` 从 ALS 自动前置到消息（详见下一节）
- 给 `Logger.error/warn` 传第二个字符串参数会被 ConsoleLogger 当 **context**，异常内容会错位 —— 一律先拼成单条完整消息
- `main.ts` 用 `loadEnv()` 取日志配置（不走 ConfigService，因为 FileLogger 要早于 DI 容器），其余业务代码仍一律 `ConfigService`

## 可复现请求 + traceId 全链路（2026-10-16 追加）
- **traceId 走 `AsyncLocalStorage`**（`src/logger/trace.ts`，无新依赖）：`runWithTraceId` / `getTraceId()`；`traceContextMiddleware` 解析入站 `x-trace-id`→`x-request-id`→UUID（入站值必须过 `^[A-Za-z0-9._-]{1,128}$` 清洗，防日志注入），挂 `req.traceId` + 回写响应头
- ⚠️ **中间件必须在 `main.ts` 里 `app.use()` 且早于 `listen()`**，不能改成 `NestModule.configure()`：Nest `init()` 先 `registerParserMiddleware()` 再 `registerRouter()`（用户中间件在后），只有早注册才能覆盖 malformed JSON 400 / 无路由 404
- **日志行不再手写 `[traceId=...]`**：`FileLogger.printMessages` 按 ALS 自动附加（控制台+文件一处生效），且是**前置**（`[traceId=xxx] 消息`）——异常堆栈是多行的，前置才能恒定落在首行；启动期/进程级异常无上下文则**不追加**（不再是 `-` 占位）
- **`formatError()` 必须展开 `error.cause` 链**（≤5 层，前缀 `caused by:`，循环保护）并摘出驱动字段 `(code=42P01 severity=ERROR)`——只读最外层 message 会丢根因（drizzle 只写 SQL+空 `params:`）。写单行日志（access 行）还要过 `toSingleLine()`，否则库异常的多行 message 会把一行日志劈成两半
- `LOG_BODY=true`（默认 false）时拦截器多输出一行 `... body: {...}`，经 `src/logger/sanitize.ts` 脱敏（敏感 key→`***`）+ 限额截断；级别用 `log` 以便默认 `LOG_LEVEL=log` 下可见。**独立成行、不并入 access 行**——中间件层排在 body parser 之前，读不到 `req.body`
- 断点调试：`.vscode/launch.json` attach 9229；`start*` scripts 已加 `--enable-source-maps`（日志堆栈显示 TS 行号，**改 script 需重启 dev server**）；`source-map-support` 已弃用

## 日志分层：access 行在中间件层（2026-10-16 重写）
- **失败时的行数契约**：4xx 命中路由 = **1 行**（access `warn`，含原因+字段）；5xx = **2 行**（`HttpExceptionFilter` 堆栈行在前 → access `error` 行在后，traceId 相同）；404 未匹配路由 / malformed JSON 400 = **1 行** access 且**带耗时**；客户端中断 = **1 行**（`(连接已中断)`）。历史 bug：拦截器与过滤器都记同一异常 → 一次失败打三条
- `accessLogMiddleware`（`src/logger/access-log.middleware.ts`）在**中间件层**（morgan / pino-http 同位置）写**唯一**一行 access 日志：`finish` + `close` 双监听 + 单次守卫（恒定一行）；级别 ≥500 error / ≥400 warn / 其余 log，**中断一律 warn**（此时 statusCode 是假的 200）；**必须紧跟 `traceContextMiddleware` 之后注册**（入口要 `getTraceId()`）
- ⚠️ **`finish`/`close` 回调不一定在请求的 ALS 上下文内**（实测：正常/错误收尾在；**客户端中断时 `close` 由 socket 触发、`getTraceId()` 为 `undefined`**）→ 中间件**入口先捕获 traceId**，写日志时 `runWithTraceId(traceId, …)` 显式恢复，否则中断行丢 traceId
- 失败摘要：过滤器以**结构化**形式写 `res.locals.accessLogFailure = { summary, fields? }`（只给事实，`fields` 不裁剪）；「失败: 」「（字段错误：…）」、最多列 3 个字段等**文案拼装归日志层** `formatFailureSuffix()`
- access 行耗时口径 = **中间件入口 → 响应收尾**（含 body 解析/守卫/校验/序列化），比旧的拦截器起点略大
- `RequestLoggingInterceptor` 只剩 `LOG_BODY` 的 body 行；**拦截器注册顺序不再承载日志正确性**

## 启动检测：服务地址 + 启动耗时（2026-10-16 追加）
- `main.ts` 的 `bootstrap()` 打这几类启动日志（context `Bootstrap`，与启动失败 catch 同 context）：
  `服务已就绪，监听 …` / `可访问地址：<url>（<label>）`×N / 无局域网时降级说明 / `启动耗时 123ms`
  （**只记总耗时** —— 早期版本的四段拆分「配置/装配/初始化/监听」与 `process.uptime()`
  已按用户要求移除，不要再加回来）
- **`app.getUrl()` 在本项目返回 `http://[::1]:8000`**（`listen(port)` 绑 IPv6 通配 `::`，`formatAddress` 把 `::`→`[::1]`）：**地址枚举必须用 `src/common/startup/local-addresses.ts`**，`getUrl()` 只借协议前缀
- `local-addresses.ts`：回环恒第一；只取非 internal IPv4；跳过 `169.254.*`；按地址去重；`en*` 优先于 `utun*`（VPN 地址不置顶）；`interfaces` 可注入以便单测
- ⚠️ **`app.use(traceContextMiddleware)` 必须写在 `listen()` 之前** —— `app.use()` 即时转发、body parser 在 `init()`（由 `listen()` 内部触发）里注册，挪到后面会让 malformed JSON 400 / 无路由 404 丢 traceId。**不显式调 `app.init()`**：曾显式调一次只为拿分段计时，已随分段一起移除；顺序保证与是否显式 init 无关
- 不设 `HOST` 变量，维持通配监听；启动阶段不在请求上下文内，启动日志**无** traceId 前缀

## 数据库迁移与种子数据（2026-10-15 起）
- 库走 **drizzle-kit 迁移流程**（`drizzle.__drizzle_migrations` 有记录），非 `db:push`
- 种子/自定义 DDL 一律用**自定义迁移**：`pnpm db:generate --custom --name=xxx` → 写 SQL 到 `drizzle/000N_xxx.sql` → `pnpm db:migrate`
- 写种子数据的既有范式见 `drizzle/0001_seed_users.sql`：单条 `INSERT ... SELECT generate_series` + CTE 分层（PG 不允许在同一 SELECT 列表引用输出别名，故必须逐层 CTE）、`setseed()` 固定分布、中文/拼音并行数组保证姓名与邮箱一致、`ON CONFLICT DO NOTHING` 保证幂等
- 迁移文件可直接用 psql 在 `BEGIN ... ROLLBACK` 里试跑（`--> statement-breakpoint` 本身就是合法 SQL 注释）
- ⚠️ **identity 序列不参与事务回滚**：反复试跑会烧掉序列值，导致 id 不从 1 开始

## 预置问题
- 旧的 e2e（`GET /` 期望 Hello World）已删除；`src/modules/user/user.e2e-spec.ts` 尚待编写（断言按响应契约 v2 写）
- 每次启动开发服务器，nest 的 deleteOutDir 删除 dist 会触发 safe-delete 保护（>50 文件需用户确认后单独 rm）
- **本沙箱环境无法启动任何新的监听进程**：`run_in_background`、前台 `spawn('node', ...)`、shell `&` 后台化都试过 —— 子进程无输出、从不 listen、也不创建日志文件。因此**只能用 curl 打已在运行的 dev server（8000）**来验证；需要"另一个配置（如 `LOG_BODY=true`）下的实例"时，改走单测覆盖或请用户重启。另：`pnpm exec tsc -p tsconfig.build.json` 可增量编译，绕开 `nest build` 的删 dist 保护

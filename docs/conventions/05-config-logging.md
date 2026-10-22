# 环境变量配置与日志规范

> 本文件是 AGENTS.md 第 §4、§10 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 新增配置项、写日志或排查日志时读这一份。

---

## 4. 环境变量

所有环境变量集中在 `src/config/env.ts` 的 `envSchema` 里声明。**校验只有一个入口**：
`main.ts` 启动时调 `loadEnv()` 解析 `process.env`，缺失或非法直接启动失败并列出所有问题；
解析结果有单例缓存，`config.module.ts` 复用同一次解析。

**配置统一注入**：`config/config.module.ts` 提供 `ENV`（全量强类型 Env，
`@Inject(ENV)` 拿到后 `env.DATABASE_URL` 直取）与 `AUTH_CONFIG`（认证派生视图）
两个 @Global provider；`main.ts` 启动时 `loadEnv()` 解析一次，模块复用其缓存。
**业务代码不再逐键 `ConfigService.get()`**（ConfigService 仅保留在
`config.module.ts` 内部），也不再散落第二个注入口。

规则：

- **必填**变量不写 `.default()`；可选变量用 `.default()` / `.optional()`
- 数字类变量用 `z.coerce.number()`（如 `PORT: z.coerce.number().int().positive().default(8000)`）
- **布尔类变量不要用 `z.coerce.boolean()`**：它等价 `Boolean(value)`，`Boolean('false') === true`。
  用 `envBoolean()`（真值词表 `true/1/yes/on`，其余合法词为假，非法值走 `z.enum` 报 issue）
- **不要在 transform 里 `throw`**：zod v4 的 `safeParse` 不接 transform 抛出的错误（直接冒泡），
  要报失败请让值落到 `z.enum` 之类的 issue
- **新增变量必须同步进 schema**
- 业务代码取配置用 `@Inject(ENV) env: Env`（强类型、整对象直取），
  **禁止**逐键 `ConfigService.get()`、**禁止**直接读 `process.env`
- `.env` 由用户自行维护，不入库；`.env.local` 已 gitignore
- **`.env.example` 是全部变量的模板**（16 个，与 schema 一一对应，含注释与默认值），
  新增变量必须同步更新它；`.gitignore` 用 `!.env.example` 放行入库

当前变量（17 个）：`NODE_ENV`、`PORT`、`LOG_LEVEL`、`LOG_FILE`、`LOG_BODY`、`DATABASE_URL`（必填）、
`DB_POOL_MAX`、`AUTH_ACCESS_TTL_MINUTES`、`AUTH_REFRESH_TTL_DAYS`、`AUTH_REFRESH_SLIDING`、
`AUTH_REFRESH_WINDOW_MINUTES`、`AUTH_MAX_SESSIONS_PER_USER`、`AUTH_LOGIN_MAX_ATTEMPTS`、
`AUTH_LOGIN_WINDOW_MINUTES`、`AUTH_TRUST_PROXY`、`AUTH_REFRESH_COOKIE`、`RBAC_CACHE_TTL_SECONDS`。

**这条清单不许手抄**：`envSchema` 与 `.env.example` 必须一一对应，由
`scripts/convention-audit.mjs` 的 `env-example-sync` 规则自动比对（新增变量漏改任一处即红）。
上面这段列举只是为了让人一眼看到全貌，与脚本不一致时**以脚本为准**。

**账号数据是真实数据**：不做演示账号注入/校准。登录账号、角色与密码哈希由部署方
直接在数据库中维护（哈希用 `hashPassword()` 生成，格式 `scrypt$N$r$p$saltHex$hashHex`）。

**例外**：`main.ts` 用 `loadEnv()` 直接取配置 —— `FileLogger` 必须早于 DI 容器就绪
（要注入 `NestFactory.create`）。其余代码一律 `@Inject(ENV)` 取强类型配置对象。

**认证配置是 env 的派生视图**：`env.ts` 里的 `toAuthConfig(env)` 把 `AUTH_*` 变量
换算成业务视角的 `AuthConfig`（毫秒、Cookie 属性等），由 `config.module.ts` 提供
`AUTH_CONFIG` provider（@Global，`@Inject(AUTH_CONFIG)` 注入）。业务代码拿的是
配置对象，感知不到环境变量名；改默认值、加配置项只动 `env.ts` 一处
（schema + toAuthConfig 相邻，不会再跳文件）。

---

---

## 10. 日志与异常

### 落盘

- `main.ts` 用 `FileLogger`（继承 `ConsoleLogger`）接管日志：控制台 + 文件双写，文件内容 strip 掉 ANSI 色码
- **把 logger 注入 `NestFactory.create({ logger })`，不要用 `app.useLogger()`**：create 阶段的日志
  早于 `useLogger`，那样写进不了文件
- `LOG_FILE` 默认 `logs/app.log`（相对路径按 cwd 解析）；`LOG_FILE=`（空值）只输出控制台
- `LOG_LEVEL` 是最小级别，由 `getLogLevels()` 展开成数组（`fatal` 永远包含）
- 文件写入用同步 fd 写（`openSync` + `writeSync`）：进程级兜底记完 fatal 要立刻 `exit(1)`，
  同步写不会丢尾部日志；目录/磁盘不可写时降级为仅控制台并警告一次

### 启动日志

`bootstrap()` 在 `listen()` 之后用 `Logger('Bootstrap')` 打以下几行，固定前缀便于检索：

```
服务已就绪，监听 [::]:8000（所有网卡 · IPv6 通配）
可访问地址：http://127.0.0.1:8000（本机回环）
可访问地址：http://192.168.3.51:8000（en0）
启动耗时 123ms
```

- grep 锚点：`服务已就绪` / `可访问地址` / `启动耗时`
- 监听地址不带协议前缀（通配地址不是可点的 URL）；可访问地址一律是完整 URL
- 不用 `app.getUrl()` 取地址：它把 IPv6 通配 `::` 映射成 `[::1]`，拿不到局域网地址。
  枚举走 `listAccessibleUrls()`，只从 `getUrl()` 借协议前缀
- 启动阶段不在请求上下文内，这些行没有 traceId

### traceId

- `traceContextMiddleware` 为每个请求解析/生成 traceId，建立 `AsyncLocalStorage` 上下文，回写 `x-trace-id`
- 入站优先：`x-trace-id` → `x-request-id` → `randomUUID()`；
  入站值必须过 `sanitizeInboundTraceId`（白名单 `^[A-Za-z0-9._-]{1,128}$`），防日志注入
- `FileLogger` 自动在消息前加 `[traceId=...]`，调用方**不要**手写
- 业务代码取 traceId 用 `getTraceId()`；断点时可看 `req.traceId`
- 启动阶段、进程级异常的日志不附加 traceId

### 请求与访问日志

1. `traceContextMiddleware`、`accessLogMiddleware` 都在 `server.ts` 的 `createApp()` 里 `app.use()`，且早于 `listen()`。
   `app.use()` 是即时挂载，只有早注册才能排在 body parser 之前，
   malformed JSON 的 400 / 未命中路由的 404 也才有 traceId 与 access 行。顺序不可换：
   access 必须在 trace 之后（入口要取 traceId）
2. `accessLogMiddleware` —— 访问行唯一出口，一个请求恰好一行
   `METHOD /path status 耗时ms [失败: 原因]`，级别 ≥500 `error` / ≥400 `warn` / 其余 `log`；
   `finish` + `close` 双监听 + 单次守卫防重复；客户端中断时追加 `(连接已中断)` 并提到 `warn`
3. `HttpExceptionFilter` —— 只记 5xx（`error`，带堆栈 / cause 链）；4xx 不记（access 行已留痕）。
   两类都把结构化摘要写进 `res.locals.accessLogFailure`（`{ summary, fields? }`），
   由日志层拼成「失败: …（字段错误：a, b）」，最多列 3 个字段
4. `RequestLoggingInterceptor` —— 只负责 `LOG_BODY` 的 body 行（body 只在拦截器里读得到），
   不统计耗时、不记访问行。拦截器与过滤器会看到同一个异常，不要在拦截器里重复记失败
5. `registerProcessErrorHandlers()` —— `uncaughtException` / `unhandledRejection` 记 fatal 后 `exit(1)`，
   必须在 logger 接管之后注册

### `LOG_BODY`

- `LOG_BODY=true` 时输出 `${method} ${url} body: {...}`（`log` 级别），默认关闭
- 经 `logger/sanitize.ts` 脱敏：敏感字段整值替换为 `***`，超长字符串/数组/对象/深度/整行都有上限
- body 为空（`{}` / `null` / 空白串）时不产生该行
- body 行独立成行，不并入 access 行

### `formatError`

- `logger/error-format.ts` 的 `formatError()` 逐层展开 `error.cause`（最多 5 层，前缀 `caused by:`，
  带循环引用保护），并摘出 `code` / `severity` / `detail` / `constraint` / `errno` 等字段
- drizzle 的外层 message 只有 SQL 文本，真实原因在 `cause` 里；只看外层会丢掉根因
- 首层错误保持简写（无堆栈时只取 `message`）；cause 链上的库错误取 `Name: message`
- 写单行日志前必须过 `toSingleLine()`，库异常的 message 常带换行
- 日志统一先拼成**单个字符串**再交给 Logger（第二个字符串参数会被当成 context）

新增业务日志用 `new Logger('Context')`，不要用 `console.log`。

### 断点调试

- `pnpm start:debug` 监听 9229；`tsconfig` 开了 `sourceMap`，`.vscode/launch.json` 提供
  "Attach to Nest (9229)"，`.vscode/tasks.json` 提供背景任务
- 异常堆栈显示 TS 行号靠 `--enable-source-maps`（已写进 `start*` scripts）
- 按请求定位：带 `x-trace-id` 发请求，再在业务代码里对 `getTraceId()` / `req.traceId` 设条件断点

---

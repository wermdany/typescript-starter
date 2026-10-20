# AGENTS.md — 项目约定与协作指南

> 本文件是项目约定的唯一来源，供 AI 编码助手与协作者阅读。
> **新增功能、修改约束时，一律参照现有代码的写法和格式来写，不要另起一套。**

---

## 0. 开发服务器已在运行，不要自己重启

- 开发服务器由 `pnpm start:dev`（`nest start --watch`）启动，监听 `http://localhost:8000`
- **不要**执行 `pnpm start` / `pnpm start:dev` / `pnpm start:prod`，也不要 kill 8000 端口上的进程
- watch 模式在文件保存后自动重编译并重启（通常 1~3 秒），改动会自动生效
- 验证流程：改代码 → 等 1~3 秒 → 直接 curl 已运行的服务器

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN      # 有输出 = 在运行
curl -s 'http://localhost:8000/users?pageSize=1'
```

- 新增路由返回 404 说明 watch 尚未重编译完，等 1~2 秒再试，而不是重启服务
- 服务器确实挂了（端口无监听、连接被拒）时，先向用户确认，不要擅自重启
- `nest-cli.json` 的 `deleteOutDir: true` 会让 `nest start` 先删整个 `dist/`，
  在本机会触发 safe-delete 保护并卡住，还可能留下多个进程抢占端口

---

## 1. 项目概览

| 项 | 选型 |
| --- | --- |
| 框架 | NestJS 12（`@nestjs/platform-express`） |
| 语言/模块 | TypeScript 6，纯 ESM（`"type": "module"`，所有导入带 `.js` 后缀；跨目录用 `@/*` 别名） |
| 包管理 | pnpm |
| 数据库 | PostgreSQL 17（`docker-compose.yaml`）+ drizzle-orm 0.45 + `pg` 驱动 |
| 校验 | zod v4（不使用 class-validator / class-transformer） |
| 测试 | Vitest；测试放在各目录/模块的 `__tests__/*.spec.ts` |
| Lint/格式化 | oxlint + Prettier（单引号、`trailingComma: all`） |
| 配置 | `@nestjs/config` + zod schema，启动时 fail-fast |

---

## 2. 目录结构

```
src/
├── main.ts                       # 入口：loadEnv + FileLogger + createApp + listen + 启动日志
├── server.ts                     # createApp()：创建应用、注册中间件，不监听端口（测试复用）
├── app.module.ts                 # 根模块：ConfigModule / AppConfigModule / DatabaseModule / 业务模块
├── app.config.ts                 # APP_FILTER / APP_INTERCEPTOR 集中注册
├── __tests__/                    # 应用级测试（真实启一个应用，mock 掉数据库）
├── config/
│   ├── env.ts                    # 全部环境变量的 zod schema（唯一出处）+ loadEnv()
│   └── __tests__/
├── common/api-response/api-response.ts     # 响应契约类型 + 默认文案常量（只放类型）
├── shared/                       # 常用工具：从 barrel 引入，不要记具体文件名
│   ├── common.ts                 #   @ApiMessage / @SkipTransform / 响应类型 / paginate / 哈希
│   ├── validation.ts             #   trimmed / trimmedShape / passwordSchema / paginationSchema
│   ├── decorators/               #   装饰器实现
│   ├── pagination/               #   paginate() + paginationSchema
│   ├── validation/               #   trimmed/trimmedShape、passwordSchema（含 __tests__/）
│   ├── crypto/password.scrypt.ts #   scrypt 哈希/校验
│   └── http/                     #   全局 HTTP 组件：HttpExceptionFilter / TransformInterceptor /
│                                 #   ZodValidationPipe（只由 app.config.ts 与 Controller 用，不进 barrel）
├── database/                     # @Global 数据库模块
│   ├── database.module.ts        # DatabaseModule
│   ├── database.service.ts       # DatabaseService（连接池 + drizzle 实例 + 事务助手）
│   └── schema/                   # columns.ts（timestamps()）/ index.ts / *.schema.ts
├── logger/                       # FileLogger、trace、access-log、body 日志、错误格式化、进程级兜底
│   ├── failure-summary.ts        # 失败摘要的类型与 res.locals 键名（过滤器与访问日志共用）
│   └── __tests__/
├── startup/local-addresses.ts    # 启动时枚举可访问地址
└── modules/<domain>/             # 业务模块（当前只有 user）
    ├── <domain>.module.ts
    ├── <domain>.controller.ts
    ├── <domain>.service.ts
    ├── <domain>.projection.ts    # 对外字段白名单 + XxxResponse 类型
    ├── dto/                      # zod schema + z.infer 类型
    └── __tests__/                # 该模块的测试
```

**分层**：Controller 只做路由与参数校验；Service 承载全部业务逻辑（SQL、哈希、异常转换）；
`<domain>.projection.ts` 以列白名单界定对外字段；DTO 用 zod schema 定义并导出 `z.infer` 类型。

**依赖方向**（只允许自下而上）：

- `config`、`common`、`shared`：不依赖任何业务代码
- `logger`：`shared` 不依赖 `logger`；过滤器只依赖 `logger/failure-summary`（纯类型与键名）
- 业务模块可以依赖 `database` 的 schema 与 `DatabaseService`（@Global）
- 业务模块之间不互相 import，需要共享时下沉到 `shared`（工具）或 `common`（纯类型/契约）

**测试位置**：测试文件一律放在被测代码所在目录（或其所属模块）的 `__tests__/` 下，
`src/` 其它位置不出现 `*.spec.ts`；`tsconfig.build.json` 已排除 `__tests__`，构建产物不含测试。
每个测试文件只测自己模块的代码，不为别的模块造数据（管道测试用本地 schema，不 import 业务 DTO）。
应用级（HTTP 全链路）测试放 `src/__tests__/`：`createApp()` 起真实应用，`vi.mock` 掉 `DatabaseService`，用 supertest 断言。

---

## 3. 常用命令

```bash
pnpm install          # 安装依赖

pnpm build            # 编译（nest build）
pnpm lint             # oxlint src/
pnpm format           # prettier 写入 src/**/*.ts
pnpm test             # 单测
pnpm test:cov         # 覆盖率
pnpm test:e2e         # e2e（当前没有 *.e2e-spec.ts）

docker compose up -d db   # 启动本地 Postgres（localhost:5432/learn_nest）
pnpm db:push          # 把 schema 推到数据库
pnpm db:generate      # 生成迁移 SQL 到 drizzle/
pnpm db:migrate       # 执行迁移
pnpm db:studio        # 可视化查看数据
```

`start` / `start:dev` 已在运行，见第 0 节。

---

## 4. 环境变量

所有环境变量集中在 `src/config/env.ts` 的 `envSchema` 里声明。**校验只有一个入口**：
`main.ts` 启动时调 `loadEnv()` 解析 `process.env`，缺失或非法直接启动失败并列出所有问题。
`ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })` 不再挂 `validationSchema` ——
它会在同一个进程内每个 TestingModule 实例化时重复校验，而配置早已由 `loadEnv()` 保证，
`DatabaseService` 等通过 `ConfigService` 读取时拿到的就是已校验的值。

规则：

- **必填**变量不写 `.default()`；可选变量用 `.default()` / `.optional()`
- 数字类变量用 `z.coerce.number()`（如 `PORT: z.coerce.number().int().positive().default(8000)`）
- **布尔类变量不要用 `z.coerce.boolean()`**：它等价 `Boolean(value)`，`Boolean('false') === true`。
  用 `envBoolean()`（真值词表 `true/1/yes/on`，其余合法词为假，非法值走 `z.enum` 报 issue）
- **不要在 transform 里 `throw`**：zod v4 的 `safeParse` 不接 transform 抛出的错误（直接冒泡），
  要报失败请让值落到 `z.enum` 之类的 issue
- **新增变量必须同步进 schema**
- 业务代码取配置用 `ConfigService<Env, true>` + `get('KEY', { infer: true })` / `getOrThrow`，
  **禁止**业务代码直接读 `process.env`
- `.env` 由用户自行维护，不入库；`.env.local` 已 gitignore

当前变量：`NODE_ENV`、`PORT`、`LOG_LEVEL`、`LOG_FILE`、`LOG_BODY`、`DATABASE_URL`（必填）。

**例外**：`main.ts` 用 `loadEnv()` 直接取配置 —— `FileLogger` 必须早于 DI 容器就绪
（要注入 `NestFactory.create`），此时拿不到 `ConfigService`。其余代码一律用 `ConfigService`。

`DB_POOL_MAX` 不在 schema 里，由 `DatabaseService` 通过 `config.get('DB_POOL_MAX', 10)` 读取。

---

## 5. 响应契约

所有 HTTP 响应都经过全局拦截器/过滤器，形态统一，类型见 `src/common/api-response/api-response.ts`（常用件从 `@/shared/common.js` 取）。

**成功**（`TransformInterceptor` 包装）：

```json
{ "success": true, "message": "创建成功", "data": { "id": 1, "nickname": "小明" } }
```

- `message` 恒有值：默认 `DEFAULT_SUCCESS_MESSAGE`（`'ok'`），`@ApiMessage('创建成功')` 覆盖
- 无返回值的操作（如修改密码）`data` 为 `null`，**不要改成 204**：判别字段在 body 里
- 健康检查、文件下载等特殊端点用 `@SkipTransform()` 跳过包装

**失败**（`HttpExceptionFilter` 转换）：

```json
{ "success": false, "message": "参数校验失败", "data": null,
  "errors": [{ "path": "email", "message": "无效的电子邮件地址" }] }
```

- **参数校验失败（400）**：`message` 默认 `DEFAULT_VALIDATION_MESSAGE`（「参数校验失败」），
  可用 `new ZodValidationPipe(schema, { message: '…' })` 覆盖；`errors` 由 zod `issues` 映射而来，
  路径用点号（`address.city`），根级为空串
- **业务失败（401/404/409 等）**：`message` 为自描述短原因（如「用户不存在」「学号已存在」），无 `errors`
- **未知异常（500）**：`message` 固定「服务器内部错误」，堆栈只写服务端日志
- 新增错误场景抛 `HttpException` 子类（`NotFoundException` / `ConflictException` …），
  不要在 Controller 里手写响应对象

两条不变量：

1. **`success === (HTTP 状态码为 2xx)`**，不允许出现 `200` + `success: false`。
   过滤器是唯一失败出口；新增响应路径（自定义 filter、直接操作 `res`、中间件短路）时必须守住
2. **`message` 是给人看的文案，不是机器判据**。客户端分支只能靠 `success` / HTTP 状态码 /
   `errors[].path`；服务端只输出中文，不做 i18n。改文案不算契约变更，改 `success` 语义/字段名算

### `data` 字段：列级白名单

`data` 里的字段由 `<domain>.projection.ts` 的列白名单决定，它同时是 SQL 投影和响应类型：

```ts
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  // …
} as const;

export type UserResponse = Pick<Users, keyof typeof userPublicColumns>;
```

```ts
this.db.select(userPublicColumns).from(users).where(...)          // → UserResponse[]
this.db.insert(users).values(...).returning(userPublicColumns)    // → UserResponse[]
this.db.update(users).set(...).returning(userPublicColumns)       // → UserResponse[]
```

- **不要用 `Omit<Users, 'passwordHash'>` 黑名单**：新增列会默认泄露且编译期不报错
- **不写 `toXxxResponse()` 映射函数**：白名单在 SQL 层生效，类型由列对象直接推导
- 需要敏感列（如登录校验用的 `passwordHash`）时另行显式 select；
  单个接口要额外字段就另建投影（`{ ...userPublicColumns, deletedAt: users.deletedAt }`）
- `deletedAt` 刻意不对外：所有读路径都带 `isNull(deletedAt)`，未删用户返回的它恒为 `null`
- `<domain>/__tests__/<domain>.projection.spec.ts` 把键集合冻结成断言，加列会让测试失败

---

## 6. 请求校验

zod 管道按参数显式注册（不存在全局 ValidationPipe）：

```ts
create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {}

findOne(@Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam) {}
```

### body：严格，不做空值宽恕

JSON body 原样进 schema（只去掉文本字段首尾空白）：

| 前端想表达 | 正确写法 | 会 400 的写法 |
| --- | --- | --- |
| 不提供该字段 | 省略 key | `"keyword": ""`、`"keyword": null` |
| 提供空字符串 | 文本字段不接受空值 | `""` / 纯空白（`min(1)` 拒绝） |

依据 RFC 7396：JSON 里 `null` 是显式语义，`""` 是长度为 0 的真实值，只有键缺席才等于"没有值"。
**不要**在 `preprocess` / `transform` 里把 body 空值转 `undefined`。

### query：唯一宽容通道

`ZodValidationPipe` 读 `metadata.type`，**仅当 `type === 'query'`** 时把空值归一化为「未提供」：

- `''` 与纯空白 → `undefined`（optional 字段跳过，有默认值的回落默认值）
- URL 的值是字符串装配的产物，`?keyword=` 是传输层假象而非调用方意图
- 仅递归普通对象，数组元素不动
- 调用点零改动：`@Query(...)` 自动宽容，`@Body(...)` / `@Param(...)` 自动严格

### 首尾空白

- 多字段 DTO 一律 `z.object(trimmedShape({...}))`，每个顶层字段自动 `trimmed`，无例外（`password` 也 trim）
- `trimmed()` 只 trim、不产出 `undefined`：trim 后为空就是空串，交给字段自身约束判定
- 不要写 `z.string().min(8).max(128).trim()`：zod 的 check 按链式顺序执行，
  `'        '` 会先过 `min(8)` 再被 trim 成空串
- 只处理顶层字段；嵌套对象在其定义处自行 `z.object(trimmedShape({...}))`

### 路径参数

路径参数是顶层字符串，query 归一化与 shape 包装都覆盖不到，两个方向都要显式处理
（见 `dto/params.dto.ts`）：

- 文本类 `:studentNo` → `trimmed(studentNoSchema)`
- 数字类 `:id` → `trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`；
  **不要**用 `z.coerce.number()`（`Number('') === 0` 会把空值误报成 `Too small`，
  且 `'0x10'` / `'1e0'` 会被当成合法数字）

其他规则：

- HTTP query 天然是字符串，数字字段用 `z.coerce.number()`
- 路径参数 schema 复用（`idParamSchema` 供全部 `:id` 路由使用）
- 更新类 DTO 用 `.refine()` 保证至少提供一个字段
- **路径参数放在 URL 末尾**：路由形如 `password/:id`、`restore/:id`，不要写 `:id/password`——
  参数后面的静态段容易与子资源路径混淆，也不好按前缀做日志/网关规则
- **静态段路由必须声明在 `:id` 之前**（如 `@Get('by-student-no/:studentNo')` 放在 `@Get(':id')` 前）；
  参数收在末尾后，同前缀的静态路由排序依然要守住这条

---

## 7. 分页与排序

- 列表 query DTO 用 `paginationSchema.extend(trimmedShape({...}))`（`page` 默认 1，`pageSize` 默认 10、上限 100）
- 查询走 `paginate()` 回调式助手，返回 `PageResponse<T>`（`items/total/page/pageSize/totalPages`）：

```ts
const result = await paginate(
  (limit, offset) => ({
    rows: this.db.select(userPublicColumns).from(users).where(where).orderBy(orderBy).limit(limit).offset(offset),
    total: this.db.select({ value: count() }).from(users).where(where).then((r) => r[0]?.value ?? 0),
  }),
  query.page,
  query.pageSize,
);
```

- 助手只负责分页数学与并发编排，ORM 查询仍显式构建
- 模糊搜索必须转义 LIKE 通配符（`user.service.ts` 的 `escapeLike()`）

**默认排序：所有列表接口一律 `updatedAt` 降序。**

- query DTO 默认 `sortBy: 'updatedAt'`、`order: 'desc'`
- `sortBy` 枚举白名单必须包含 `updatedAt`
- 排序字段映射表用对象字面量按 `query.sortBy` 索引，枚举缺项时 TS 在索引处报错；
  再按 `query.order === 'desc' ? desc(col) : asc(col)` 应用

---

## 8. 数据库与 Drizzle

- 通用列：每张表展开 `...timestamps()`（**必须函数调用**，列 builder 单次使用，共享对象会导致列名错乱）；
  `deletedAt IS NULL` 表示未删除
- **`updatedAt` 不会自动更新**：`update` / `softDelete` / `restore` 手动 `set({ updatedAt: new Date() })`
- **软删除**：所有业务查询带 `isNull(users.deletedAt)`；`restore` 带 `isNotNull`；
  删除/更新时 `where` 也带 `isNull` 以防重复操作
- **pg 错误先解包**：drizzle 把驱动错误包成 `DrizzleQueryError`，原始错误在 `err.cause`，
  读 `code` / `constraint` 前必须先解包（否则 409 会退化成 500）
- **`Pool` 必须挂 `error` 监听器**：空闲连接被掐断时没有监听器会让进程直接退出
- 唯一冲突统一转中文 409（`UserService.handlePgError()`）：`student_no` 列级 unique，
  `email` 由部分唯一索引 `users_email_alive_idx`（仅覆盖未删行）保证，
  因此恢复软删用户可能因 email 冲突 409
- 多表一致性操作用 `DatabaseService.transaction()`，不要手工 BEGIN
- schema 变更后开发期用 `pnpm db:push`，需要留痕再用 `db:generate` + `db:migrate`
- 派生类型用 `typeof users.$inferSelect` / `$inferInsert`，新增 schema 在 `schema/index.ts` 导出

---

## 9. 密码

- 用 Node 内置 `node:crypto` 的 scrypt（不使用 bcrypt），工具在 `src/shared/crypto/password.scrypt.ts`（从 `@/shared/common.js` 引入）
- 存储格式自描述：`scrypt$N$r$p$saltHex$hashHex`；`verifyPassword()` 从存储串解析参数，
  用 `timingSafeEqual` 恒定时间比对
- 哈希在 DB 操作之前计算，避免占用连接
- 哈希永不外泄：`passwordHash` 不在投影白名单里，需要时必须另行显式 select

### 规则（`src/shared/validation/password.ts`）

`passwordSchema` 是创建用户与修改密码新密码的唯一出处：

| 约束 | 值 |
| --- | --- |
| 长度 | 8~18（`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`），按字符计 |
| 字符白名单 | `^[A-Za-z0-9_]+$`（`PASSWORD_ALLOWED_CHARS`） |
| 字符类别 | 字母/数字/下划线三类中至少占两类 |

- 白名单而非黑名单：黑名单挡不住 emoji、Unicode 空白（`\u200b`）与同形字符
- 规则只在 schema 层，数据库结构不变（只存哈希），不需要迁移
- ⚠️ **`oldPassword` 不要套 `passwordSchema`**：库里存在规则收窄前设定的密码
  （种子演示账号 `12345678` 等），用新规则卡旧密码会把老用户锁在门外。
  旧密码只要求非空 + `LEGACY_PASSWORD_MAX_LENGTH`（128，仅作 scrypt 输入规模兜底）

### 修改密码：`PATCH /users/password/:id`

- 请求体 `{ oldPassword, password }`，两个字段都经 `trimmedShape()` 规范化
- 流程（`UserService.changePassword()`）：显式 `select({ passwordHash })` → 不存在 404
  → `verifyPassword()` 不符 **401**「旧密码不正确」→ 通过后才 `hashPassword()` 写库
- **401 而不是 400**：参数合法，失败点在凭据。客户端靠状态码区分
  400（格式/规则，带 `errors[]`）/ 401（旧密码错）/ 404（用户不存在）
- 旧密码比对是 scrypt（慢），**先判存在再比对**
- 目前是**自助改密**语义（凭旧密码即可改）。项目没有登录/鉴权模块，
  将来接入鉴权后应改为从会话取当前用户，不要信任路径上的 `:id`

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

## 11. 代码风格

- 纯 ESM：**所有导入都必须带 `.js` 后缀**（含别名 `@/…js`）
- **跨目录一律用别名** `@/` → `src/`（如 `@/shared/common.js`、`@/database/database.service.js`），
  不写 `../../`；同目录/同级子目录用相对路径（`./dto/x.dto.js`、`../x.js`）
- **常用件走 barrel**：`@/shared/common.js`（装饰器、响应类型、分页、哈希）、
  `@/shared/validation.js`（trimmed/trimmedShape、passwordSchema、paginationSchema）；
  不要在业务代码里直接引 `@/shared/validation/trimmed.js` 这类内部路径
- 新增工具落到 `src/shared/<用途>/`，若会被多数业务文件使用，就同时在对应 barrel 里导出
- Prettier：单引号、`trailingComma: all`、2 空格缩进（`pnpm format`）
- oxlint：`@typescript-eslint/no-explicit-any` 关闭、`no-floating-promises` 为 warn（新增 async 调用要 await）
- **注释写中文，只写必要信息**：说明职责、约束与"为什么这样写"的关键取舍；
  不写代码已能表达的"是什么"，不写改动历史/旧实现对比
- 文件或类用 `/** ... */` 说明职责；复杂函数或需要示范的场景用 JSDoc `@example`
- `strict: true`，避免 `any` 与类型断言；对外类型优先用 `z.infer` / `$inferSelect` / `Pick` 派生

---

## 12. 开发完成后必须做的验证

按顺序执行，**不需要重启服务器**：

1. `pnpm lint`
2. `pnpm build`（看退出码；tsc 默认即使报错也会 emit）
3. `pnpm test`
4. 在已运行的服务器上端到端验证（第 0 节）：
   - `lsof -nP -iTCP:8000 -sTCP:LISTEN` 确认服务在跑，等 1~3 秒再 curl
   - 覆盖成功路径 + 400（带 `errors`）+ 404 + 409（唯一冲突）+ 401（旧密码错误，仅改密接口）
   - 例：`curl -s -X POST http://localhost:8000/users -H 'Content-Type: application/json' -d '{...}'`；
     被本机代理拦截时加 `--noproxy '*'`
   - **响应契约**：成功体 `success:true` 且 2xx；失败体 `success:false` + `data:null`；
     400 带 `errors[]`，404/409 不带
   - **字段白名单**：响应里不应出现 `passwordHash` / `deletedAt`
   - **入参边界**：`curl '.../users?page=&pageSize=&keyword='` 正常返回；
     body 传 `"nickname": ""` 应 400 且 `errors[].path` 为 `nickname`
   - **改密**：旧密码错误 401；省略 `oldPassword` 400 且路径为 `oldPassword`；新密码违规 400 且路径为 `password`
   - **日志**：`logs/app.log` 中响应头 `x-trace-id` 与日志行前缀一致，同一请求多行 traceId 相同，
     前缀在消息之前且不重复（`grep -ao '\[traceId=[^]]*\]'` 无 `[traceId=a] [traceId=a]`），
     无 ANSI 残留（`grep -a $'\x1b' logs/app.log` 无输出）；4xx 命中路由只有 access 一行
     （warn），5xx 恰好两行（过滤器 error + access error，traceId 相同）
   - **启动日志**：`grep '服务已就绪\|可访问地址\|启动耗时' logs/app.log`
   - `LOG_BODY` 相关改动对比开关前后：关闭时无 `body:` 行，开启时有且敏感字段为 `***`
5. 清理验证产生的测试数据（软删也算留痕），不要把脏数据留在库里

---

## 13. 已知坑

- **启动开发服务器会触发 safe-delete 保护**（`deleteOutDir: true`）→ 见第 0 节
- **drizzle 包装 pg 错误**：判断 `23505` 必须先读 `err.cause`
- **`timestamps()` 是函数**：写成共享对象常量会导致多表列名错乱
- **`updatedAt` 不自动更新**：所有 update 手动 set
- **路由顺序**：`by-student-no/:studentNo` 必须在 `:id` 之前（路径参数放 URL 末尾，见第 6 节）
- **路径参数不要用 `z.coerce.number()`**：`Number('') === 0` → 见第 6 节
- **空值宽容只发生在 query**：body 里的 `""` / 纯空白 / `null` 一律如实校验；
  发现 body 空串"被静默忽略"，说明有人加回了空值包装
- **`trimmed` 不产出 `undefined`**：trim 后为空就是空串，由字段自身约束判定
- **`ZodValidationPipe` 的宽容靠 `metadata.type === 'query'`**：单测里直调
  `pipe.transform(value)` 走严格分支，要宽容须显式传 `{ type: 'query' }`
- **日志不落盘先查 `LOG_FILE`**：filePath 为空时 `FileLogger` 不建文件通道
- **`bufferLogs: true` 无效**：`init()` 末尾会先 flush；logger 必须注入 `NestFactory.create`
- **`z.coerce.boolean()` 会把 `'false'` 判成 `true`** → 用 `envBoolean()`（第 4 节）
- **zod v4 的 transform 里 `throw` 不被 `safeParse` 接住** → 用 `z.enum` 报 issue
- **body parser 早于 `NestModule.configure()`**：中间件要覆盖 malformed JSON / 无路由 404，
  必须在 `createApp()`（`server.ts`）里 `app.use()` 早注册
- **`source-map-support` 不再使用**：改用 Node 原生 `--enable-source-maps`，不要 import 它
- **异常日志用单个字符串**：第二个字符串参数会被当成 context
- **排查 500 先看 `caused by:`**：只有外层 `Failed query: ...` 说明根因没展开
- **多行 message 会劈开日志行**：单行日志必须过 `toSingleLine()`
- **pg `Pool` 没有 `error` 监听器会杀掉进程** → 见第 8 节
- **access 日志在中间件层**：删掉 `app.use(accessLogMiddleware)` 会让所有访问行无声消失
- **收尾回调里必须 `runWithTraceId` 恢复上下文**：客户端中断时 `close` 由 socket 触发，
  上下文已丢失，不恢复会丢 traceId
- **access 行耗时**从中间件入口算到响应收尾，含 body 解析 / 守卫 / 校验 / 序列化
- **`success` 与 HTTP 状态码必须同向**；无返回值接口不要改成 204；`message` 不是机器判据
- **没有 `code` 字段**：判别字段是 `success`
- **HTTP 全链路测试**在 `src/__tests__/bootstrap.spec.ts`：mock 了 `DatabaseService`，不能用来验证 SQL；
  验证真实查询要去已运行的服务上 curl。`pnpm test:e2e` 目前没有独立用例

---

## 14. 新增业务模块的清单

以 `src/modules/user/` 为范式：

1. `database/schema/<domain>.schema.ts` —— 建表（`...timestamps()`）+ 索引；在 `database/schema/index.ts` 导出
2. `dto/*.ts` —— zod schema（`create` / `update` / 列表 query 用 `paginationSchema.extend(trimmedShape({...}))`，
   默认排序 `updatedAt` 降序）+ 导出 `z.infer` 类型
3. `<domain>.projection.ts` —— `xxxPublicColumns`（`as const`）+
   `type XxxResponse = Pick<Xxx, keyof typeof xxxPublicColumns>`；Service 的 `select` / `returning` 一律传它
   （不要 `Omit`、不要映射函数）；补 `__tests__/<domain>.projection.spec.ts` 冻结字段集合
4. `<domain>.service.ts` —— 业务逻辑；查询带 `isNull(deletedAt)`；`updatedAt` 手动更新；
   唯一冲突转 409（先解包 `cause`）；分页/哈希从 `@/shared/common.js` 取
5. `<domain>.controller.ts` —— REST 路由 + `ZodValidationPipe`（`@/shared/http/zod-validation.pipe.js`）
   按参数注册 + `@ApiMessage`（`@/shared/common.js`）；路径参数放 URL 末尾（`password/:id`），
   静态段路由排在 `:id` 前
6. `<domain>.module.ts` —— 声明 controller/service（`DatabaseModule` 是 `@Global`，无需 import）
7. 在 `app.module.ts` 的 `imports` 注册模块
8. 按第 12 节验证；测试写到 `<domain>/__tests__/*.spec.ts`，只测本模块代码

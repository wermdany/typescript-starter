# AGENTS.md — 项目约定与协作指南

> 本文件是本项目**约定的唯一来源**，供 AI 编码助手与协作者阅读。
> 修改任何约定时，请同步更新本文件。

---

## 0. 最重要的一条：开发服务器已在运行，不要自己重启

**默认前提：开发服务器已经在跑。新功能开发完成后，直接在已启动的服务器上做验证，不要自己启动或重启服务。**

- 当前开发服务器由 `pnpm start:dev`（即 `nest start --watch`）启动，监听 `http://localhost:8000`
- **不要**自行执行 `pnpm start` / `pnpm start:dev` / `pnpm start:prod` 起服务 —— 会和已运行实例抢 8000 端口
- **不要**为了"让改动生效"而重启服务，**不要** kill 8000 端口上的进程
- watch 模式会在文件保存后**自动重编译并重启**（通常 1~3 秒），改动会自动生效
- 因此验证流程是：**改代码 → 等 1~3 秒 → 直接 curl 已在运行的服务器**

### 判断服务器状态

```bash
# 有输出 = 在运行
lsof -nP -iTCP:8000 -sTCP:LISTEN

# 冒烟测试
curl -s 'http://localhost:8000/users?pageSize=1'
```

**判断改动是否已生效**：curl 本次新增的路由，返回 404 说明 watch 尚未重编译完，等 1~2 秒再试一次 —— 而不是重启服务。

**若服务器确实挂了**（端口无人监听、curl 连接被拒）：不要擅自重启，先向用户确认。

> **为什么"重启服务"在这里不是随手操作：**
> `nest-cli.json` 配置了 `deleteOutDir: true`，`nest start` 启动时会先删除整个 `dist/`，
> 在本机会触发 safe-delete 保护（>50 文件需人工确认），非常容易卡住。己方起服务还可能留下
> 多个僵尸进程占用 8000 端口，后续排查成本很高。

---

## 1. 项目概览

NestJS 12 后端服务（学生/用户管理方向），纯 ESM，PostgreSQL + Drizzle ORM。

| 项 | 选型 |
| --- | --- |
| 框架 | NestJS 12（`@nestjs/platform-express`） |
| 语言/模块 | TypeScript 6，**纯 ESM**（`"type": "module"`，相对导入必须带 `.js` 后缀） |
| 包管理 | **pnpm**（`pnpm-lock.yaml` + `pnpm-workspace.yaml`），不要用 npm/yarn 安装 |
| 数据库 | PostgreSQL 17（`docker-compose.yaml`）+ drizzle-orm 0.45 + `pg` 驱动 |
| 校验 | **zod v4**（不使用 class-validator / class-transformer） |
| 测试 | Vitest 4（单测 `*.spec.ts` + e2e `*.e2e-spec.ts`） |
| Lint/格式化 | oxlint + Prettier（单引号、trailingComma: all） |
| 配置 | `@nestjs/config` + zod schema，启动时 fail-fast |

---

## 2. 目录结构

```
src/
├── main.ts                       # 入口：FileLogger 接管 + 启动检测（耗时/服务地址）+ app.listen(PORT)
├── app.module.ts                 # 根模块：ConfigModule / DrizzleModule / 业务模块 / 全局拦截器+过滤器
├── config/env.ts                 # ★ 全部环境变量的 zod schema（唯一出处）
├── common/                       # 跨模块通用件
│   ├── crypto/password.scrypt.ts #   scrypt 哈希/校验
│   ├── decorators/               #   @ApiMessage / @SkipTransform
│   ├── filters/http-exception.filter.ts   # 全局异常 → 失败契约
│   ├── interceptors/transform.interceptor.ts # 全局成功契约包装
│   ├── pagination/               #   paginationSchema + paginate() + PageResponse
│   ├── pipes/zod-validation.pipe.ts       # 按参数注册的 zod 校验管道（query 空值宽容 / body 严格）
│   ├── response/api-response.ts  #   ★ 响应契约类型（ApiResponse / FieldError）
│   └── startup/local-addresses.ts #   启动时枚举可访问地址（回环 + 局域网 IPv4）
├── db/
│   ├── drizzle/                  #   DrizzleModule(@Global) + DrizzleService
│   └── schema/                   #   columns.ts（timestamps()）/ index.ts / *.schema.ts
├── logger/                       # FileLogger + log-levels + access-log 中间件 + body 日志拦截器 + trace/sanitize/进程级兜底
└── modules/<domain>/             # ★ 业务模块统一放这里
    ├── <domain>.module.ts
    ├── <domain>.controller.ts
    ├── <domain>.service.ts
    ├── <domain>.mapper.ts        #   实体 → 对外响应（剔除敏感字段）
    └── dto/                      #   zod schema + z.infer 类型
```

**分层铁律**：Controller 只做路由与参数校验；Service 承载全部业务逻辑（SQL、哈希、异常转换）；
Mapper 负责实体到响应的显式转换；DTO 用 zod schema 定义并导出 `z.infer` 类型。

---

## 3. 常用命令

```bash
pnpm install          # 安装依赖

pnpm build            # 编译（nest build）
pnpm lint             # oxlint src/
pnpm format           # prettier 写入 src/**/*.ts
pnpm test             # 单测（**/*.spec.ts）
pnpm test:e2e         # e2e（**/*.e2e-spec.ts）

docker compose up -d db   # 启动本地 Postgres（localhost:5432/learn_nest）
pnpm db:push          # 把 schema 推到数据库（开发期首选）
pnpm db:generate      # 生成迁移 SQL 到 drizzle/
pnpm db:migrate       # 执行迁移
pnpm db:studio        # 可视化查看数据
```

> `start` / `start:dev` 已在运行 —— 见第 0 节，**不要执行**。

---

## 4. 环境变量约定

所有环境变量**集中**在 `src/config/env.ts` 的 zod schema 里声明，`ConfigModule.forRoot()` 的
`validationSchema` 在启动时做 fail-fast 校验（缺必填变量直接启动失败，报错信息列明缺失项）。

规则：

- **必填**变量不写 `.default()`；**可选**变量用 `.default()` / `.optional()` 声明
- 数字类变量用 `z.coerce.number()`（如 `PORT: z.coerce.number().int().positive().default(8000)`）
- **布尔类变量不要用 `z.coerce.boolean()`** —— 它等价 `Boolean(value)`，而环境变量是字符串，
  于是 `Boolean('false') === true`，`.env` 里写 `LOG_BODY=false` 会被判成开启。用 `envBoolean()` 助手
  （见 `env.ts`，真值词表 `true/1/yes/on`，其余合法词为假，非法值走 `z.enum` 报标准 issue）
- **不要在校验/transform 里 `throw`**：zod v4 的 `safeParse` **不接** transform 抛出的错误（会直接冒泡），
  破坏 `loadEnv()` / ConfigModule 统一聚合报错的行为 —— 要报失败请让值落到 `z.enum` / issue
- **新增变量必须同步更新 schema**；`DB_POOL_MAX` 这类仅在少数位置读取的变量也应补进 schema
- 业务代码取配置一律用 `ConfigService<Env, true>` + `get('KEY', { infer: true })`（或 `getOrThrow`），
  **禁止**业务代码直接读 `process.env`
- `.env` 由用户自行维护（`.env.example` 已删除，不再维护）；本地覆盖写 `.env.local`（已 gitignore）；
  敏感值由部署平台注入，不入库

当前变量：`NODE_ENV`、`PORT`(默认 8000)、`LOG_LEVEL`、`LOG_FILE`(默认 `logs/app.log`)、
`LOG_BODY`(默认 false)、`DATABASE_URL`(必填)。

**例外：`main.ts` 用 `loadEnv()` 直接取配置，不走 ConfigService** —— `FileLogger` 必须早于 DI 容器
就绪（要注入 `NestFactory.create`），而 `ConfigService` 得等 app 创建完。`loadEnv()` 走的是同一份
`envSchema`（不是裸读 `process.env`），顺带让"缺必填变量"在起服务前就 fail-fast；
`ConfigModule.forRoot` 的校验保留，其余业务代码一律仍用 `ConfigService`。

---

## 5. 响应契约（全局统一）

**所有** HTTP 响应（含 404/500）都经过全局拦截器/过滤器，形态统一为
`{ code, message, data }`，契约类型见 `src/common/response/api-response.ts`。

**成功**（`code: 0`，由 `TransformInterceptor` 包装）：

```json
{ "code": 0, "message": "ok", "data": { "id": 1, "nickname": "小明" } }
```

- message 默认 `'ok'`，用 `@ApiMessage('创建成功')` 覆盖
- handler 返回 `undefined`/`null` 时 `data` 归一为 `null`
- 健康检查、文件下载等特殊端点用 `@SkipTransform()` 跳过包装

**失败**（`code` = HTTP 状态码，`data: null`，由 `HttpExceptionFilter` 统一转换）：

```json
{ "code": 400, "message": "参数校验失败", "data": null,
  "errors": [{ "path": "email", "message": "Invalid email address" }] }
```

- **参数校验失败（400）**：`message` 固定「参数校验失败」，额外带 `errors: [{ path, message }]`
  —— 由 zod `issues` **映射**而来（不是透传 zod 原始结构），字段路径用点号（`address.city`），根级为空串
- **业务失败（404/409 等）**：`message` 为自描述短原因（如「用户不存在」「学号已存在」），**无** `errors`
- **未知异常（500）**：`message` 固定「服务器内部错误」，堆栈只写服务端日志，**不泄漏给客户端**
- 新增错误场景请抛 `HttpException` 子类（`NotFoundException` / `ConflictException`…），
  不要在 Controller 里手写响应对象

---

## 6. 请求校验与前端契约

zod 管道是"有参管道"，**按参数显式注册**（不存在全局 ValidationPipe）：

```ts
create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {}

findOne(@Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam) {}
```

### 请求体（body）契约：必须"干净"，后端不做空值宽恕

**JSON body 原样进 schema**（只去掉文本字段的首尾空白），**不把空值转成"未提供"**：

| 前端想表达 | 正确写法 | 会被 400 的写法 |
| --- | --- | --- |
| 不提供该字段 | **省略这个 key** | `"keyword": ""`、`"keyword": null` |
| 提供空字符串 | ——（文本字段不接受空值，`min(1)` 会拒） | —— |

- `""` / 纯空白 → 由字段自身约束报 400（`Too small: expected string to have >=1 characters`）
- `null` → 报 `received null`
- **依据（RFC 7396 / JSON Merge Patch）**：JSON 里 `null` 是**显式语义**（"删除该字段"）、
  `""` 是长度为 0 的**真实值**，只有"键缺席"才等于"没有值"。把 `null` / `""` 吞成"未提供"
  会让 PATCH 无法表达"清空某字段"，也把"显式置空"与"前端忘了传"混为一谈
- 因此**不要**再引入任何"空值包装"（在 `preprocess` / `transform` 里把空值转 `undefined`）——
  schema 层保持**严格且与来源无关**

### URL query：唯一的宽容通道（管道按来源自动判定）

管道从 Nest 传入的 `ArgumentMetadata.type` 读**参数来源**（框架给的事实，不是猜测），
**仅当 `type === 'query'`** 时把空值归一化为「未提供」：

- `''` 与**纯空白字符串**（`' '`、`'\t'`）→ `undefined`：optional 字段通过、default 回落默认值
- **为什么只对 query 宽容**：URL 的值是**字符串装配的产物**——浏览器表单、`URLSearchParams`
  无法表达"这个键不存在"（清空的输入框天生就是 `?keyword=`），这是**传输层假象**而非调用方意图，
  宽容掉不丢语义；而 JSON body 天然能表达缺席，宽容只会掩盖前端 bug
- 仅递归**普通对象**；**数组元素不动**（数组内空串多为有意占位，如多选筛选）
- **调用点零改动**：`@Query(new ZodValidationPipe(schema))` 自动宽容，`@Body(...)` / `@Param(...)`
  自动严格 —— 注册处不需要写任何标记，新增路由不会漏写（社区管道同样按来源分流）

### 首尾空白与路径参数

- `trimmedShape({...})` 仍是 DTO 的**默认写法**：自动给每个顶层字段去掉首尾空白
  （非字符串字段透传、无副作用）；例外字段就近写 `.meta({ keepWhitespace: true })`（目前只有 `password`）
- **`trimmed` 只 trim，不产出 `undefined`** —— trim 后为空就保持空串，交给字段自身的 `min(1)` 判定。
  历史版本曾在 schema 层做"trim 后为空 → 未提供"，已废弃：那让同一份 schema 无法区分"谁在宽容"，
  也把 body 的空串一并吞掉了
- 只处理**顶层字段**；嵌套对象（如 `address`）在其定义处自行包一层 `z.object(trimmedShape({...}))`；
  数组元素不处理
- `trimmed(schema)` 用于**顶层非 shape** 场景（`:id` / `:studentNo` 路径参数）——路径参数是顶层字符串，
  query 归一化与 shape 包装都覆盖不到它，两个方向都要显式处理（都在 `reset-password.dto.ts`）：
  - 文本类 `:studentNo` → `trimmed(studentNoSchema)`
  - 数字类 `:id` → `trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`：
    **不能**只用 `z.coerce.number()`——`Number('') === 0` 会把空值误报成
    `Too small: expected number to be >0`（看不出"没传"还是"传了 0"），且 `Number()` 会把 `'0x10'`
    解析成 16、`'1e0'` 解析成 1；`/^\d+$/` 前置收紧后再 `.pipe()` 保留数字域校验
    （`'0'` → `>0`，超安全整数 → `Too big`）

其他规则：

- HTTP query 天然是字符串，数字字段一律 `z.coerce.number()`
- 路径参数 schema 复用（如 `idParamSchema` 供全部 `:id` 路由使用）
- 数字 ID 是**数据库生成、不接受客户端指定**，因此 schema 只管"是不是合法正整数"，
  不额外约束业务范围（如 int4 上限）
- 更新类 DTO 需保证"至少提供一个字段"，用 `.refine((v) => Object.keys(v).length > 0, ...)`
- **静态段路由必须声明在 `:id` 之前**（如 `@Get('by-student-no/:studentNo')` 要在 `@Get(':id')` 之前）

---

## 7. 分页约定

- 列表 query DTO 用 `paginationSchema.extend({ ... })`（`page` 默认 1，`pageSize` 默认 10、上限 100）
- 查询走 `paginate()` 回调式助手，返回 `PageResponse<T>`（`items/total/page/pageSize/totalPages`）：

```ts
const result = await paginate(
  (limit, offset) => ({
    rows: this.db.select().from(users).where(where).orderBy(orderBy).limit(limit).offset(offset),
    total: this.db.select({ value: count() }).from(users).where(where).then((r) => r[0]?.value ?? 0),
  }),
  query.page,
  query.pageSize,
);
```

- 助手只负责分页数学与并发编排，**ORM 查询保持显式构建**（与项目显式风格一致）
- 模糊搜索必须转义 LIKE 通配符（见 `user.service.ts` 的 `escapeLike()`）

### 默认排序：修改时间降序

**所有列表接口的默认排序一律为「修改时间（`updatedAt`）降序」**，即"最近改动的排在最前"，
与创建时间无关 —— 创建后被改过的记录应当被推到前面。

- 列表 query DTO 的排序字段默认值为 `sortBy: 'updatedAt'`、`order: 'desc'`
- `sortBy` 的枚举白名单**必须包含 `updatedAt`**（`createdAt` 可按需保留，供"按入库顺序"场景显式指定）
- 排序字段映射表也要有对应项（如 `{ ..., updatedAt: users.updatedAt }`），
  再按 `query.order === 'desc' ? desc(col) : asc(col)` 应用 —— 映射表用对象字面量按 `query.sortBy`
  索引，**枚举缺项时 TS 会在索引处直接报错**，不会静默拿到 `undefined`
- 新增任何列表接口都遵循本约定，不要各自选默认排序

---

## 8. 数据库与 Drizzle 约定

- 通用列：每张表展开 `...timestamps()`（**必须函数调用**，见下）；`deletedAt IS NULL` 表示未删除
- **`timestamps()` 必须是函数而非对象常量**：Drizzle 列 builder 单次使用，共享对象被多表 spread 会导致列名错乱
- **`updatedAt` 不会自动更新**：`update` / `softDelete` / `restore` 必须手动 `set({ updatedAt: new Date() })`
- **软删除是默认语义**：所有业务查询都要带 `isNull(users.deletedAt)`；`restore` 反而要带 `isNotNull`
  保证"只恢复已删用户"；删除/更新时 `where` 同时带 `isNull(deletedAt)` 以防重复操作
- **pg 错误要先解包**：drizzle-orm 把 pg 驱动错误包装成 `DrizzleQueryError`，**原始错误在 `err.cause` 上**，
  判断 `23505`（唯一冲突）必须先解包再读 `code` / `constraint`（否则 409 会退化成 500）。
  日志侧同理——`formatError()` 会展开 cause 链（见第 10 节）
- **`Pool` 必须挂 `error` 监听器**（`drizzle.service.ts`）：空闲连接被网络中断 / DB 重启 / 容器暂停
  掐断时 pg 会在 Pool 上 `emit('error')`，**没有监听器时 Node 会把它升级成 `uncaughtException`，
  进程直接退出**。这类抖动连接池本可自愈（剔除该死连接、下次请求重建），只记 warn 即可
- 唯一性冲突统一转中文 409（`handlePgError()`）：`student_no` 列级 unique、`email` 由**部分唯一索引**
  `users_email_alive_idx`（仅覆盖未删行）保证 —— 因此恢复软删用户可能因 email 冲突 409
- 多表一致性操作用 `this.drizzle.transaction()`，不要手工 BEGIN
- schema 变更后开发期用 `pnpm db:push`；需要留痕再用 `db:generate` + `db:migrate`
- 派生类型用 `typeof users.$inferSelect` / `$inferInsert`，新增 schema 记得在 `schema/index.ts` 导出

---

## 9. 密码约定

- **用 Node 内置 `node:crypto` 的 scrypt，不使用 bcrypt**（用户明确要求）
- 工具在 `src/common/crypto/password.scrypt.ts`：`hashPassword()` / `verifyPassword()`
- 存储格式自描述：`scrypt$N$r$p$saltHex$hashHex`；`verifyPassword` 从存储串解析参数（参数升级后旧哈希仍可用），
  用 `timingSafeEqual` 恒定时间比对
- 密码哈希在 DB 操作**之前**计算，避免占用数据库连接
- 哈希永不外泄：Mapper 用 `Omit<Users, 'passwordHash'>` 在编译期保证（不依赖全局拦截器魔法）

---

## 10. 日志与异常记录

### 落盘

- `main.ts` 用 `FileLogger`（继承 `ConsoleLogger`）接管日志：控制台 + 文件双写，
  文件内容 strip 掉 ANSI 色码
- **必须注入 `NestFactory.create({ logger })`，不要用 `app.useLogger()`**：create 阶段的日志
  （如 `Starting Nest application...`）早于 `useLogger`，那样写会永远进不了文件
- `LOG_FILE` 默认 `logs/app.log`（相对路径按 cwd 解析，内部会 `resolve` 成绝对路径）；
  显式写 `LOG_FILE=`（空值）则只输出控制台
- `LOG_LEVEL` 是"最小级别"，由 `getLogLevels()` 展开为 Nest 需要的数组（fatal 永远包含）
- 文件写入用**同步 fd 写**（`openSync` + `writeSync`，见 `file-logger.ts`）：进程级兜底记完 fatal
  要立刻 `process.exit(1)`，异步流不保证落盘，同步写天然没有"退出丢尾部日志"的问题
  （pino 默认 destination 同理）。目录/磁盘不可写时降级为仅控制台，且只警告一次

### 启动日志：服务地址 + 启动耗时

`bootstrap()` 在 `listen()` 之后用 `Logger('Bootstrap')`（与启动失败 catch 块同 context，便于一把 grep）
打以下几类行（前两类固定出现，降级行仅在无局域网 IPv4 时出现），均以固定前缀开头便于检索：

```
服务已就绪，监听 [::]:8000（所有网卡 · IPv6 通配）
可访问地址：http://127.0.0.1:8000（本机回环）
可访问地址：http://192.168.3.51:8000（en0）
可访问地址：http://198.18.0.1:8000（utun4）
启动耗时 123ms
```

- grep 锚点：`服务已就绪` / `可访问地址` / `启动耗时`
- **「监听地址」不带协议前缀**：可能是 `0.0.0.0` / `[::]` 这类通配，代表「所有网卡」而非能点的 URL
  （`describeBoundAddress()` 负责这个措辞）；**「可访问地址」一律是完整 URL**
- **不要用 `app.getUrl()` 取地址**：它把 IPv6 通配 `::` 映射成 `[::1]`
  （`@nestjs/core` 的 `formatAddress`），而本项目 `listen(port)` 在 macOS 上绑的正是 `::`，
  于是只会得到 IPv6 回环。地址枚举走 `common/startup/local-addresses.ts`（回环 +
  非 internal IPv4，跳过 `169.254.*`、去重、`en*` 优先），**只从 `getUrl()` 借协议前缀**
- ⚠️ **`app.use(traceContextMiddleware)` 必须写在 `listen()` 之前**：`app.use()` 是即时转发，
  而 body parser 在 `init()`（由 `listen()` 内部触发）里注册；挪到后面会让中间件落到
  body parser 之后，malformed JSON 400 / 无路由 404 就丢 traceId
- **不显式调 `app.init()`**：`listen()` 内部会 init，之前显式调一次只为了拿分段计时（已移除）。
  顺序保证靠的是「`app.use()` 早于 `listen()`」，与是否显式 init 无关
- 不设 `HOST` 变量，维持 `listen(port)` 通配监听；启动阶段不在请求上下文内，因此这些行**无** traceId 前缀

### 请求上下文与 traceId（全链路）

- `traceContextMiddleware`（`logger/trace.middleware.ts`）为每个请求解析/生成 traceId，
  用 Node 内置 `AsyncLocalStorage` 建立请求上下文，并回写 `x-trace-id` 响应头
- **必须在 `main.ts` 里 `app.use()`、且早于 `app.listen()`** —— 不要改成 `NestModule.configure()`：
  `NestApplication.init()` 先 `registerParserMiddleware()` 再 `registerRouter()`，而 `app.use()`
  是立即挂到 express 的，只有早注册才能排在 body parser 之前，从而"malformed JSON 的 400"
  "未命中路由的 404"也拿得到 traceId
- **入站透传优先**：读 `x-trace-id` → `x-request-id` → 都没有才 `randomUUID()`。
  有了它才能"先定 traceId，再去业务代码里设条件断点"
- **入站值必须清洗**（`sanitizeInboundTraceId`，白名单 `^[A-Za-z0-9._-]{1,128}$`）：
  traceId 会原样进日志行与响应头，不校验等于开放日志注入（CRLF 伪造日志行、超长撑爆文件）
- 业务代码取 traceId 用 `getTraceId()`（`logger/trace.ts`，读 ALS）；断点时也可直接看 `req.traceId`
- **日志行不再手写 `[traceId=...]`**：`FileLogger.printMessages` 会从上下文自动附加，
  拦截器/过滤器里手写会变成 `[traceId=x] [traceId=x]`
- **traceId 是"前置"而不是后缀**（`[traceId=xxx] 消息正文`）：异常消息/堆栈本身是多行的，
  拼在尾部只会落到最后一行；前置才能恒定出现在首行，`grep traceId=` 一眼定位到事件
- 未进上下文的日志（启动阶段、进程级异常）**不附加** traceId（注意不再是占位符 `-`）
- **`accessLogMiddleware` 必须紧跟 `traceContextMiddleware` 之后注册**：它在中间件入口用
  `getTraceId()` 捕获 traceId（收尾回调里 ALS 可能已失效，见下一条）；顺序反了就会丢 traceId
- ⚠️ **收尾回调里必须显式 `runWithTraceId(traceId, …)` 恢复上下文**：实测正常 / 错误响应的
  `finish`、`close` 回调仍在该请求的异步上下文内，但**客户端提前断开**时 `close` 由 socket 触发、
  上下文已丢失（`getTraceId()` 为 `undefined`）。不恢复则中断行的 traceId 会缺失，
  与"同一次请求多行 traceId 对得上号"的约定相悖。恢复对正常路径无副作用（`storage.run` 返回后自动还原）

### 复现一次请求：`LOG_BODY`

- `LOG_BODY=true` 时，拦截器额外输出一行 `${method} ${url} body: {...}`（默认 `log` 级别，
  因此默认 `LOG_LEVEL=log` 下就能看到，不必再调级别）
- **默认关闭**（`false`）—— 生产不宜默认落请求体，排查"写操作为何失败"时临时打开
- 输出前经 `logger/sanitize.ts` 处理：敏感字段（`password`/`token`/`authorization`/`cookie` 等）
  整值替换为 `***`，超长字符串/数组/对象/深度/整行都有上限，序列化为单行
- body 为空（`{}` / `null` / 空白串）时不产生该行；multipart 表单不被 `express.json` 解析，
  因此上传类请求也不会落 body
- 拦截器在管道（校验）**之前**执行，所以即使请求最终 400，body 行仍会记下来
- body 行**独立成行，不并入 access 行**：中间件层（含 `accessLogMiddleware`）排在 body parser
  **之前**，读不到 `req.body`；且独立行在"请求挂死 / 被客户端中断"时仍能看到请求体，
  而 access 行要等响应收尾才写

### 异常记录链路（三层分工，缺一层就留白）

**一句话**：access 行是"每个请求恒定一行"的唯一出口（在中间件层），失败**原因**由过滤器交给它，
**堆栈**由过滤器自己单独写一行。

1. `registerProcessErrorHandlers()`（`logger/process-error.ts`）—— `uncaughtException` 与
   `unhandledRejection` 都记 fatal 后 `exit(1)`；必须在 logger 接管之后注册，否则落到默认 logger
2. `accessLogMiddleware`（`logger/access-log.middleware.ts`）—— **访问行唯一出口**。
   在 `res` 收尾时写 `METHOD /path status 耗时ms [失败: 原因]`；级别按状态码分流
   （≥500 `error` / ≥400 `warn` / 其余 `log`）。
   因为挂在中间件层，**未命中路由的 404、body 解析失败的 400 也有 access 行且带耗时**（拦截器覆盖不到它们）。
   位置对齐 morgan / pino-http：**一个请求恰好一行**，`finish` + `close` 双监听 + 单次守卫保证不重复；
   中止时按 `res.writableFinished === false` 判为中断，追加 `(连接已中断)` 并提到 `warn`
3. `HttpExceptionFilter`（`common/filters/http-exception.filter.ts`）—— **只记 5xx**（`error`，带堆栈 /
   `cause` 链），4xx **不记**：社区共识是"4xx 是调用方问题，重复记只会淹没真 bug"，而 access 行已留痕。
   两类都会把失败摘要以**结构化**形式写进 `res.locals.accessLogFailure`（`{ summary, fields? }`），
   供 access 行拼出原因与出错字段；**文案拼装（「失败: 」「（字段错误：a, b）」、最多列 3 个字段）
   在日志层**，过滤器只给"哪几个字段错了"这份事实。
   整条日志拼成**单个字符串**再交给 Logger（ConsoleLogger 会把第二个字符串参数当 context 解析）

> 为什么不让拦截器也记一份失败：拦截器与过滤器会看到同一个异常（Nest 先跑拦截器的 error 分支，
> 再到异常层），两处都记等于每次失败记两遍 —— 这正是 2026-10-16 那次"一次失败打三条"的根因。
> 拦截器只保留 body 行（body 只在它那里读得到），耗时与状态由中间件统一负责。

4. traceId 由 `FileLogger` 从请求上下文自动附加，因此同一次请求的多行日志天然对得上号
   （包括无匹配路由的 404、body 解析失败的 400、客户端中断）

### `formatError`：必须展开 `cause` 链

- `logger/error-format.ts` 的 `formatError()` 会**逐层展开 `error.cause`**（最多 5 层，前缀
  `caused by:`，带循环引用保护），并摘出驱动的机器可读字段（`code` / `severity` / `detail` /
  `constraint` / `errno` / `syscall` …）拼成 `(code=57P01 severity=FATAL)`
- **只读最外层 message 会丢掉根因**：drizzle 的 `DrizzleQueryError` 只写 SQL 文本 + 空 `params:`，
  真实原因（连接被掐断 / 表不存在 / 超时）全在 `cause` 里。2026-10-16 那次 90 秒后 500
  就是因为旧实现只打印外层 message，日志里完全看不出到底为什么失败
- 首层错误保持简写（无堆栈时只取 `message`，业务异常是人写的短句）；cause 链上的库错误取
  `Name: message`，因为光看 message 分不清是谁抛的
- 由此 `UserService.handlePgError`（业务侧解包）与日志侧解包口径一致，两处不再各说各话

- **拦截器注册顺序不再承载日志正确性**：access 行已迁到中间件层（`accessLogMiddleware`），
  耗时从中间件入口算到响应结束，天然包含 body 解析 / 守卫 / 校验 / handler / `TransformInterceptor`。
  `RequestLoggingInterceptor` 仍需保留，但它只剩「body 行」一个职责
- 新增业务日志用 `new Logger('Context')`，不要在代码里 `console.log`

### 断点调试

- `pnpm start:debug`（`nest start --debug --watch`）监听 9229；`tsconfig` 开了 `sourceMap`，
  `dist/` 有 `.map`，断点可映射回 TS 源码
- `.vscode/launch.json` 提供 "Attach to Nest (9229)"（`restart: true` 让 watch 重启后自动重连）；
  `.vscode/tasks.json` 提供 `nest: start:debug` 背景任务
- 日志里的异常堆栈要显示 **TS 行号**而非 dist JS 行号，靠 `--enable-source-maps`：
  已写进 `start*` scripts（`NODE_OPTIONS=--enable-source-maps` / `node --enable-source-maps`）。
  **改了 script 需要重启 dev server 才生效**（见第 0 节，需先问用户）
- 按请求定位的条件断点：先带 `x-trace-id` 发请求（或从响应头抄下来），
  再在业务代码里对 `getTraceId()` / `req.traceId` 设条件即可

---

## 11. 代码风格

- 纯 ESM：**相对导入必须带 `.js` 后缀**（`import { envSchema } from './config/env.js'`）；
  路径别名 `@/*` → `src/*` 可用，但现有代码统一用相对路径，保持一致
- Prettier：单引号、`trailingComma: all`；缩进 2 空格
- oxlint：`@typescript-eslint/no-explicit-any` 关闭、`no-floating-promises` 为 warn（新增 async 调用要 await）
- **注释写中文**，重点写"为什么"（设计取舍、踩过的坑），不写"是什么"的行话重复
- 文件级注释块用 `/** ... */` 说明职责；复杂函数用 JSDoc 带 `@example`
- `strict: true`，避免 `any` 与类型断言；对外类型优先用 `z.infer` / `$inferSelect` 派生

---

## 12. 开发完成后必须做的验证

改完代码按顺序走，**不需要重启服务器**：

1. `pnpm lint` —— 静态检查
2. `pnpm build` —— 类型与编译（**注意**：tsc 默认即使报错也会 emit，编译"看起来能跑"不代表通过，必须看退出码）
3. `pnpm test` —— 涉及 `common/` 通用件或纯函数时补/跑单测
4. **在已运行的服务器上做端到端验证**（第 0 节）：
   - 先 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 确认服务在跑
   - 等 1~3 秒让 watch 重编译，再 curl 本次新增/改动的路由
   - 验证要覆盖：成功路径 + 参数校验失败(400 + `errors`) + 资源不存在(404) + 唯一冲突(409)
   - 例：`curl -s -X POST http://localhost:8000/users -H 'Content-Type: application/json' -d '{...}'`
   - 若 curl 被本机代理拦截，加 `--noproxy '*'`
   - **日志相关改动还要看 `logs/app.log`**：确认 traceId 与响应头 `x-trace-id` 一致、
     同一请求的多行 traceId 相同、无 `[traceId=] [traceId=]` 重复、无 ANSI 残留
     （`tail logs/app.log | cat -v | grep '\^\['` 应无输出）
   - traceId 应在**消息之前**（`[traceId=xxx] POST /users 400 ...`），且一行一事件 ——
     用 `awk` 核对每条 access 行都自成一行，不被库异常的多行 message 劈开
   - 错误日志要能直接看到根因：非预期的 5xx 行应带 `caused by:`（若根因被包装）或
     `(code=...)` 之类的驱动字段；只有 `Failed query: ...` 说明 cause 没被展开
   - **启动日志齐全**：`grep '服务已就绪\|可访问地址\|启动耗时' logs/app.log`；
     回环/局域网地址要与 `ifconfig | grep 'inet '`（macOS）对照一致，
     监听行应是 `[::]:port（所有网卡…）` 这类描述而**不是** URL
   - 涉及 `LOG_BODY` 时对比开关前后：`curl -X POST ... -d '{...}'` 后
     `grep 'body:' logs/app.log`（关闭时无输出，开启时有且敏感字段为 `***`）
   - 入站透传：`curl -H 'x-trace-id: abc-123' ...`，日志与响应头都应出现 `abc-123`
   - **入参宽容边界（第 6 节契约）**：query 侧宽容 —— `curl '.../users?page=&pageSize=&keyword='`
     应正常返回列表（空值视为未提供）；body 侧严格 ——
     `curl -X POST .../users -d '{"studentNo":"20250001","email":"a@b.com","nickname":"","password":"12345678"}'`
     应 400 且 `errors[].path` 指向 `nickname`（**不是**被吞成"未提供"）
   - **失败行数要对**：4xx 命中路由应**只有 1 行**（access `warn`，**不应**再有 `HttpExceptionFilter`
     的 4xx 行）；5xx 应**恰好 2 行**（过滤器堆栈行在前 → access `error` 行在后，两者 traceId 相同）；
     404 未命中路由、malformed JSON 的 400 也应有 access 行且**带耗时**
   - 客户端中断：`curl --max-time 0.5` 打一个慢接口，应出现 `(连接已中断)` 行且**带 traceId**
     （这是收尾回调里 `runWithTraceId` 恢复上下文的验收点）
5. **清理测试数据** —— 验证产生的记录要删掉（软删也算留痕，必要时物理清理），不要把脏数据留在库里

---

## 13. 已知坑与遗留问题

- **启动开发服务器会触发 safe-delete 保护**（`deleteOutDir: true` 删 `dist/`，>50 文件需确认）→ 见第 0 节
- **drizzle 包装 pg 错误**：`23505` 判断必须先读 `err.cause`，否则 409 变 500
- **`timestamps()` 是函数**：写成共享对象常量会导致多表列名错乱
- **`updatedAt` 不自动更新**：所有 update 手动 set
- **路由顺序**：静态段（`by-student-no/:studentNo`）必须在 `:id` 之前声明
- **路径参数**：不是 shape，管道层的 query 归一化与 shape 包装都覆盖不到 —— 文本类套 `trimmed()`，
  数字类用 `z.string().regex(/^\d+$/).transform(Number).pipe(z.number()...)`，不要用 `z.coerce.number()`
  （`Number('') === 0` 会把空值误报成 `too_small`）→ 见第 6 节
- **空值宽容只发生在 query**：body 里的 `""` / 纯空白 / `null` 一律**如实校验**
  （`min(1)` 或类型错误），这是前端契约的一部分。若发现某个 body 参数"传空串被静默忽略"，
  说明有人又加回了空值包装（`preprocess`/`transform` 把空值转 `undefined`）→ 见第 6 节
- **`trimmed` 不再产出 `undefined`**：trim 后为空就是空串，由字段自身约束判定。
  历史写法「trim 后为空即视为未提供」已废弃，schema 层现在严格且与参数来源无关
- **`ZodValidationPipe` 的宽容靠 `metadata.type === 'query'`**：直调 `pipe.transform(value)`
  （不传 metadata）走**严格**分支，写单测时别忘了显式传 `{ type: 'query' }`
- **日志不落盘先查 `LOG_FILE`**：`filePath` 为空时 `FileLogger` 根本不建文件通道，
  日志只走控制台（历史 bug 的根因就是 `.env` 里没配 `LOG_FILE`）
- **`bufferLogs: true` 在本项目无效**：`NestApplication.init()` 末尾会先
  `flushLogsIfAutoFlushEnabled()`（`autoFlushLogs` 默认 true），缓冲会在 `app.useLogger()`
  之前就被默认 logger 打印并清空；若关掉 `autoFlushLogs`，初始化失败的日志又会被永久缓冲掉。
  正确做法是把 logger 注入 `NestFactory.create`（见第 10 节）
- **`z.coerce.boolean()` 会把 `'false'` 判成 `true`**：它等价 `Boolean('false')`，
  布尔环境变量必须走 `envBoolean()` 助手（见第 4 节）
- **zod v4 的 transform 里 `throw` 不会被 `safeParse` 接住**（直接冒泡，绕过统一错误聚合）——
  要让校验失败请让值落到 `z.enum` 之类的 issue，而不是抛异常
- **body parser 早于 `NestModule.configure()` 注册的中间件**：Nest 的 `init()` 先
  `registerParserMiddleware()` 再 `registerRouter()`。要让中间件覆盖 malformed JSON / 无路由 404，
  必须在 `main.ts` 用 `app.use()` 早注册（见第 10 节）
- **`source-map-support` 已不再使用**：改用 Node 原生 `--enable-source-maps`（写在 scripts 里），
  它只在 devDependencies，生产装不到 —— 不要再在代码里 import 它
- **异常日志用单个字符串**：给 `Logger.error/warn` 传第二个字符串参数会被当成 context，
  异常内容会错位 —— 先拼成一条完整消息再传
- **排查 500 先看 `caused by:`**：只有外层 `Failed query: ...` 说明根因被包装了。
  drizzle / undici 这类库都把真实原因放在 `err.cause`，`formatError()` 已自动展开；
  若日志里仍缺根因，多半是新引入的库用了别的包装字段（如 `AggregateError.errors`）
- **多行 message 会劈开日志行**：库异常的 `message` 可能自带换行，写单行日志（access 行）
  必须过 `toSingleLine()`
- **pg `Pool` 没有 `error` 监听器会杀掉进程**：见第 8 节
- **access 日志在中间件层，删掉就静默消失**：`main.ts` 里的 `app.use(accessLogMiddleware)` 若被删，
  所有 access 行会**无声**消失（不像以前拦截器还在、至少还留一行）。改 `main.ts` 那几行时要留意
- **`finish` / `close` 回调不一定在请求的 ALS 上下文里**：正常收尾在，**客户端中断时 `close` 由
  socket 触发、上下文已丢**（实测 `getTraceId()` 为 `undefined`）→ 必须在中间件入口捕获 traceId，
  写日志时 `runWithTraceId(traceId, …)` 显式恢复（见第 10 节）
- **access 行的耗时口径**：从**中间件入口**算到响应收尾，包含 body 解析 / 守卫 / 校验 / 序列化，
  因此比旧实现（从拦截器算起）的数字略大。与历史日志对比时会看到这个台阶，属预期
- **`src/modules/user/user.e2e-spec.ts` 尚未编写**：计划用独立测试库 `learn_nest_test` + 自动迁移 +
  `TRUNCATE` 隔离，断言按第 5 节的响应契约写
- 旧的 `test/app.e2e-spec.ts` 与 `test/` 目录已删除（`GET /` 期望 Hello World 的断言已过时），
  `AppController` 也已移除 —— 新增 e2e 不要沿用旧模板

---

## 14. 新增业务模块的清单

以 `src/modules/<domain>/` 为范式（参照 `user` 模块）：

1. `db/schema/<domain>.schema.ts` —— 建表（`...timestamps()`）+ 索引；在 `db/schema/index.ts` 导出
2. `dto/*.ts` —— zod schema（`create` / `update` / `query` 列表用 `paginationSchema.extend`，**默认排序 `updatedAt` 降序**，见第 7 节）+ 导出 `z.infer` 类型
3. `<domain>.mapper.ts` —— 定义 `XxxResponse` 并实现 `toXxxResponse()`（剔除敏感字段）
4. `<domain>.service.ts` —— 业务逻辑；查询带 `isNull(deletedAt)`；唯一冲突转 409（记得解包 `cause`）
5. `<domain>.controller.ts` —— REST 路由 + `ZodValidationPipe` 按参数注册 + `@ApiMessage`；静态段路由排在 `:id` 前
6. `<domain>.module.ts` —— 声明 controller/service（`DrizzleModule` 是 `@Global`，无需 import）
7. 在 `app.module.ts` 的 `imports` 注册模块
8. 按第 12 节验证；需要的话补 `*.spec.ts` / `*.e2e-spec.ts`

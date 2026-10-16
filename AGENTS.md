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
├── main.ts                       # 入口：FileLogger 接管 + app.listen(PORT)
├── app.module.ts                 # 根模块：ConfigModule / DrizzleModule / 业务模块 / 全局拦截器+过滤器
├── config/env.ts                 # ★ 全部环境变量的 zod schema（唯一出处）
├── common/                       # 跨模块通用件
│   ├── crypto/password.scrypt.ts #   scrypt 哈希/校验
│   ├── decorators/               #   @ApiMessage / @SkipTransform
│   ├── filters/http-exception.filter.ts   # 全局异常 → 失败契约
│   ├── interceptors/transform.interceptor.ts # 全局成功契约包装
│   ├── pagination/               #   paginationSchema + paginate() + PageResponse
│   ├── pipes/zod-validation.pipe.ts       # 按参数注册的 zod 校验管道
│   └── response/api-response.ts  #   ★ 响应契约类型（ApiResponse / FieldError）
├── db/
│   ├── drizzle/                  #   DrizzleModule(@Global) + DrizzleService
│   └── schema/                   #   columns.ts（timestamps()）/ index.ts / *.schema.ts
├── logger/                       # FileLogger + getLogLevels + 请求日志拦截器
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
- 数字/布尔类变量用 `z.coerce`（如 `PORT: z.coerce.number().int().positive().default(8000)`）
- **新增变量必须同步更新 schema**；`DB_POOL_MAX` 这类仅在少数位置读取的变量也应补进 schema
- 业务代码取配置一律用 `ConfigService<Env, true>` + `get('KEY', { infer: true })`（或 `getOrThrow`），
  **禁止**业务代码直接读 `process.env`
- `.env` 由用户自行维护（`.env.example` 已删除，不再维护）；本地覆盖写 `.env.local`（已 gitignore）；
  敏感值由部署平台注入，不入库

当前变量：`NODE_ENV`、`PORT`(默认 8000)、`LOG_LEVEL`、`LOG_FILE`、`DATABASE_URL`(必填)。

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

## 6. 请求校验与入参归一化

zod 管道是"有参管道"，**按参数显式注册**（不存在全局 ValidationPipe）：

```ts
create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {}

findOne(@Param('id', new ZodValidationPipe(idParamSchema)) id: IdParam) {}
```

**入参归一化（管道层统一，DTO 无需关心）**：校验前，query/body 中的

- `''`（空串）与显式 `null` → 一律视为「**未提供**」（→ `undefined`）
- 纯空白字符串（`' '`、`'\t'`）**不算空**，仍按原值校验（trim 属业务语义，不在管道代劳）
- 仅递归处理**普通对象**；**数组元素不动**（数组内空串多为有意占位）

效果：optional 字段自然通过、default 字段回落默认值、required 字段报
「expected string, received undefined」（比 `min(1)` 语义更准确）。
**因此不要为任何 DTO 额外加"空值包装"**，领域 schema 保持严格。

其他规则：

- HTTP query 天然是字符串，数字字段一律 `z.coerce.number()`
- 路径参数 schema 复用（如 `idParamSchema` 供全部 `:id` 路由使用）
- **路径参数是顶层字符串，管道层的"空串归一化"覆盖不到它**（管道只递归普通对象），
  两个方向都要显式处理，参考现有两个 schema（都在 `reset-password.dto.ts`）：
  - 文本类 `:studentNo` → `trimmed(studentNoSchema)`
  - 数字类 `:id` → `trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`：
    套 `trimmed` 让空白值落到「未提供」语义，**不能**只用 `z.coerce.number()`——`Number('') === 0`
    会把"没传"误报成 `Too small: expected number to be >0`，且 `Number()` 会把 `'0x10'` 解析成 16、
    `'1e0'` 解析成 1；`.pipe()` 保留数字域校验（`'0'` → `>0`，超安全整数 → `Too big`）
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
  判断 `23505`（唯一冲突）必须先解包再读 `code` / `constraint`（否则 409 会退化成 500）
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

## 10. 日志与拦截器顺序

- `main.ts` 用 `FileLogger`（继承 `ConsoleLogger`）接管日志：控制台 + 可选文件双写，
  文件内容 strip 掉 ANSI 色码；`LOG_FILE` 不设则只输出控制台
- `LOG_LEVEL` 是"最小级别"，由 `getLogLevels()` 展开为 Nest 需要的数组（fatal 永远包含）
- `RequestLoggingInterceptor` 输出 `METHOD /path status 耗时ms [traceId=...]`，
  并把 `x-trace-id` 回写响应头；成功 `log` 级别，失败 `warn` 级别
- **注册顺序不可调换**：`RequestLoggingInterceptor` 必须在 `TransformInterceptor` **之前**注册
  （保持最外层，才能统计 handler + 转换的完整耗时）
- 新增业务日志用 `new Logger('Context')`，不要在代码里 `console.log`

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
5. **清理测试数据** —— 验证产生的记录要删掉（软删也算留痕，必要时物理清理），不要把脏数据留在库里

---

## 13. 已知坑与遗留问题

- **启动开发服务器会触发 safe-delete 保护**（`deleteOutDir: true` 删 `dist/`，>50 文件需确认）→ 见第 0 节
- **drizzle 包装 pg 错误**：`23505` 判断必须先读 `err.cause`，否则 409 变 500
- **`timestamps()` 是函数**：写成共享对象常量会导致多表列名错乱
- **`updatedAt` 不自动更新**：所有 update 手动 set
- **路由顺序**：静态段（`by-student-no/:studentNo`）必须在 `:id` 之前声明
- **路径参数**：不是 shape，管道层"空串归一化"覆盖不到 —— 文本类套 `trimmed()`，数字类用
  `z.string().regex(/^\d+$/).transform(Number).pipe(z.number()...)`，不要用 `z.coerce.number()`
  （`Number('') === 0` 会把空白值误报成 `too_small`）→ 见第 6 节
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

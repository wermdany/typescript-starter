# 目录结构、模块分包与新增模块清单

> 本文件是 AGENTS.md 第 §2、§14 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 改目录、拆子域、加新模块时读这一份。

---

## 2. 目录结构

```
src/
├── main.ts                       # 入口：loadEnv + FileLogger + createApp + listen + 启动日志
├── server.ts                     # createApp()：创建应用 + registerRequestStages()（P1 中间件），不监听端口
├── app.module.ts                 # 根模块：ConfigProviderModule / HttpStagesModule / RbacModule / DatabaseModule / 业务模块
├── __tests__/                    # 应用级测试（真实启一个应用，mock 掉数据库）
├── common/                       # 横切关注点：**按功能划分**，唯一注册处是 http-stages.ts
│   ├── http-stages.ts            #   HTTP 阶段装配：5 个阶段 + 顺序 + 分层不变式（对账先看这里）
│   ├── http-stages.module.ts     #   唯一 DI 收口 Module：providers = 阶段注册 + 阶段依赖
│   ├── auth/                     #   功能：身份与访问
│   │   ├── auth.contract.ts          身份/角色类型 + 401 403 429 文案（纯契约）
│   │   ├── permission.contract.ts    PermissionChecker 端口 + PERMISSION_CHECKER token
│   │   ├── ownership.contract.ts     Actor 联合类型 + 归属纯谓词
│   │   ├── request-augment.ts        Express.Request.user 的类型增补
│   │   ├── access.ts                 访问意图（判别联合）+ resolveAccess() 纯判定
│   │   ├── access.decorator.ts       @Public / @Authenticated / @RequirePermission / @OwnerOrPermission / @CurrentUser
│   │   └── access.guard.ts           AccessGuard：唯一守卫（登录态 + 权限码 + 归属三层合一）
│   ├── api-response/             #   功能：响应契约
│   │   ├── api-response.ts           契约类型 + 默认文案（纯类型）
│   │   ├── transform.interceptor.ts  返回值 → 成功契约
│   │   ├── exception.filter.ts       失败唯一出口
│   │   ├── error-mapping.ts          异常 → HttpException 映射链
│   │   ├── pg-error.ts               unwrapPgError()：解 drizzle 的 cause 链
│   │   └── response.decorator.ts     @ApiMessage / @SkipTransform
│   ├── validation/               #   功能：参数校验
│   │   ├── zod-validation.pipe.ts    zod 管道（query 空值宽容的唯一通道）
│   │   └── param.decorator.ts        @ZodBody / @ZodQuery / @ZodParam / @ZodParams
│   ├── context/                  #   功能：请求上下文（**不得 import @nestjs/common 运行时**）
│   │   ├── trace.ts                  traceId 的 AsyncLocalStorage
│   │   └── trace.middleware.ts       P1：解析/生成 traceId + 回写响应头
│   ├── logging/                  #   功能：日志
│   │   ├── access-log.middleware.ts  P1：访问行唯一出口
│   │   ├── request-logging.interceptor.ts  LOG_BODY 的 body 行
│   │   ├── failure.ts                失败摘要类型 + res.locals 键名
│   │   ├── error-format.ts           formatError()（展开 cause 链）
│   │   └── sanitize.ts               body 脱敏与截断
│   └── idempotency/              #   功能：HTTP 幂等
│       ├── idempotency.contract.ts   端口 + 键/指纹/结果类型
│       ├── memory-store.ts           单进程内存实现（换 Postgres 只改 http-stages.ts 一行）
│       ├── idempotency.interceptor.ts
│       └── idempotency.decorator.ts  @Idempotent()
├── config/
│   ├── env.ts                    # 环境变量 schema（唯一声明处）+ loadEnv()（带单例缓存）
│   ├── app-config.ts             # 业务配置（登录会话/策略 + HTTP 幂等窗口）→ APP_CONFIG provider
│   ├── config.module.ts          # 配置统一注入口：ENV / APP_CONFIG 两个 @Global provider
│   └── __tests__/
├── shared/                       # 纯工具：从 barrel 引入，不要记具体文件名
│   ├── common.ts                 #   响应契约类型 / paginate / 密码哈希
│   ├── validation.ts             #   trimmed / trimmedShape / passwordSchema / paginationSchema
│   ├── pagination/               #   paginate() + paginationSchema
│   ├── validation/               #   trimmed/trimmedShape、passwordSchema（含 __tests__/）
│   ├── crypto/password.scrypt.ts #   scrypt 哈希/校验
│   └── auth/                     #   认证纯工具：token / client-info / ownership 断言
├── database/                     # @Global 数据库模块
│   ├── database.module.ts        # DatabaseModule
│   ├── database.service.ts       # DatabaseService（连接池 + drizzle 实例 + 事务助手）
│   └── schema/                   # columns.ts（timestamps()）/ index.ts / *.schema.ts
├── logger/                       # 只管"日志怎么落盘"：FileLogger、级别、进程级兜底
│   ├── file-logger.ts            #   ConsoleLogger 子类：控制台 + 文件双写，自动补 [traceId=...]
│   ├── log-levels.ts             #   最小级别 → logLevels 数组
│   ├── process-error.ts          #   uncaughtException / unhandledRejection 兜底
│   └── __tests__/
├── startup/local-addresses.ts    # 启动时枚举可访问地址
└── modules/<domain>/             # 业务模块（当前有 user、auth、rbac）
                                  #   rbac 是基础设施：只提供权限码解析（不再是守卫注册处）
    ├── <domain>.module.ts
    ├── <domain>.controller.ts
    ├── <domain>.service.ts       # 或按用例拆成多个 XxxService
    ├── dto/                      # zod schema + z.infer 类型 + 对外字段白名单
    ├── <subdomain>/              # 大模块按"变更原因"拆子域（见 auth 的用法）
    │   ├── <name>.service.ts     #   仓储 / 用例编排（统一叫 service）
    │   ├── <name>.controller.ts  #   子域自己的接口
    │   ├── dto/                  #   子域的 DTO 与投影
    │   └── <subdomain>.module.ts #   子域只 import 依赖方的 Module，不散引文件
    └── __tests__/                # 测试跟着被测代码所在子域走
```

**`common/` 的分包规则是"按功能"，不是按阶段**：`auth/` 是身份与访问、`api-response/`
是响应契约、`validation/` 是参数校验、`context/` 是请求上下文、`logging/` 是日志、
`idempotency/` 是 HTTP 幂等。一次请求会穿过多个功能目录，穿过的方式由
`common/http-stages.ts` 一张表回答 —— 所以**不要**把目录改成 `guards/` `interceptors/`
`filters/` 这种按技术分层的形式：那会让"加一个功能"变成改 3 个目录。

**模块内分包规则**（以 `modules/auth` 为准）：

- 源文件 ≥ 15 个的模块必须按子域分包，平铺会让"谁依赖谁"不可读
- 子域按**变更原因**划分（auth：`token/` 签发时效、`session/` 会话与中间件、
  `login/` 登录策略、`log/` 登录审计），不按技术分层划
- **子域间只 import 对方的 Module 并写进 `imports`，禁止跨子域散引 service 文件** ——
  循环依赖（session ↔ login）会在 ESM 下以 TDZ 崩溃，聚合层（`AuthDependenciesModule`）
  负责把子模块组装到一起
- **Controller 按子域拆分**（`session.controller.ts` / `login-log.controller.ts` 各归其子域，
  只有跨子域的入口路由留在模块根部）—— 找接口先找子域目录，不要都堆在一个大 controller 里
  让人翻半天
- 依赖倒置优先于引包：子域需要"查用户/查审计"这类跨子域数据时，优先自备最小查询
  （如 `SessionService.userExists`），而不是反向 import 别的子域
- **角色判定只走三个原语**（`@/common/auth/auth.contract.js`，barrel 亦有导出）：
  `hasRole(user, 'teacher')` / `hasAnyRole(user, ['teacher', 'admin'])` / `isAdmin(user)`。
  禁止手写 `roles.includes('admin')` / `roles[0] === 'admin'` —— 多角色下这些写法必然出偏差，
  演进时只改契约一处。
  （`users.role` 单值列已在 `0006` 迁移删除，角色只经 `user_roles` 暴露为 `roles[]`，
  所以任何 `role === '...'` 形态的写法都已经是死代码）
- **字段级修改权限用白名单**（范例 `modules/user/update-policy.ts`，就近放 user 目录）：角色 → 可改字段集
  的映射表 + `filterUpdatable()` 纯函数过滤，**不在 service 里堆 if/else 逐字段判断**。
  规则：新字段默认不可改（显式加入白名单才开放，与投影白名单同一取向）；
  判定与业务流程（校验 → 更新 → 吊销）分离，判定本身可单测、可导出给前端

**文件命名（对齐 NestJS 官方 schematics 约定）**：后缀**只用五种**——
`*.module.ts` / `*.controller.ts` / `*.service.ts` / `*.dto.ts` / `*.middleware.ts`，
kebab-case。禁止自造后缀（`*.use-case.ts` / `*.projection.ts` / `*.handler.ts` /
`*.policy.ts` 等一律不用）：

- 用例编排 → `xxx.service.ts`（service 就是业务逻辑层，不区分"仓储/用例"后缀；
  一个域里仓储和用例都叫 service，靠类名与注释区分职责）
- 对外字段白名单 → 收进该域的 `dto/xxx.dto.ts`（投影就是 DTO 契约的一部分）
- 装配类小封装 → 并入它装配的目标文件（如中间件工厂 + 容器装配同文件）
- 纯工具函数 → 就近放使用它的子域目录（不带类型后缀，如 `refresh-cookie.ts` / `update-policy.ts`）

文件名读法 = 目录（域）+ 文件名（职责）：`session/session.service.ts`、
`login/refresh.service.ts` —— 找代码先找域目录，再看 service/dto/controller。

**全局组件统一注册**（对账表见 `src/common/http-stages.ts` 头注释）：
守卫 / 拦截器 / 过滤器**不**再由各功能域的自注册模块各自 `APP_*`
—— 那会让"一次请求经过哪些横切逻辑"分散到 5 个机制、6 个注册点里。
现在只有一处：

- 清单与顺序：`common/http-stages.ts` 的 `HTTP_STAGE_PROVIDERS`（数组字面量顺序 = 执行顺序）
- DI 收口：`common/http-stages.module.ts`（`providers: [...HTTP_STAGE_PROVIDERS, ...HTTP_STAGE_DEPENDENCIES]`）
- 引用：`app.module.ts` 只 import `HttpStagesModule`，**不直接声明任何 provider**

于是"找横切能力看哪里"的答案是唯一的：`common/http-stages.ts`。
加/改一个系统级横切能力的动作固定为两步 —— 在 `src/common/<功能>/` 写组件、
在 `HTTP_STAGE_PROVIDERS` 里加一行。

**唯一例外**：请求中间件（trace / access / cookie / 认证）的注册时序特殊，
必须由 `server.ts` 调 `common/http-stages.ts` 的 `registerRequestStages()`
即时挂载（见第 13 节与 `07-pitfalls.md`）。它们在同一份 `http-stages.ts` 里有文档与
入口函数，因此"一个文件看完 5 个阶段"依然成立。

**分层**：Controller 只做路由与参数校验；Service 承载全部业务逻辑（SQL、哈希、异常转换）；
对外字段由 `dto/` 里的列白名单界定；DTO 用 zod schema 定义并导出 `z.infer` 类型。

**依赖方向**（只允许自下而上）：

- `config`、`common`、`shared`：不依赖任何业务代码
- **`common/**` 的分层不变式**（写死在 `common/http-stages.ts` 头注释，改代码前先读）：
  - 允许依赖 `@nestjs/*`、express、zod、rxjs 与 Node 内置模块
  - **禁止** import `@/modules/*`、`@/logger/*`、`@/shared/*`、`@/database/*`
  - `common/context/*` 更严：**不 import `@nestjs/common` 的运行时** ——
    `logger/file-logger.ts` 要单向引用它，而 FileLogger 必须先于 DI 容器构造出来
- `logger`：只依赖 `common/context`（traceId）与 `common/logging/error-format`；
  `common` 不反向依赖 `logger`（方向单一，否则启动阶段就成环）
- 业务模块可以依赖 `database` 的 schema 与 `DatabaseService`（@Global）
- 业务模块之间不互相 import，需要共享时下沉到 `shared`（纯工具）或
  `common`（横切能力 / 纯契约）

**测试位置**：测试文件一律放在被测代码所在目录（或其所属模块）的 `__tests__/` 下，
`src/` 其它位置不出现 `*.spec.ts`；`tsconfig.build.json` 已排除 `__tests__`，构建产物不含测试。
每个测试文件只测自己模块的代码，不为别的模块造数据（管道测试用本地 schema，不 import 业务 DTO）。
应用级（HTTP 全链路）测试放 `src/__tests__/`：`createApp()` 起真实应用，`vi.mock` 掉 `DatabaseService`，用 supertest 断言。

---

---

## 14. 新增业务模块的清单

以 `src/modules/user/` 为范式：

1. `database/schema/<domain>.schema.ts` —— 建表（`...timestamps()`）+ 索引；在 `database/schema/index.ts` 导出
2. `dto/*.ts` —— zod schema（`create` / `update` / 列表 query 用 `paginationSchema.extend(trimmedShape({...}))`，
   默认排序 `updatedAt` 降序）+ 导出 `z.infer` 类型
3. `dto/<domain>.dto.ts` —— 对外字段白名单 `xxxPublicColumns`（`as const`，与 zod schema 同文件或同目录）+
   `type XxxResponse = Pick<Xxx, keyof typeof xxxPublicColumns>`；Service 的 `select` / `returning` 一律传它
   （不要 `Omit`、不要映射函数）；补投影字段冻结的测试
4. `<domain>.service.ts` —— 业务逻辑；查询带 `isNull(deletedAt)`；`updatedAt` 手动更新；
   **不要**为"库错误转状态码"写 catch（唯一约束冲突由
   `common/api-response/error-mapping.ts` 的映射链转 409）；分页/哈希从 `@/shared/common.js` 取
5. `<domain>.controller.ts` —— REST 路由 + `@ZodBody` / `@ZodQuery` / `@ZodParam` / `@ZodParams`
   （`@/common/validation/param.decorator.js`，内部组合 `ZodValidationPipe`）+ `@ApiMessage`
   （`@/common/api-response/response.decorator.js`）；路径参数放 URL 末尾（`password/:id`），
   静态段路由排在 `:id` 前；非幂等写接口按需加 `@Idempotent()`
6. `<domain>.module.ts` —— 声明 controller/service（`DatabaseModule` 是 `@Global`，无需 import）
7. 在 `app.module.ts` 的 `imports` 注册模块
8. 按第 12 节验证；测试写到 `<domain>/__tests__/*.spec.ts`，只测本模块代码
9. 建表写法见第 15 节，逐项对齐 `users.schema.ts`

---

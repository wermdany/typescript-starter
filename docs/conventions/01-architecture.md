# 目录结构、模块分包与新增模块清单

> 本文件是 AGENTS.md 第 §2、§14 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 改目录、拆子域、加新模块时读这一份。

---

## 2. 目录结构

```
src/
├── main.ts                       # 入口：loadEnv + FileLogger + createApp + listen + 启动日志
├── server.ts                     # createApp()：创建应用、注册中间件，不监听端口（测试复用）
├── app.module.ts                 # 根模块：ConfigProviderModule / AppCoreModule / DatabaseModule / 业务模块
├── app.core.module.ts            # 全局组件的"目录清单"：import 各功能域的自注册模块
├── __tests__/                    # 应用级测试（真实启一个应用，mock 掉数据库）
├── config/
│   ├── env.ts                    # 环境变量 schema（唯一声明处）+ loadEnv()（带单例缓存）
│   │                             #   + Env 强类型 / AuthConfig 派生视图（toAuthConfig）
│   ├── config.module.ts          #   配置统一注入口：ENV / AUTH_CONFIG 两个 @Global provider
│   └── __tests__/
├── common/
│   ├── api-response/api-response.ts  # 响应契约类型 + 默认文案常量（只放类型）
│   └── auth/                     # 认证契约（纯类型/纯函数，不依赖 Nest 与业务模块）
│       ├── auth.contract.ts      #   AuthenticatedUser / 认证请求类型 / 401 403 429 文案
│       └── request-augment.d.ts  #   Express.Request.user 的类型增补
├── shared/                       # 常用工具：从 barrel 引入，不要记具体文件名
│   ├── common.ts                 #   @ApiMessage / @SkipTransform / 响应类型 / paginate / 哈希
│   ├── validation.ts             #   trimmed / trimmedShape / passwordSchema / paginationSchema
│   ├── decorators/               #   装饰器实现
│   ├── pagination/               #   paginate() + paginationSchema
│   ├── validation/               #   trimmed/trimmedShape、passwordSchema（含 __tests__/）
│   ├── crypto/password.scrypt.ts #   scrypt 哈希/校验
│   ├── auth/                     #   认证基础件 + 全局守卫的自注册模块
│   │   ├── auth.module.ts        #     APP_GUARD（HttpAuthGuard）注册；找守卫注册来这里
│   │   ├── auth.guard.ts         #     AuthGuard（纯逻辑）+ HttpAuthGuard
│   │   ├── token.ts              #     generateToken / hashToken / 空哈希（假校验对齐耗时）
│   │   ├── client-info.ts        #     UA → 设备摘要、XFF → 客户端 IP
│   │   └── decorators/           #     @Public / @Authenticated / @CurrentUser / @RequirePermission / @OwnerOrPermission
│   └── http/                     #   HTTP 契约 + 自注册模块
│       ├── http.module.ts        #     APP_FILTER（异常）+ APP_INTERCEPTOR（成功包装）；找契约注册来这里
│       ├── http-exception.filter.ts
│       ├── transform.interceptor.ts
│       └── zod-validation.pipe.ts #    按参数显式注册的管道，不走全局机制
├── database/                     # @Global 数据库模块
│   ├── database.module.ts        # DatabaseModule
│   ├── database.service.ts       # DatabaseService（连接池 + drizzle 实例 + 事务助手）
│   └── schema/                   # columns.ts（timestamps()）/ index.ts / *.schema.ts
├── logger/                       # FileLogger、trace、access-log、body 日志、错误格式化、进程级兜底
│   ├── logger.module.ts          #   APP_INTERCEPTOR（body 日志）；找日志拦截器注册来这里
│   ├── failure-summary.ts        #   失败摘要的类型与 res.locals 键名（过滤器与访问日志共用）
│   └── __tests__/
├── startup/local-addresses.ts    # 启动时枚举可访问地址
└── modules/<domain>/             # 业务模块（当前有 user、auth、rbac）
                                  #   rbac 是基础设施：权限码解析与缓存、HttpPermissionGuard 注册，不是业务域
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

**全局组件自注册**（对账表见 `app.core.module.ts` 头注释）：每个功能域的
`*.module.ts` 自带 `APP_GUARD` / `APP_FILTER` / `APP_INTERCEPTOR` 注册——
"谁提供了什么全局能力"看组件自己的目录，不用去装配模块里对账；
`app.core.module.ts` 只 import 这些模块，**不直接声明任何 provider**。
唯一例外：请求中间件（trace/access/cookie/认证）因注册时序必须留在
`server.ts` 的 `createApp()`（见第 13 节）。

**分层**：Controller 只做路由与参数校验；Service 承载全部业务逻辑（SQL、哈希、异常转换）；
对外字段由 `dto/` 里的列白名单界定；DTO 用 zod schema 定义并导出 `z.infer` 类型。

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
   唯一冲突转 409（先解包 `cause`）；分页/哈希从 `@/shared/common.js` 取
5. `<domain>.controller.ts` —— REST 路由 + `ZodValidationPipe`（`@/shared/http/zod-validation.pipe.js`）
   按参数注册 + `@ApiMessage`（`@/shared/common.js`）；路径参数放 URL 末尾（`password/:id`），
   静态段路由排在 `:id` 前
6. `<domain>.module.ts` —— 声明 controller/service（`DatabaseModule` 是 `@Global`，无需 import）
7. 在 `app.module.ts` 的 `imports` 注册模块
8. 按第 12 节验证；测试写到 `<domain>/__tests__/*.spec.ts`，只测本模块代码
9. 建表写法见第 15 节，逐项对齐 `users.schema.ts`

---

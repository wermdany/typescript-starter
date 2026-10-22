# typescript-starter

NestJS + PostgreSQL 的用户管理后端。纯 ESM、Drizzle ORM、zod 校验、统一响应契约、
全链路 traceId 日志。

## 技术栈

| 项 | 选型 |
| --- | --- |
| 框架 | NestJS（`@nestjs/platform-express`） |
| 语言/模块 | TypeScript，纯 ESM（导入带 `.js` 后缀；跨目录用 `@/*` 别名） |
| 包管理 | pnpm |
| 数据库 | PostgreSQL 17（docker compose）+ drizzle-orm + `pg` |
| 校验 | zod v4（不使用 class-validator） |
| 测试 | Vitest（`*.spec.ts`） |
| Lint/格式化 | oxlint + Prettier |

## 快速开始

```bash
pnpm install

docker compose up -d db   # 本地 Postgres：localhost:5432/learn_nest

cp .env.example .env      # 按需修改（至少确认 DATABASE_URL）
pnpm db:migrate           # 建表，并灌入 drizzle/0001 的种子用户
pnpm start:dev            # 监听 http://localhost:8000
```

> `drizzle/0001_seed_users.sql` 是自定义迁移，会灌入 100,000 条拟真用户数据，
> 用户数据由种子迁移生成（拟真数据）；**登录账号与密码不在代码/迁移里预置**，
> 由部署方直接在数据库中为真实用户分配角色并写入 scrypt 密码哈希
> （可用 `hashPassword()` 生成，存储格式 `scrypt$N$r$p$saltHex$hashHex`）。

## 环境变量

全部变量在 `src/config/env.ts` 的 zod schema 里声明，启动时校验，缺失或非法直接启动失败。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 否 | `development` | `development` / `test` / `production` |
| `PORT` | 否 | `8000` | 监听端口 |
| `LOG_LEVEL` | 否 | `log` | 最小日志级别：`debug`/`verbose`/`log`/`warn`/`error`/`fatal` |
| `LOG_FILE` | 否 | `logs/app.log` | 日志文件路径；置空则只输出控制台 |
| `LOG_BODY` | 否 | `false` | 是否把请求体写进日志（脱敏 + 截断） |
| `DATABASE_URL` | **是** | — | PostgreSQL 连接串 |

`DB_POOL_MAX` 可选，默认 10，由 `DatabaseService` 直接读取。

## 命令

```bash
pnpm start:dev        # 开发模式（watch）
pnpm start:debug      # 调试模式（watch + 9229 端口）
pnpm start:prod       # 运行 dist/main

pnpm build            # 编译
pnpm lint             # oxlint src/
pnpm format           # prettier
pnpm test             # 单元测试
pnpm test:watch       # 单元测试 watch
pnpm test:cov         # 覆盖率

pnpm db:push          # 把 schema 推到数据库
pnpm db:generate      # 生成迁移 SQL 到 drizzle/
pnpm db:migrate       # 执行迁移
pnpm db:studio        # 可视化查看数据
```

## 接口

所有接口都返回统一契约，用 `success` 判别成功/失败（详见 `@/shared/common.js`）：

```jsonc
// 成功
{ "success": true, "message": "创建成功", "data": { "id": 1, "nickname": "小明" } }
// 失败
{ "success": false, "message": "参数校验失败", "data": null,
  "errors": [{ "path": "email", "message": "无效的电子邮件地址" }] }
```

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | 公开 | 登录，签发双 token |
| `POST` | `/auth/refresh` | 凭 refreshToken | 静默续期（一次性轮换） |
| `POST` | `/auth/logout` | 登录 | 退出当前设备（幂等） |
| `POST` | `/auth/sessions/revoke-all` | 登录 | 退出全部设备（`keepCurrent` 可保留本机） |
| `GET` | `/auth/sessions` | 登录 | 我的登录设备（标 `current`） |
| `DELETE` | `/auth/sessions/:id` | 登录 | 踢掉我的某台设备 |
| `GET` | `/auth/login-logs` | 登录 | 我的登录记录 |
| `GET` | `/auth/me` | 登录 | 当前身份 |
| `GET` | `/users/health` | 公开 | 健康检查 |
| `GET` | `/users/me` | 登录 | 当前用户资料 |
| `POST` | `/users` | 管理员 | 创建用户 |
| `GET` | `/users` | 管理员 | 分页列表（`page` / `pageSize` / `keyword` / `role` / `sortBy` / `order`） |
| `GET` | `/users/by-student-no/:studentNo` | 管理员 | 按学号查询 |
| `GET` | `/users/:id` | 登录 | 按 ID 查询 |
| `PATCH` | `/users/:id` | 本人或管理员 | 更新资料（本人只能改昵称 / 邮箱） |
| `PATCH` | `/users/password` | 登录 | 修改本人密码（需 `oldPassword`），踢掉其它设备 |
| `PATCH` | `/users/password/:id` | 管理员 | 重置他人密码（免旧密码），踢掉其全部登录态 |
| `POST` | `/users/restore/:id` | 管理员 | 恢复软删除用户 |
| `DELETE` | `/users/:id` | 管理员 | 软删除用户（同时踢掉其登录态） |
| `GET` | `/users/:id/sessions` | 管理员 | 某用户的登录设备 |
| `DELETE` | `/users/sessions/:id` | 管理员 | 踢出某用户全部登录态 |
| `DELETE` | `/users/:id/sessions/:sessionId` | 管理员 | 踢出某用户单个会话 |
| `GET` | `/users/:id/login-logs` | 管理员 | 某用户的登录记录 |

- 列表默认按修改时间（`updatedAt`）降序，`pageSize` 上限 100
- 响应字段由 `src/modules/user/dto/user.dto.ts` 的列白名单决定，不含 `passwordHash` / `deletedAt`
- 分页响应：`{ items, total, page, pageSize, totalPages }`

### 认证与授权

双 token 方案（opaque token，服务端可即时吊销）：

| 项 | 默认值 | 环境变量 |
| --- | --- | --- |
| accessToken 有效期 | 2 小时 | `AUTH_ACCESS_TTL_MINUTES` |
| refreshToken 有效期 | 7 天，滑动续期 | `AUTH_REFRESH_TTL_DAYS` / `AUTH_REFRESH_SLIDING` |
| 提前续期窗口 | 剩余 5 分钟 | `AUTH_REFRESH_WINDOW_MINUTES` |
| 单用户并发会话上限 | 20（超出淘汰最旧） | `AUTH_MAX_SESSIONS_PER_USER` |
| 登录失败限流 | 15 分钟内 10 次 → 429（按 学号+IP） | `AUTH_LOGIN_MAX_ATTEMPTS` / `AUTH_LOGIN_WINDOW_MINUTES` |
| 信任代理的 XFF | 否 | `AUTH_TRUST_PROXY` |

- **token 双通道**：
  - `accessToken` → 响应体 JSON，前端放内存，请求带 `Authorization: Bearer`
  - `refreshToken` → **HttpOnly Cookie**（`refresh_token`；`Path=/auth/refresh`、
    `SameSite=Strict`、`HttpOnly`，生产加 `Secure`）——前端接触不到 RT 明文，XSS 偷不走；
    响应体不含 RT
  - 非浏览器客户端（App/脚本）设 `AUTH_REFRESH_COOKIE=false` 退回 body 传 RT 的模式
- **静默续期**（前端）：收到 401 → `POST /auth/refresh`（Cookie 自动携带，无需 body）→
  换新 accessToken → **重放原请求**。铁律：**并发 401 必须共享同一个刷新 Promise**——
  并发双刷会让第二个请求带着已轮换的旧 RT，触发服务端"重放即吊销全部会话"
- 401 的两种含义：AT 过期（刷新后重放，用户无感）/ RT 也失效（跳登录页）
- 登录失败统一 401「学号或密码错误」（不区分账号是否存在，且两条路径耗时对齐）
- 登录（成功/失败/限流）与所有踢出操作都记录审计：`auth_login_logs` / `auth_sessions.revoked_reason`

### 密码规则

长度 8~18，字符仅限字母 / 数字 / 下划线，三类至少占两类。创建用户与修改密码共用
`@/shared/validation.js` 的 `passwordSchema`；旧密码只校验非空与长度上限。

## 日志

- 控制台 + 文件双写（`FileLogger`），文件内容不含颜色码
- 每个请求恰好一行访问日志：`METHOD /path status 耗时ms [失败: 原因]`，
  级别按状态码分流（≥500 `error` / ≥400 `warn` / 其余 `log`）
- 每个请求带 traceId：优先透传 `x-trace-id` / `x-request-id`，否则生成 UUID，
  并回写到响应头与日志行前缀 `[traceId=...]`
- `LOG_BODY=true` 时额外记录一行请求体（敏感字段替换为 `***`）
- 5xx 记录带 `cause` 链与堆栈的错误日志，4xx 只由访问日志留痕

启动时会打印服务地址与耗时，可用 `服务已就绪` / `可访问地址` / `启动耗时` 检索。

## 项目结构

```
src/
├── main.ts             # 入口：日志、启动日志、listen
├── server.ts           # createApp()：创建应用并注册中间件（测试复用）
├── app.module.ts       # 根模块
├── app.core.module.ts  # 全局组件的目录清单（守卫/拦截器/过滤器在各功能域自注册）
├── config/env.ts       # 环境变量 schema
├── common/             # 响应契约类型
├── shared/             # 常用件：common.js / validation.js 两个 barrel，
│                       #   http/ 放全局过滤器、拦截器、zod 管道
├── database/           # DatabaseService 与 schema
├── logger/             # 文件日志、trace、访问日志、脱敏、错误格式化
├── startup/            # 启动地址枚举
└── modules/user/       # 用户模块（controller / service / dto）

跨目录导入用 @/ 别名：import { trimmedShape } from '@/shared/validation.js';
测试与被测代码同目录：每个目录或模块下的 __tests__/ 存放 *.spec.ts
```

协作约定见 [AGENTS.md](./AGENTS.md)。

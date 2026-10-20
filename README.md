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

# 按下方「环境变量」创建 .env（至少包含 DATABASE_URL）
pnpm db:migrate           # 建表，并灌入 drizzle/0001 的种子用户
pnpm start:dev            # 监听 http://localhost:8000
```

> `drizzle/0001_seed_users.sql` 是自定义迁移，会灌入 100,000 条拟真用户数据，
> 其中学号 `2019010001` ~ `2019010003` 是密码为 `12345678` 的演示账号。

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

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/users` | 创建用户 |
| `GET` | `/users` | 分页列表（`page` / `pageSize` / `keyword` / `role` / `sortBy` / `order`） |
| `GET` | `/users/by-student-no/:studentNo` | 按学号查询 |
| `GET` | `/users/:id` | 按 ID 查询 |
| `PATCH` | `/users/:id` | 更新资料（邮箱 / 昵称 / 角色 / 积分） |
| `PATCH` | `/users/password/:id` | 修改密码（需提交 `oldPassword`，不符返回 401） |
| `POST` | `/users/restore/:id` | 恢复软删除用户 |
| `DELETE` | `/users/:id` | 软删除用户 |

- 列表默认按修改时间（`updatedAt`）降序，`pageSize` 上限 100
- 响应字段由 `src/modules/user/user.projection.ts` 的列白名单决定，不含 `passwordHash` / `deletedAt`
- 分页响应：`{ items, total, page, pageSize, totalPages }`

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
├── app.config.ts       # 全局过滤器 / 拦截器注册
├── config/env.ts       # 环境变量 schema
├── common/             # 响应契约类型
├── shared/             # 常用件：common.js / validation.js 两个 barrel，
│                       #   http/ 放全局过滤器、拦截器、zod 管道
├── database/           # DatabaseService 与 schema
├── logger/             # 文件日志、trace、访问日志、脱敏、错误格式化
├── startup/            # 启动地址枚举
└── modules/user/       # 用户模块（controller / service / projection / dto）

跨目录导入用 @/ 别名：import { trimmedShape } from '@/shared/validation.js';
测试与被测代码同目录：每个目录或模块下的 __tests__/ 存放 *.spec.ts
```

协作约定见 [AGENTS.md](./AGENTS.md)。

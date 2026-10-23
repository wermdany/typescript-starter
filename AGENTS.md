# AGENTS.md — 项目约定入口

> 本文件**只是入口**，不是全部约定。详细规范拆在 `docs/conventions/`（第 7 节有地图）。
> **动代码前先查第 3 节路由表，只加载需要的那一份**，不要通读全部 —— 900 行全量加载时，
> 每条规则的权重会被稀释，后段的遵循率显著下降。
>
> 新增功能、修改约束时，一律参照现有代码的写法和格式来写，不要另起一套。

**控制力的来源不是"写了多少条"，而是"违规能不能被机器发现"。**
能进类型系统的进类型系统，能写脚本的别写文档，只有实在无法机器化的才留在这里。

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

## 2. 不可协商的红线

每条都标了**谁检查**。写"人工 review"的是目前没有脚本兜底的规则 —— 不要因为没报错就当没问题。

| # | 红线 | ❌ | ✅ | 谁检查 |
| --- | --- | --- | --- | --- |
| 1 | 不重启、不 kill 开发服务器 | `pnpm start` / kill 8000 | `pnpm dev:probe` 看状态 | 第 5 节 + 人工 |
| 2 | 本地导入带 `.js`，跨目录用 `@/` | `'../../shared/x'` | `'@/shared/common.js'` | `scripts/convention-audit.mjs` |
| 3 | 文件后缀只用约定的五种 | `user.projection.ts` | `dto/user.dto.ts` | 同上 |
| 4 | 对外字段用列白名单 | `Omit<Users,'passwordHash'>` | `userPublicColumns` | 同上 |
| 5 | 角色判定只走三个原语 | `roles.includes('admin')` | `isAdmin(user)` | 同上 |
| 6 | 配置整对象注入 | `ConfigService.get('PORT')` | `@Inject(ENV) env: Env` | 同上 |
| 7 | 路径参数不用 `z.coerce.number()` | `z.coerce.number()` | regex + `transform(Number)` | 同上 |
| 8 | `timestamps()` 必须调用展开 | `...timestamps` | `...timestamps()` | 同上 |
| 9 | 日志走 `Logger` | `console.log` | `new Logger('Context')` | 同上 |
| 10 | Controller 不手写响应 | `res.json(...)` | 抛 `HttpException` 子类 | 同上 |
| 11 | 每条路由显式声明访问意图 | 裸奔的路由 | `@Public()` / `@Authenticated()` / `@RequirePermission()` / `@OwnerOrPermission()` | `pnpm perm:audit` |
| 12 | 面向用户资源的写方法首参是 `actor` | `softDelete(id)` | `softDelete(actor, id)` | TypeScript（R1）+ 人工 review |
| 13 | 一次请求多次写必须包事务 | 两次独立写 | `database.transaction()` | 人工 review |
| 14 | 唯一冲突转 409 前先解包 `err.cause` | 读 `err.code` | 解包 `DrizzleQueryError` | 人工 review |
| 15 | `success === (状态码 2xx)` | 200 + `success:false` | 失败走过滤器 | 测试 + 人工 review |
| 16 | `envSchema` 与 `.env.example` 一一对应 | 只改一处 | 两边同步 | `env-example-sync` 规则 |
| 17 | 跨用户操作的准入问**权限码**，不问角色 | `isAdmin(actor)` 分支 | `mayActOnOthers(actor, 'user:delete')` | `admin-role-branch` 规则 |

---

## 3. 路由表：改什么 → 读哪份 → 必跑什么

| 你要改的东西 | 读这一份 | 必跑 |
| --- | --- | --- |
| 目录结构、模块分包、新增模块 | `docs/conventions/01-architecture.md` | `pnpm typecheck` |
| controller、DTO、响应字段、分页 | `docs/conventions/02-request-response.md` | `pnpm verify` + curl |
| 建表、改列、查询、事务 | `docs/conventions/03-database-schema.md` | `pnpm db:generate`（人工看 SQL） |
| 权限、角色、归属、service 写方法 | `docs/conventions/04-auth.md` | `pnpm perm:audit` |
| 环境变量、日志 | `docs/conventions/05-config-logging.md` | `pnpm typecheck` |
| 代码风格、新增 npm script / 扫描脚本 | `docs/conventions/06-style-scripts.md` | `pnpm lint` |
| 遇到"明明没错却不对" | `docs/conventions/07-pitfalls.md` | — |

---

## 4. 验证：按改动类型分级，不要一律全做

**验证命令不超过 3 条，超过就停下汇报**（不是"保险起见全跑一遍"）。

| 改动类型 | 必跑 | 说明 |
| --- | --- | --- |
| 只改 service / util 内部 | `pnpm typecheck` + `pnpm lint` | 不动路由与契约时到此为止 |
| 动 controller 路由或权限标注 | 上述 + `pnpm perm:audit` | 退出码必须 0 |
| 动 DTO / 响应字段 | 上述 + 目标 curl（400 带 `errors`、404、409） | 顺带确认无 `passwordHash` / `deletedAt` |
| 动 schema | `pnpm db:generate` + 人工看迁移 SQL | 开发期可 `pnpm db:push` |
| 动配置 / 日志 | `pnpm typecheck` + 查 `logs/app.log` | 见 `05-config-logging.md` |
| 发版或 CI | 追加 `pnpm build` + `pnpm test` | 日常开发**不要**跑 `pnpm build` |

一次性跑全套：`pnpm verify`（= `typecheck` + `lint` + `perm:audit`）。

命令约定：

```bash
pnpm typecheck      # tsc --noEmit，零副作用，日常用这个
pnpm lint           # oxlint + 规范审计（scripts/convention-audit.mjs）
pnpm perm:audit     # 路由权限标注审计，非零退出码
pnpm verify         # 上面三条串起来
pnpm dev:probe      # 开发服务器状态（只读，不重启）
pnpm build          # 只在发版/CI 跑：会动 dist/，可能干扰 watch 进程
```

**新增依赖必须由用户本人执行安装**（AI 只改 `package.json` / 给出安装命令，不运行 `pnpm add`）。

**单轮对话内完成的需求，不写单元测试也不跑测试**（无论过程中是否已写过测试代码）——
只做上表的验证。例外：用户明确要求写测试或跑测试时；跨多轮的大需求明示"做完整方案/全部测试"时。

---

## 5. 开发服务器与止损规则

服务由 `pnpm start:dev`（`nest start --watch`）启动，监听 `http://localhost:8000`。
**不要执行 `pnpm start` / `pnpm start:dev` / `pnpm start:prod`，不要 kill 8000 端口上的进程。**

`nest-cli.json` 的 `deleteOutDir` 已于 2026-10-21 改为 `false`（原本会在本机触发 safe-delete 保护而卡住）。
代价是 `dist/` 会残留过期产物 —— 需要干净重建时手动删除该目录。

### 探测：一次拿全，不要多轮试

```bash
pnpm dev:probe                  # 端口 / pid / 产物新旧 / 日志尾行，一次给全
pnpm dev:probe --json           # 供脚本解析
curl -s --max-time 3 --noproxy '*' -w '\n%{http_code}' http://localhost:8000/users?pageSize=1
```

### 止损红线

1. 改完代码**等 1~3 秒**再验证（watch 自动重编译）
2. **同一现象最多重试 1 次**：404 且是新增路由 → 再等 2 秒重试一次
3. 第二次仍失败 → **输出诊断并问用户**，禁止重启、禁止 kill、禁止继续循环
4. `dev:probe` 报"端口无监听" → 直接问用户，不自己拉起服务
5. 不要依据 `pnpm build` 的产物下结论：它会干扰 watch 进程

---

## 6. 完成定义（收尾必须输出这个块）

```text
### 本次改动
- 文件：<路径列表>

### 验证（命令 → 退出码 → 关键输出）
- pnpm typecheck → 0
- pnpm lint → 0
- curl … → 200 / 400(errors[].path=nickname) / 409

### 规范兜底
- 本次触碰的红线 #2/#5 由 scripts/convention-audit.mjs 检查
- 本次触碰的红线 #11 由 pnpm perm:audit 检查

### 未验证项（如实写，不要省略）
- 未覆盖 401 分支：<原因>
```

---

## 7. 文档地图

| 文件 | 内容 |
| --- | --- |
| `docs/conventions/01-architecture.md` | 目录结构、模块内分包、文件命名、依赖方向、测试位置、新增模块清单（原 §2 §14） |
| `docs/conventions/02-request-response.md` | 响应契约、列级白名单、请求校验、分页排序（原 §5 §6 §7） |
| `docs/conventions/03-database-schema.md` | 数据库访问、`pgTable` schema 规范（原 §8 §15） |
| `docs/conventions/04-auth.md` | 密码、RBAC、Ownership、内部服务调用防越权（原 §9 §16 §17 §18） |
| `docs/conventions/05-config-logging.md` | 环境变量、配置注入、日志与异常（原 §4 §10） |
| `docs/conventions/06-style-scripts.md` | 代码风格、`scripts/` 目录约定（原 §11 §19） |
| `docs/conventions/07-pitfalls.md` | 已知坑与反直觉行为（原 §13） |
| `docs/rbac-plan.md` | RBAC 方案与识别边界的唯一权威来源 |

脚本（都支持 `--json` 与退出码 `0` 成功 / `1` 发现问题 / `2` 环境错误）：

| 脚本 | 作用 |
| --- | --- |
| `scripts/convention-audit.mjs` | 把本文件第 2 节的红线变成红绿灯（`--list-rules` 看全部规则） |
| `scripts/permission-audit.mjs` | 路由权限标注审计（`pnpm perm:audit`） |
| `scripts/sync-permissions.mjs` | 权限码同步进数据库（`pnpm perm:sync`） |
| `scripts/dev-probe.mjs` | 开发服务器状态探针（`pnpm dev:probe`） |

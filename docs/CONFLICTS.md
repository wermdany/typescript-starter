# 规范冲突清单 —— 待决策

> 本文件只做**冲突登记与决策记录**，不修改任何规范。
> 来源：逐节比对原 `AGENTS.md`（862 行，现拆入 `docs/conventions/`）与代码现状。
> 每条都给了证据行号与选项，**决定后把结论写进"决策"一栏，再改对应的规范文件**。
>
> 分级：**A** = 会让 AI 按错的规范写代码（必须决策）／**B** = 文档自相矛盾但代码已定型（选边站）／**C** = 过时或悬空引用（低风险，顺手改）。

---

## A 类：会让 AI 写错代码

### A1. 对外字段白名单放哪个文件 —— 文档 2:2 打平

| 说法 | 出处 |
| --- | --- |
| 收进 `dto/xxx.dto.ts`，**禁止** `*.projection.ts` | 原 §2（`01-architecture.md`）· 原 §14.3（同上） |
| 由 `<domain>.projection.ts` 界定 | 原 §5（`02-request-response.md`）· 原 §15.2-8（`03-database-schema.md`） |

代码现状站 projection 一边：`src/modules/user/user.projection.ts`、
`src/modules/user/__tests__/user.projection.spec.ts`（4 处引用：user.service / user.controller / spec）。
这也是 `pnpm lint` 目前唯一一条红色违规的来源。

**决定性证据**：`auth` 模块（较新的模块）**已经全部用 `dto/xxx.dto.ts`** ——
`session/dto/session.dto.ts` 的 `sessionPublicColumns`、`log/dto/login-log.dto.ts` 的
`loginLogPublicColumns`、`login/dto/user.dto.ts` 的 `authUserColumns`。
"只认 dto"不是新造的规矩，而是把唯一的遗留点（user 模块）对齐到既有实践。

**选项**

1. 认 projection：从"禁止自造后缀"里移除 `*.projection.ts`
2. **认 dto**：移到 `dto/user.dto.ts`，同步改 §5 / §15 措辞
3. 折中：移到 `dto/user.projection.dto.ts`

**影响**：新 AGENTS.md 红线 #3、`convention-audit.mjs` 的 `file-suffix` 规则、`docs/conventions/01/02/03` 三处措辞。

- **决策：选 2「只认 dto」（已执行）**

  落地内容：
  - `src/modules/user/user.projection.ts` → `src/modules/user/dto/user.dto.ts`
  - import 改相对路径 `./dto/user.dto.js`（`user.service.ts:51`、`user.controller.ts:37`）
  - 白名单断言并入已有 `__tests__/user-dto.spec.ts`（不新建 `user.dto.spec.ts`，
    避免与 `user-dto.spec.ts` 两个近似名并存），删除 `user.projection.spec.ts`
  - 措辞同步：`api-response.ts:18`、`session/dto/session.dto.ts:52`（它引用了并不存在的
    `session.projection.spec.ts`）、`02-request-response.md:46/69`、`03-database-schema.md:100`、
    `README.md:109/170`
  - 验证：`pnpm typecheck` 0 · `pnpm lint` 规范审计 0 违规 · `pnpm perm:audit` 0 ·
    `user-dto.spec.ts` 56 passed

---

### A2. 改密语义：§9 的描述已完全过时，且现在的说法是错的

原 §9 写着：「目前是**自助改密**语义……**项目没有登录/鉴权模块**，将来接入鉴权后应改为从会话取当前用户，
**不要信任路径上的 `:id`**」（见 `docs/conventions/04-auth.md`）。

代码早已落地且分成了两条，都有正确的权限标注（`perm:audit` 通过）：

| 路由 | 标注 | 语义 |
| --- | --- | --- |
| `PATCH /users/password` | `@Authenticated()` | 自助改密，id 取自 `@CurrentUser()`（`user.controller.ts:123-131`） |
| `PATCH /users/password/:id` | `@RequirePermission('user:reset-password')` | 管理员重置，id 来自路径（`:135-143`） |

**所以"不要信任路径上的 `:id`"这句话现在是错的** —— 它描述的接口已经被权限码守住了。
AI 照 §9 写会去"修正"一个本来正确的管理端路由。

**选项**

1. 重写 §9 这一段：两条路由并存，前者从会话取 id，后者需 `user:reset-password`；删掉"没有鉴权模块"。← 建议
2. 只保留自助路由，删除 `password/:id`（会丢掉管理员重置能力）

- **决策：选 1（已执行）** —— 重写了该段：两条路由并存、语义不同，
  自助路径的 `:id` 一旦出现就是越权面，管理路径的 `:id` 由 `user:reset-password` 守着、是设计如此。
  同时删掉"项目没有登录/鉴权模块"这句。

---

### A3. 索引命名：规则文字与实践不一致

- 规则文字（§15.2-5）：普通索引 `表名_列名_idx`
- 实践（`src/database/schema/*.ts`）：外键列**省略 `_id`**

```
index('auth_login_logs_user_idx').on(t.userId, t.createdAt)   // 列名是 user_id
index('user_roles_role_idx').on(t.roleId)                     // 列名是 role_id
index('users_nickname_idx').on(t.nickname)                    // 非外键，完整列名 ✓
```

此外 §15.1 的示例 `index('xxx_user_idx').on(t.userId)` 与它自己下面的规则也不自洽。

**选项**

1. **改文档**：规则补一句"外键索引名省略 `_id` 后缀"，示例同步。代价最小。← 建议
2. **改代码**：把索引重命名为 `..._user_id_idx` / `..._role_id_idx`，需要新迁移、动线上索引名

- **决策：选 1（已执行）** —— 社区对索引命名没有唯一标准（`{table}_{col}_idx` 与
  `idx_{table}_{cols}` 都常见），**一致性优先**；项目已有 20+ 个索引一致采用"外键省略 `_id`"，
  改代码要动迁移和线上对象，不划算。规则文字与 §15.1 示例已同步。

---

## B 类：文档自相矛盾，代码已定型

### B1. `pnpm build` 到底跑不跑（本次重构引入的新不一致）

- 新 `AGENTS.md` §4：日常开发**不要**跑 `pnpm build`，只用 `pnpm typecheck`
- `docs/conventions/03-database-schema.md:102`：改完 `pnpm build` → `db:generate` → …
- `docs/conventions/07-pitfalls.md:10`：保留"build 会杀 watch 进程"的说明

前两条直接冲突。AI 看到入口层说别跑、细节层说必须跑，会选更保险的那个（即跑 build，正是它拖慢验证的元凶）。

**选项**：① 同步改 `03` 为 `pnpm typecheck` ← 建议 ② 恢复 build 为必做

- **决策：选 1（已执行）** —— `03-database-schema.md` 第 9 条改为 `pnpm typecheck`，
  并注明日常不要跑 build 的原因。

---

### B2. `@AdminOnly` 的定性：文档说"遗留并存"，代码里已经没有

- 原 §2 目录树把它和 `@Public()` / `@CurrentUser()` 并列成一等公民
- 原 §16：迁移期允许以"遗留"形式存在，新代码不要再用
- 实际：全仓库只剩**注释**提及（`auth.decorator.ts:33`、`auth.guard.ts:70`、`auth.module.ts:10/19`、
  `auth.controller.ts:60`），`perm:audit` 报告「遗留 0」

**选项**：① 连装饰器一起删除，注释改掉，`--strict-legacy` 保留空跑 ← 建议 ② 保留装饰器，只改文档措辞

- **决策：选 1（已执行；脚本侧也全部清干净）** ——
  删除：`AdminOnly` 与 `ADMIN_ONLY_KEY`（`auth.decorator.ts`）、`AuthGuard` 的 adminOnly 分支、
  barrel 导出、4 处注释、`auth.guard.spec.ts` 的 3 个过时用例，
  **以及** `markers.mjs` 的遗留识别、`perm:audit` 的 `--strict-legacy` 与"遗留"报告分支。
  现在 `@AdminOnly()` 不再是合法标记，写上会被 `perm:audit` 判为未追踪路由并失败（fail-closed）。
  守卫行为变化：`AuthGuard` 现在只管"有没有登录"，管理员/权限点全部归 `PermissionGuard`。

### A2 续：权限验证全部归于 RBAC（含 service 内部）

用户追加要求：改密等"能不能动别人资源"的判定要归 RBAC，清掉 Admin 系的角色分支。

`isAdmin(actor)` 在业务代码里有 4 处，3 处是"跨用户操作准入"：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| `UserService.softDelete` | `!isSystemActor(actor) && !isAdmin(actor)` | `!(await mayActOnOthers(actor, 'user:delete'))` |
| `UserService.restore` | 同上 | `mayActOnOthers(actor, 'user:restore')` |
| `UserService.changePassword` | `isSystemActor(actor) \|\| isAdmin(actor)` | `mayActOnOthers(actor, 'user:reset-password')` |
| `update-policy.ts:50` | `isAdmin(actor)` → 角色→可改字段集 | **保留**（§2 明确授权的字段级白名单，本来就是角色语义） |

配套改动：
- `RbacModule` 改为 `@Global()` —— `PERMISSION_CHECKER` 要在 service 里用，
  而业务模块之间不互相 import（与 `DatabaseModule` 同为基础设施层的全局模块）。
  文档已如实写明：删掉 `app.core.module.ts` 那行仍能关掉全局守卫，
  但注入了 `PERMISSION_CHECKER` 的 service 会启动失败 —— 回滚开关的边界变了
- 新增 `admin-role-branch` 审计规则：`isAdmin()` 出现在业务代码即违规
  （白名单 `common/` `shared/` `modules/rbac/` 与 `update-policy.ts`）。已用临时探针验证能抓到
- §18 的"已知弱点"同步：R2/R4/R5 仍无机器化检查，但 isAdmin 分支这条**已有**

- **决策：已执行**

---

### B3. 角色判定原语：§2 说一个，§16 说三个

- 原 §2：「角色判定**只走 `isAdmin()`**」，示例用 `role === 'admin'`
- 原 §16：三个原语 `hasRole()` / `hasAnyRole()` / `isAdmin()`

而且 §2 的示例 `role === 'admin'` 用的是**已删除的旧模型** —— `users.role` 单值列在 `0006` 迁移里删掉了
（§16 已注明），现在 `roles` 是 `readonly RoleCode[]`。示例本身是死代码。

**选项**：以 §16 为准同步 §2（新 `AGENTS.md` 红线 #5 已按三个原语写）。无实质争议。

- **决策：以 §16 为准（已执行）** —— §2 改成三个原语，并注明 `users.role` 单值列已删除、
  任何 `role === '...'` 形态都是死代码。

---

## C 类：过时与悬空引用

| # | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| C1 | 环境变量清单漏 `RBAC_CACHE_TTL_SECONDS` | `env.ts:52` 声明、`.env.example:44` 有、`rbac/permission.service.ts:54` 在用 | ✅ 清单补成 17 个；**并新增 `env-example-sync` 规则**自动比对 `envSchema` 与 `.env.example`，从此不会再漂移（已实测：故意加一个假键会被抓出） |
| C2 | §19 引用了不存在的 `perm:matrix` 与 `docs/rbac-matrix.md` | `docs/` 下只有 `conventions/` 与 `rbac-plan.md`；`package.json` 无该 script | ✅ 删除悬空引用，并注明"当前没有生成型脚本，将来加回按同一规矩" |
| C3 | §2 目录树漏 `rbac` 模块 | 实际 `src/modules/` = auth / rbac / user | ✅ 补上 rbac，注明它是基础设施（权限码解析与缓存、守卫注册），不是业务域 |
| C4 | §15.1 示例索引名与 §15.2 规则不自洽 | 示例 `xxx_user_idx`，规则 `表名_列名_idx` | ✅ 随 A3 一起：示例加注释，规则补"外键省略 `_id`" |
| C5 | user 模块 13 个文件，逼近 15 的分包阈值 | `find src/modules/user -name '*.ts'` = 13 | ✅ **决策：维持 15 阈值，不提前分包** —— 未触发的规则不必预防性执行，等真到了再按 auth 的样子拆 |
| C6 | §5 禁写 `toXxxResponse()`，代码里有 `toUserResponse()` | `dto/user.dto.ts:51`；`roles` 不能进 `RETURNING` | ✅ 文档改为"不写**改造响应**的映射函数"，并补判据：**能否进 SQL 投影** —— 能进走白名单，不能进（派生字段）才允许合成；类型形态如实写成 `UserScalars` + `UserResponse extends` |
| C7 | 孤儿测试文件名 | 见 A1 段 | ✅ 4 个改名：`login.use-case.spec.ts` → `login.service.spec.ts`、`refresh.use-case.spec.ts` → `refresh.service.spec.ts`、`session.use-case.spec.ts` → `session-manager.service.spec.ts`（按各自实际 import 的被测类）、`log/projection.spec.ts` → `__tests__/public-columns.spec.ts`（它跨测三个子域的白名单，放模块级更合适）。**并把 `file-suffix` 规则扩展到 `.spec.ts`** —— 以前抓不到测试文件名的孤儿 |

---

## 状态：全部 12 条已处理

A1（只认 dto）、A2（承认双路由）、A3（改文档）、B1（build → typecheck）、
B2（删 `@AdminOnly`，脚本侧保留识别作安全网）、B3（以 §16 为准）、C1–C7 全部落地。

唯一保留的"未决项"是 `docs/rbac-plan.md` 里的历史路径引用（`user.projection.ts` 等）——
它是已完成任务的**历史记录**，改它等于篡改史实，因此不动。

# 密码、RBAC、归属判定与内部调用防越权

> 本文件是 AGENTS.md 第 §9、§16、§17、§18 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 动权限、角色、归属或 service 写方法时读这一份。

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
- ⚠️ **`oldPassword` 不要套 `passwordSchema`**：那是"设密码"的规则；库里可能存在
  规则收窄前设定的历史密码，用新规则卡旧密码会把老用户锁在门外。
  旧密码只要求非空 + `LEGACY_PASSWORD_MAX_LENGTH`（128，仅作 scrypt 输入规模兜底）

### 修改密码：`PATCH /users/password/:id`

- 请求体 `{ oldPassword, password }`，两个字段都经 `trimmedShape()` 规范化
- 流程（`UserService.changePassword()`）：显式 `select({ passwordHash })` → 不存在 404
  → `verifyPassword()` 不符 **401**「旧密码不正确」→ 通过后才 `hashPassword()` 写库
- **401 而不是 400**：参数合法，失败点在凭据。客户端靠状态码区分
  400（格式/规则，带 `errors[]`）/ 401（旧密码错）/ 404（用户不存在）
- 旧密码比对是 scrypt（慢），**先判存在再比对**
- **两条路由并存，语义不同，不要互相"修正"**：
  - `PATCH /users/password`（`@Authenticated()`）—— **自助改密**，凭旧密码改自己的，
    用户 id 取自 `@CurrentUser()`，**不接受路径 `:id`**
  - `PATCH /users/password/:id`（`@RequirePermission('user:reset-password')`）——
    **管理员重置**，无需旧密码，id 来自路径是合法的（有权限码守着），改完踢掉其全部登录态
  - 判断依据是"谁在改"：自助路径的 `:id` 一旦出现就是越权面；管理路径的 `:id` 是设计如此
- **服务级第二道防线问权限码，不问角色**：`changePassword()` 内部用
  `mayActOnOthers(actor, 'user:reset-password')` 决定"是否免旧密码 / 能否改别人的"，
  **不写 `isAdmin(actor)`** —— 角色只是权限码的载体，加一个"能删人但不能重置密码"的角色
  只应在数据库里授权，不改业务代码（见第 18 节）

---

---

## 16. RBAC 权限声明

**每条路由必须显式声明访问意图，禁止裸奔。** 不写任何标记的路由在运行时会被登录检查兜住（fail-closed），
但"忘了写"和"本就只要登录"在源码上无法区分 —— 这正是最高危的问题：新增接口漏掉权限而无人发现。
判定脚本 `pnpm perm:audit` 就是为此存在的，它只认下面四类标记。

| 标记 | 语义 | 典型用途 |
| --- | --- | --- |
| `@Public()` | 免登录 | 登录、刷新 token、健康检查 |
| `@Authenticated()` | 登录即可，无权限点要求 | 本人的资料 / 会话 / 登录记录 |
| `@RequirePermission('user:create', …)` | 必须具备**全部**权限码（AND） | 管理视角的接口 |
| `@OwnerOrPermission('id', 'user:update')` | 本人放行，否则要求权限码；`codes` 为空即**纯本人**限定 | 同一接口既服务本人又服务管理员 |

方法级覆盖类级（与 `Reflector.getAllAndOverride` 语义一致），判定脚本按同一规则算。

**权限码格式 `资源:动作`**：

- 资源段与 `@Controller` 前缀一致（`user` / `session` / `login-log`）
- 动作词表固定：`create` `read` `update` `delete` `restore` `reset-password` `revoke`；
  新动作先加进词表，不新造同义词
- 长度 ≤ 64；`*` 是保留码（超级管理员通配，`admin` 角色长期持有），**业务代码里不要写 `*`**

**新增权限码的三步准入，缺一不可**：① 出现在某个装饰器里；② `pnpm perm:audit` 能扫到；
③ `pnpm perm:sync` 写进 `permissions` 表并授权给目标角色（只做①②等于写了一个永远不放行的码）。

改完路由标注**必须**跑 `pnpm perm:audit`，它有非零退出码，红了不许合并。

`@AdminOnly()` **已彻底移除**：装饰器、`ADMIN_ONLY_KEY`、`AccessGuard` 里的 adminOnly 分支、
`perm:audit` 的 `--strict-legacy`、`markers.mjs` 的遗留识别 —— 全部删除，不留安全网。
现在它不再是合法标记：谁再写上，`perm:audit` 会把它判为**未追踪路由**并直接失败。
管理员语义一律用权限码表达，`AccessGuard` 只回答"这条路由放不放行"。

四个装饰器都从 `@/common/auth/access.decorator.js` 取（写同一把 `ACCESS_INTENT_KEY`），
判定逻辑在 `@/common/auth/access.ts` 的 `resolveAccess()`，接入 Nest 上下文在
`@/common/auth/access.guard.ts` 的 `AccessGuard`（唯一守卫，由 `common/http-stages.ts` 注册）。

角色判定只能走三个原语（`src/common/auth/auth.contract.ts`）：

```ts
hasRole(user, 'teacher');
hasAnyRole(user, ['teacher', 'admin']);
isAdmin(user);                     // === hasRole(user, ADMIN_ROLE)
```

```ts
// ❌ 全部禁止：散落写法，多角色后必然出偏差
user.roles[0] === 'admin'
user.roles.includes('admin')
user.roles.length === 1 && user.roles[0] === 'admin'
// ✅
isAdmin(user)
```

- `roles` 是 `readonly string[]`（多角色，权限取**并集**）；**允许空数组**，空 = 零权限 = 非管理员。
  类型不是内置角色的联合：角色码是库里的数据（管理端可运行时新增），
  要用字面量判内置角色时走 `hasRole(user, 'teacher')` —— 那个参数仍是 `RoleCode`，拼错编译报错
- 用户→角色集合**不缓存**（改角色下一个请求即生效）；角色→权限码走一级缓存
  `Map<roleCode, Set<permissionCode>>`，TTL 由 `RBAC_CACHE_TTL_SECONDS`（默认 60）控制、single-flight 刷新
- 🚨 `users.role` 单值列已删除，多角色走 `user_roles` 关联表。第 15.2 节第 7 条讲的 `pgEnum` 写法
  对其他枚举仍然适用，但**角色不是枚举**：`roles.code` 是 `varchar(32)`，运行时可增删角色

---

---

## 17. Ownership（本人资源）

"本人能改自己的部分信息、但不能改别人的、也不能改自己的某些字段"由**两道防线**表达，缺一不可：

| 防线 | 位置 | 管什么 |
| --- | --- | --- |
| 路由级 | 控制器 `@OwnerOrPermission('id', 'user:update')` | 拿 URL 的 `:id` 与 `actor.id` 比较；非本人则要求权限码 |
| 服务级 | service 内 `assertOwnership(actor, ownerId)` | 防内部调用 —— 同进程直调不经过守卫（见第 18 节） |

**为什么两道**：装饰器只能回答"这个人能不能进这个路由"，管不到 service 内部被二次引用；
service 断言又看不到 HTTP 参数。`ownerParam` 当前**只能指向用户 ID**（其他资源的归属走 service 断言，
不做路由级归属判定）。字段差异不在这里管，走 `update-policy.ts` 的白名单（第 14 节第 3 条同一取向）。

写方法首参约定：

```ts
softDelete(actor: Actor, id: number)   // ✅ 有身份才能判权
softDelete(id: number)                 // ❌ 只传资源 id，内部调用时无法判权
```

可信内部调用用 `systemActor('来源用途')` 构造身份：

```ts
const actor = systemActor('drizzle:0005');   // ✅ via 必填，留痕
await service.softDelete(actor, userId);     // ✅

await service.softDelete(userId);            // ❌ 跳过归属判定
{ ...user, id: actorId } as AuthenticatedUser // ❌ 伪造身份 + 类型断言，两样都禁
```

- `SYSTEM_ACTOR_ID = 0` 是保留 id，**真实用户 id 从 1 开始**
- `SystemActor.roles` 恒为空：它**不伪装成任何角色**（`hasRole(sysActor, 'admin') === false`），
  但 `ownsResource(sysActor, *) === true`。这个不对称是刻意的 —— 别当 bug 改掉
- `Actor = AuthenticatedUser | SystemActor` 是联合类型：需要真身份的位置（如 `@CurrentUser()` 的参数）
  必须先用 `isSystemActor()` 收窄，**禁止 `as`**

---

---

## 18. 内部服务调用防越权

同一进程内 A service 直接 import 并调用 B service 时**不经过任何守卫**：路由级 RBAC 与
`@OwnerOrPermission` 全部失效。这是本项目最容易被忽略的越权面 —— 传错一个 id 就能操作别人的数据。

| 编号 | 约定 |
| --- | --- |
| **R1** | 面向具体用户资源的**写**方法，第一个参数必须是 `actor: Actor`，不得只接收资源 id |
| **R2** | 这类方法体首部必须有一条断言：`assertOwnership(actor, targetId)`，或显式注明"管理视角，调用方负责 RBAC" |
| **R3** | 「同一事务内的附属写」可豁免 actor（如 `revokeAllForUser(userId, reason, { executor })`），豁免必须在下面登记，且这类方法**不得出现在 controller 里** |
| **R4** | 可信内部调用（迁移 / 种子 / 定时任务）用 `systemActor('来源')`，只允许出现在 `scripts/`、`drizzle/`、定时任务目录 |
| **R5** | HTTP 请求上下文内**禁止**出现 `SystemActor`（出现即说明有人绕过了鉴权） |

当前豁免清单（新增需在此登记）：`SessionService.revokeAllForUser()`。

⚠️ **已知弱点，请如实看待**：本项目**不做 `svc:audit` 自动化脚本**（已决策）。
R1 由 TypeScript 编译期兜住，"业务代码用 `isAdmin()` 决定能否操作别人资源"由
`scripts/convention-audit.mjs` 的 `admin-role-branch` 规则兜住（白名单只有
`update-policy.ts` —— 字段级白名单本来就是角色语义，§2 明确授权）。
**R2 / R4 / R5 仍然没有机器化检查**：传错目标 id、或在 controller 里构造 `SystemActor`，
CI 与编译都不会报错。因此：

- PR 描述里加一条自检：本次是否新增/修改了面向用户资源的写方法？首参是否 `actor`？内部调用是否走了 `systemActor`？
- review 时对新增的 service 写方法逐个看首参与断言
- **不要把"没报错"当成"没问题"**

---

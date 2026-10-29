# 契约分层：存储 / 投影 / 请求 / 响应 / 文档（§20）

> 一个接口涉及五个产物，它们**必须有唯一的派生方向**。这份文档回答两件事：
> ① 谁派生谁、谁能 import 谁；② 违反了由哪条命令报红。
>
> 改请求参数、响应字段、列白名单、`@ApiRoute` 之前读这一份。

---

## 20.1 五层与方向

依赖**只能向下**，任何反向边都会让"改一处、漏一处"重新出现：

```
① 存储契约   src/database/schema/*.schema.ts          drizzle 列定义（PG DDL ＋ TS 类型）
                 │  列对象在运行时带着 dataType / notNull / columnType
                 ▼
② 对外契约   src/modules/<domain>/dto/*.dto.ts
                 ├─ xxxPublicColumns    列白名单（drizzle 列引用 = SQL 投影）
                 ├─ XResponse           响应类型（Pick<表行, 白名单键> ＋ 派生字段）
                 ├─ xxxSchema           响应文档 schema（手写字段 ＋ .describe()，由类型锚定）
                 └─ xxxBodySchema       请求校验 schema（**反方向，与响应不共享字段**）
                 ▼
③ 用例层     <domain>/*.service.ts                    返回 ② 的类型；不新增形状
                 ▼
④ 入口层     <domain>/*.controller.ts                 @ZodXxx 校验 ＋ @ApiRoute 声明响应
                 ▼
⑤ 文档装配   src/common/openapi/*                     只消费 ② 的 schema；不出现字段列表
```

| 层 | 可依赖 | 禁止依赖 |
| --- | --- | --- |
| ① `database/schema/` | drizzle | ②③④⑤ |
| ② `dto/` | ①、`shared/`、`common/*.contract`（枚举来源） | ③④（`*.service.js` / `*.controller.js`） |
| ③ `*.service.ts` | ①②、`shared/` | ④ |
| ④ `*.controller.ts` | ①②③ | 直接查库 |
| ⑤ `common/openapi/` | ②、`common/auth`（读访问意图） | ③ 业务实现 |

**为什么 ② 在 ③ 上面**：响应形状是"这个资源对外长什么样"，属于契约；service 是"怎么算出它"，属于实现。契约不该依赖实现——依赖反了，service 里的临时结构就会顺着类型渗进 API。

---

## 20.2 六条规则

### R1 · `dto/` 不得 import `*.service.js` / `*.controller.js`

```ts
// ❌ 契约依赖实现
import type { LoginResult } from '../login.service.js';

// ✅ 实现在契约里取类型
import type { LoginResult } from './dto/login.dto.js';
```

**谁检查**：`convention-audit` 的 `dto-layer-dependency`。

### R2 · 响应形状只有两个合法来源

| 响应形状 | 唯一出处 | 类型从哪来 |
| --- | --- | --- |
| **= 某组数据库列** | 手写 `z.object({ … })`，用 `schemaFor<表行投影>()(...)` 钉住 | `Pick<表行, keyof 白名单>` ＋ 派生字段 |
| **不是表行**（组合 / 计算值 / 嵌套） | 手写 zod schema | `z.infer<typeof schema>` |

不允许第三种：**类型手写一份 + schema 手抄一份**。

```ts
// ❌ 同一个形状写两遍，改一处就漂移
export interface Foo { id: number; createdAt: Date }
export const fooSchema: z.ZodType<Foo> = z.object({ id: z.number(), createdAt: z.date() });

// ✅ 表行：类型从列派生，schema 手写并用 schemaFor 双向钉住（描述就地写）
export const fooColumns = { id: foo.id, createdAt: foo.createdAt } as const;
export type Foo = Pick<Foos, keyof typeof fooColumns>;
export const fooSchema = schemaFor<Foo>()(
  z
    .object({
      id: z.number().int().describe('ID'),
      createdAt: dateSchema.describe('创建时间'),
    })
    .meta({ id: 'Foo' }),
);

// ✅ 非表行：schema 是唯一出处，类型从它推
export const barSchema = z
  .object({ revoked: z.number().int(), currentRevoked: z.boolean() })
  .meta({ id: 'Bar' });
export type Bar = z.infer<typeof barSchema>;
```

**为什么是 `schemaFor<T>()` 而不是 `const s: z.ZodType<T> = …`**：后者只做**单向**检查
（schema 输出能赋给 `T`），实测漏掉了「schema 比类型多一个字段」——多出来的字段会出现在
文档里而服务端永远不返回。`schemaFor<T>()` 用双向可赋值性判断，三个方向都拦得住：

| 场景 | `z.ZodType<T>` 注解 | `schemaFor<T>()` |
| --- | --- | --- |
| 漏字段 | 编译错误 | 编译错误 |
| 字段类型 / 可空性写错 | 编译错误 | 编译错误 |
| schema 多出字段 | **静默通过** | 编译错误 |

**谁检查**：`pnpm typecheck`（`schemaFor` 的双向断言）＋ review（判断"这个形状是不是表行"）。

### R3 · service 不得重复声明 `*Result` / `*Response`

service 里出现 `export interface XxxResult` / `export interface XxxResponse`，说明响应形状被抄到了实现层。改成从 `dto/` 取：

```ts
// ❌ refresh.service.ts 里再写一遍 8 个字段
export interface RefreshResult { accessToken: string; refreshToken: string; /* … */ }

// ✅ 指向同一个定义
export type { LoginResult as RefreshResult } from './dto/login.dto.js';
```

**谁检查**：`convention-audit` 的 `service-response-shape`。

### R4 · 请求 schema 与响应 schema 不共享字段定义

两者方向相反，字段集和规则都不同：

| 字段 | 请求 | 响应 |
| --- | --- | --- |
| `email` | `z.email()` 拒绝脏数据 | 只描述「库里存的字符串」 |
| `name` | `trim().min(1).max(50)` | 不校验 |
| `password` | 必填 | 不存在 |
| `id` / 时间戳 | 不存在 | 必出现 |

共享只允许发生在**原语层**（`shared/validation.ts` 的 `trimmedShape` / `passwordSchema` / `dateSchema` / `paginationSchema`）。

**谁检查**：review。

### R5 · `dto/` 里禁止裸 `z.date()`

`z.date()` 在 JSON Schema 里是不可表示类型，输出 `{}`——不报错，但文档里那一列变成空 schema。统一用 `dateSchema`（`shared/validation/date.ts`）。

**谁检查**：`convention-audit` 的 `raw-date-schema`。

### R6 · 每个命名响应 schema 必须被引用

声明了 `.meta({ id })` 却没有任何 `@ApiRoute`（或另一个被引用的 schema）用到它，它**不会进 `components`**——形成"以为文档里有、其实没有"的假象。

**谁检查**：`convention-audit` 的 `orphan-schema`。

### R7 · 每个路由必须有 `@ApiRoute`

`@ApiRoute({ summary, description, data })` 是这个接口的**完整对外声明**：做什么 + 返回什么。
没有它，Swagger 里只剩一行 `GET /users/{id}`。

```ts
@RequirePermission('user:read')
@ApiRoute({
  summary: '按 ID 查用户',
  description: '管理员视角；软删除用户返回 404',
  data: userResponseSchema,
})
@Get(':id')
findOne(...) {}
```

四条硬约束：

1. **只有三个参数**：`status` 不手写 —— 从 `@HttpCode()` 推导，没有则 POST 取 201、其余 200（与 Nest 的实际行为一致，文档不会和真实响应脱节）
2. **`data` 必填**：无返回体写 `data: null`，否则"忘了写"和"故意没有"分不清
3. **必须写在 `@Get` / `@Post` 之上**：装饰器自下而上执行，写在下面读不到 `METHOD_METADATA`，会直接抛错
4. **只管文档**：成功文案由 `@ApiMessage()` 单独声明（那是 `TransformInterceptor` 的输入，不是文档）

**谁检查**：`convention-audit` 的 `missing-operation-doc`（源码层，文档关着也拦得住）。

---

## 20.6 文档完备性：五条硬约束（启动期校验）

`buildOpenApiDocument()` 在返回文档前跑 `validateOpenApiDocument()`，任一不满足就**抛错**（只在 `NODE_ENV=development` 或显式开启时执行，所以不会影响生产与测试）。

| # | 约束 | 为什么必须是硬约束 |
| --- | --- | --- |
| 1 | 每个 operation 有 `summary` | 没有它，接口列表就是一串路径 |
| 2 | 每个参数、请求体字段有描述 | 入参是调用方唯一能看到的"用法" |
| 3 | 每个响应有描述，响应体每个字段有描述 | 同上，反向 |
| 4 | 不允许「没有类型信息」的 schema | `z.date()` 这类会静默变成 `{}`，文档里是一列 `any` |
| 5 | 不允许断链的 `$ref` | UI 上表现为"模型展开不了"，没有任何报错 |

字段描述只有一处来源：zod 的 `.describe()`，就地写在字段上。响应 schema 因此必须手写字段（而不是从列白名单自动展开）—— 用 `z.ZodType<表行投影>` 锚定来保证「漏写字段 / 类型或可空性写错」编译期就报错，`z.infer` 那套则用于非表行形状。

### 公共错误与顺序

公共错误（401 / 403 / 404 / 500）的文案只有一处：`common/openapi/errors.ts`。**谁来挂**由最了解它的装饰器决定：

| 状态 | 谁挂 | 理由 |
| --- | --- | --- |
| 400 | `@ZodBody` / `@ZodQuery` / `@ZodParam` | 只有带入参的接口才可能校验失败 |
| 401 | `@Authenticated` / `@RequirePermission` / `@OwnerOrPermission` | 要登录才可能未登录 |
| 403 | `@RequirePermission` / `@OwnerOrPermission` | `@Authenticated` 没有权限码 |
| 404 | `@ZodParam` / `@ZodParams` | 有路径参数才意味着"按标识取资源" |
| 409 | `@Idempotent` | 只有参与幂等的写接口才有重放冲突 |
| 500 | `buildOpenApiDocument()` | 没有装饰器能预知，统一兜底 |

**显示顺序**：`2xx → 4xx（按状态码升序）→ 5xx`。

这里有一个协议层限制，必须说清：OpenAPI 的 `responses` 是对象，而 JS 对象的**整数键恒定按数值升序**枚举（`{ 400: …, 200: … }` 迭代出来也是 200 在前），插入顺序对这类键无效。所以「成功 → 业务失败 → 通用失败」这种**自定义分组顺序做不到**——`409` 会落在 `404` 之后。好在「2xx → 4xx → 5xx」正好是 OpenAPI 工具链的默认预期，不做额外排序。

---

## 20.3 一个资源的完整样子（以 user 为例）

```ts
// ① src/database/schema/users.schema.ts
export const users = pgTable('users', { id: integer().primaryKey(), email: text().notNull(), ... });

// ② src/modules/user/dto/user.dto.ts
export const userPublicColumns = { id: users.id, email: users.email, ... } as const;   // 投影
export type UserScalars = Pick<Users, keyof typeof userPublicColumns>;                // 类型
export interface UserResponse extends UserScalars { roles: string[] }                  // 派生字段
export const userResponseSchema = z
  .object({
    id: z.number().int().describe('用户 ID'),
    email: z.string().describe('邮箱'),
    // …其余列同理，每行一个 .describe()
    roles: z.array(userRoleSchema).describe('角色码集合'),
  })
  .meta({ id: 'UserResponse' });                                                      // 文档

// ③ src/modules/user/user.service.ts
findOne(id: number): Promise<UserResponse> {                     // 返回 ② 的类型
  const [user] = await this.db.select(userPublicColumns)         // 投影直接来自 ②
    .from(users).where(...).limit(1);
  return this.withRoles(user);
}

// ④ src/modules/user/user.controller.ts
@RequirePermission('user:read')                                  // 访问意图 → 401/403
@ApiRoute({ summary: '按 ID 查用户', data: userResponseSchema })   // 描述 + 响应形状 → 文档
@Get(':id')
findOne(@ZodParam('id', idParamSchema) id: IdParam) {}           // 请求参数 → 校验 ＋ 文档
```

一条列定义喂三方：PG 的 DDL、TS 的类型、OpenAPI 的 schema。**这个链上不需要任何手写字段列表**。

---

## 20.4 新增一个接口的清单

1. 表里有新列 → 只改 ①，然后决定它进不进 `②` 的白名单（**默认不进**）
2. 响应是新的表行形状 → 手写 zod 字段 ＋ `.describe()`，加 `z.ZodType<表行投影>` 锚定
3. 响应是组合/计算值 → 手写 zod schema，类型用 `z.infer` 推，**不要另写 interface**
4. 请求参数 → 新写 `xxxBodySchema` / `xxxQuerySchema`，与响应无关
5. controller → `@ZodBody/@ZodQuery/@ZodParam` ＋ `@ApiRoute` ＋ 一个访问意图装饰器
6. `pnpm verify` 全绿，再打开 `/api-docs` 看一眼那个接口

---

## 20.5 为什么不合并成一个 `resource.ts`

一度考虑过「一个键列表同时生成投影、类型、文档」。不做，理由是：

- 白名单会从**列引用**退化成**字符串键**，失去「点进列定义」和「改列名立刻报错」
- 敏感列的排除从「显式没写」变成「隐式不在列表里」，安全边界变弱
- 请求 DTO 与响应 DTO 的字段集方向相反，硬合并要用 `.omit()` 链表达，比分开写更难读
- 新增字段、改校验、改返回三件事的**触发原因和负责人不同**，揉进一个文件只会让每次改动都碰同一处

真正要合并的是「同一事实的第二处声明」，不是「同一个资源的所有声明」。

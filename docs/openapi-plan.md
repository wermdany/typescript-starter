# Swagger / OpenAPI 接入 · 调研与方案（v1 · 待拍板）

> 目标工程：NestJS 12 + TypeScript 6 + 纯 ESM + zod v4 + drizzle。
> 本文只出调研结论与方案，不含实现代码。
>
> **前置说明**：`@nestjs/swagger` **尚未安装**（按 AGENTS.md §4，依赖安装由你本人执行），
> 因此下文所有"swagger 侧行为"来自包元数据与公开机制，凡是标 `【实测】` 的条目都是我在
> 本机跑出来的结论（zod 转换、类型对齐、脚本规则），其余为机制推断。

---

## 0. 结论速览

| 议题 | 结论 | 一句话理由 |
| --- | --- | --- |
| 技术路线 | **`@nestjs/swagger` 12 只当渲染器，路由/参数元数据沿用现有装饰器，schema 全部来自 zod** | 唯一不破坏「zod 是校验唯一源头」的走法 |
| 是否用 `nestjs-zod` | **不用** | peer 只到 Nest 11 / swagger 11，不支持 12；且它自带 pipe 与 `createZodDto`，等于在 `common/validation` 旁边再起一套 |
| class-validator | **不装、不引入** | `@nestjs/swagger@12.0.3` 的 `class-validator` / `class-transformer` 都是 `optional: true` 的 peer |
| 请求侧 schema | **零新增**：`@ZodBody` / `@ZodQuery` / `@ZodParam` / `@ZodParams` 内部顺手写文档元数据 | schema 与文档同源，物理上不可能漂移 |
| 响应侧 schema | **需要新增**（唯一代价）：在既有 `dto/*.dto.ts` 里补 `z.ZodType<T>` 锚定的 zod schema | 现有 `UserResponse` / `PageResponse<T>` 只有类型没有运行时形状 |
| 响应信封 | **文档层自动包裹** `{ success, message, data }` | 不做这件事，前端按文档生成的 client 会全错，是本方案第一大坑 |
| 安全模型 | `@Public()` → `security: []`；其余 → `bearer`；权限码写进 `x-permission` | 访问意图已经是 route metadata，翻译成 OpenAPI 是纯映射 |
| 开关 | 新增 `SWAGGER_ENABLED` / `SWAGGER_PATH` | 文档站绕过 `AccessGuard`，默认必须关在 prod 门外 |
| OpenAPI 版本 | **3.0**（`z.toJSONSchema({ target: 'openapi-3.0' })`） | 3.1 更"正确"，但客户端生成器对 3.0 支持更稳 |
| 预计改动面 | 新增 `src/common/openapi/`（5 文件）+ 改 3 个既有文件 + 补齐 4 个 controller 的响应声明 | 23 条路由 / 4 个 controller |

---

## 1. 现状盘点：为什么不能"装个包就完事"

`nest add @nestjs/swagger` 的默认体验建立在两个假设上，本项目两条都不成立：

| 默认假设 | 本项目实际 | 后果 |
| --- | --- | --- |
| DTO 是 class + `class-validator` 装饰器 | DTO 是 **zod schema + `z.infer` 类型** | 装饰器式 `@ApiProperty()` 无处可写；swagger 扫不到任何字段 |
| 返回值类型能被 `design:returntype` 反射到 | 返回 `Promise<UserResponse>`，泛型在运行时**擦除** | 即使开了 `emitDecoratorMetadata` 也拿不到响应形状 |
| 响应就是 handler 的返回值 | 出口被 `TransformInterceptor` / `HttpExceptionFilter` 重新塑形 | 文档若照抄返回值，与真实 wire format 不一致 |
| 路由靠 `@UseGuards()` 保护 | 全局 `AccessGuard` + fail-closed；文档站是 express 直挂路由 | 文档站**不受守卫保护**，是个默认公开的洞 |

技术事实（带证据）：

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | `@nestjs/swagger@12.0.3` 与 `@nestjs/core ^12`、`typescript ^6` 对齐，且**本身是纯 ESM**（`"type":"module"` + exports map） | `npm view` |
| 2 | `class-validator` / `class-transformer` 是**可选** peer | `peerDependenciesMeta` |
| 3 | zod 4.6.7 自带 `z.toJSONSchema`，支持 `target: 'openapi-3.0'`、`io: 'input' \| 'output'` | 【实测】 |
| 4 | `nestjs-zod@5.5.0` 的 peer 是 `@nestjs/common ^10 \|\| ^11`、`@nestjs/swagger ^7 \|\| ^8 \|\| ^11` | `npm view` → **Nest 12 直接不可用** |
| 5 | `.default()` 的字段在 `io:'input'` 下不进 `required` 且带 `default` —— 语义正确 | 【实测】 |
| 6 | `.refine()` 的约束**不会**出现在 JSON Schema 里（`roles` 的"不能重复"凭空消失） | 【实测】 |
| 7 | `z.email()` 会同时输出 `format: email` **和**一条 80 字符的 `pattern` | 【实测】 |
| 8 | `.meta({ id })` → 生成 `definitions` + `$ref: '#/definitions/X'`，需重写到 `components.schemas` | 【实测】 |
| 9 | `const s: z.ZodType<UserResponse> = z.object({...})` 能在**编译期**抓到类型不符 / 缺字段 | 【实测】tsc 报 TS2322，两种错都抓到 |
| 10 | `DatabaseService.onModuleInit()` 会 `SELECT 1`，连不上直接启动失败 | `src/database/database.service.ts:37` |
| 11 | 当前 23 条路由 / 4 个 controller（`user` / `auth` / `login-log` / `session`） | `grep` |
| 12 | 文件后缀规则是**黑名单**（`use-case` / `projection` / `handler` / `policy`），不是白名单 | `scripts/convention-audit.mjs:48` |

事实 9 是本方案的支点：它让"响应 schema"从"又一份需要人工同步的真相"变成"**被接口类型约束的编译期断言**"。

---

## 2. 候选方案对比

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| **A. 重写 DTO 为 class + `@ApiProperty`** | 让 swagger 走默认路径 | ❌ 等于把 zod 降级成"另一个校验器"，或双轨维护两套 DTO。否决 |
| **B. `nestjs-zod` 桥接** | `createZodDto()` 一步到位 | ❌ peer 不支持 Nest 12；且它强制自己的 `ZodValidationPipe`，与 `common/validation` 撞车 |
| **C. 手写 `openapi.yaml`** | 51 个 schema 手抄 | ❌ 必然漂移，且没有任何机器手段发现漂移。否决 |
| **D. swagger 当渲染器 + 自研 zod→JSON Schema 桥** | 路由/参数元数据抄现有装饰器，schema 直接来自 zod | ✅ **推荐**，见 §3 |

方案 D 的性质：`@nestjs/swagger` 只贡献 `DocumentBuilder`（拼 info/servers/security）、`SwaggerModule.createDocument`（把 Nest 的 route metadata 变成 paths）、`SwaggerModule.setup`（UI + json 端点）三件事；其余全部自己写，且只有 ~200 行。

---

## 3. 推荐方案

### 3.1 落点：`src/common/openapi/`

按 `common/` 现有的「按功能分包」规则新增第 7 个功能目录（身份/契约/校验/上下文/日志/幂等 → **文档**）。它**不进** `http-stages.ts`：文档是**启动期**装配，不是请求生命周期阶段。

```
src/common/openapi/
├── json-schema.ts          zod → OpenAPI schema：io 选择 + 清洗 + definitions 搬迁
├── document.ts             buildOpenApiDocument(app)：基础文档 + 后处理（信封/安全/错误集合）
├── setup.ts                setupOpenApi(app, env)：env 闸门 + SwaggerModule.setup
├── api-response.decorator.ts   @ApiData / @ApiDataList / @ApiNoData（响应声明）
└── __tests__/              json-schema.spec.ts（信封形状、$ref 重写）、document.spec.ts（每条路由都有声明）
```

`common/openapi` 允许依赖：`@nestjs/*`、`zod`、`common/auth`（读访问意图）、`common/api-response`（读信封类型）、`common/idempotency`（读 metadata 键）。
禁止依赖：`@/modules/*`、`@/database/*`、`@/logger/*` —— 与 `common` 现有不变式一致。反向依赖只有一处：`common/validation/param.decorator.ts` → `common/openapi`，同层、无环。

### 3.2 三个装配点（对既有文件的全部改动）

**① `common/validation/param.decorator.ts`** —— 4 个装饰器在返回 `Body()` / `Query()` / `Param()` 之后，追加一次文档元数据写入：

```ts
// 现在
export const ZodBody = (schema, options?) => Body(createZodValidationPipe(schema, options));
// 之后：同一个 schema 同时喂给校验与文档，两个消费者不可能漂移
export const ZodBody = (schema, options?) =>
  compose(Body(createZodValidationPipe(schema, options)), ApiRequestBody(schema));
```

这一条是整套方案的核心：**不需要在 23 个 handler 上各写一遍 `@ApiBody`**。

**② `server.ts`** —— 在 `registerRequestStages()` 之后、`listen()` 之前插一行 `setupOpenApi(app, env)`。
必须在 `createApp()` 里而不是 `main.ts` 里，才能被 `bootstrap.spec.ts` 用同一个 `APP` 断言 / 关闭。

**③ `config/env.ts` + `.env.example`** —— 新增两个变量（红线 #16 要求两边同步，`env-example-sync` 规则会红）：

| 变量 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `SWAGGER_ENABLED` | 布尔（**必须用 `envBoolean()`**，红线：不许 `z.coerce.boolean()`） | `true` 仅 dev / `false` 其他 | 开关 |
| `SWAGGER_PATH` | string | `api-docs` | JSON 在 `/<path>-json` |

### 3.3 响应侧：唯一需要新增的东西

现状：`UserResponse`（`modules/user/dto/user.dto.ts`）、`PageResponse<T>`（`shared/pagination`）、`MeResult`、`SessionWithCurrent` 都只有 TS 类型。

推荐做法——**在原 `dto/*.dto.ts` 文件里补一个 zod schema，用 `z.ZodType<T>` 锚定**（不新增文件种类，不新增后缀，不碰 `file-suffix` 规则）：

```ts
// modules/user/dto/user.dto.ts —— 与 userPublicColumns / UserResponse 同文件，同一屏能对账
export const userResponseSchema: z.ZodType<UserResponse> = z
  .object({
    id: z.number(),
    studentNo: z.string(),
    email: z.string(),
    nickname: z.string(),
    points: z.number(),
    createdAt: z.date(),
    updatedAt: z.date(),
    roles: z.array(userRoleSchema),
  })
  .meta({ id: 'UserResponse', description: '对外用户投影（不含 passwordHash / deletedAt）' });
```

- 接口仍是**唯一权威**：schema 写错类型或漏字段，`pnpm typecheck` 立刻红（事实 9 已实测）
- 分页用现成泛型助手：`pageOf(userResponseSchema)` → `.meta({ id: 'UserResponsePage' })`

代价要明说：**这是本方案唯一的"重复"**，每个响应形状要在 interface 与 zod 各写一遍。换来的是编译期强制对齐；如果觉得不值，退化成 §5 的 P1（只做请求侧，响应侧留 `object`）。

### 3.4 信封：最容易被漏掉的一环

文档必须描述**出口**而不是 handler 返回值。`document.ts` 的后处理统一做：

```
成功：{ success: true, message: string, data: <该路由声明的 schema> | null }
失败：{ success: false, message: string, data: null, errors?: [{ path, message }] }
```

- `@ApiData(schema)` → `data` 用该 schema；`@ApiNoData()` → `data: null`（对应 `changeMyPassword` 这类 `Promise<void>`）
- `message` 的示例值取 `@ApiMessage()`（已有装饰器）的文案，默认 `ok`
- **失败集合按路由收敛**，不搞"每个接口都列 400/401/403/500"：
  - 恒定：`401`（除 `@Public()`）、`500`
  - 有 body/query/param：`400`（带 `errors`，字段级）
  - `@RequirePermission` / `@OwnerOrPermission`：`403`
  - 有 `@Idempotent()`：`409`（同 key 指纹不符）
  - 有写库路径（`POST/PATCH/DELETE`）：`409`（PG 23505 经 `error-mapping.ts` 映射）
- `data` 恒为 `null` 时省略 `errors` 字段（与 `HttpExceptionFilter` 的实际产出保持一致）

建议 document 构建时**校验每条路由都声明了响应**，缺一条就抛错（fail-fast，与守卫 fail-closed 同风格）。这比事后 review 有效得多，也是后续能升级成 `pnpm api:audit` 的钩子。

### 3.5 安全模型映射

访问意图已经是 route metadata（`ACCESS_INTENT_KEY`），翻译是纯映射：

| 装饰器 | OpenAPI |
| --- | --- |
| `@Public()` | `security: []`（显式覆盖全局） |
| `@Authenticated()` | `security: [{ bearer: [] }]` |
| `@RequirePermission('user:read')` | 同上 + `x-permission: ['user:read']` |
| `@OwnerOrPermission('id','user:update')` | 同上 + `x-permission: ['user:update']` + `x-owner-param: 'id'`，并在 description 追加「本人或持权限码者」 |

`DocumentBuilder` 里注册两个 scheme：

```
bearer：JWT accessToken（Authorization: Bearer <token>）
cookie：refreshToken（HttpOnly，仅 /auth/refresh 使用）
```

`@Idempotent()` 的路由追加 header 参数 `Idempotency-Key`（可选），`@CurrentUser()` 修饰的参数**不产生**任何文档参数（否则会凭空多出一个 `user` query 参数）——这是别人接 swagger 时最常踩的一个坑。

### 3.6 落地顺序

| 阶段 | 内容 | 产出 | 验证 |
| --- | --- | --- | --- |
| **P0** | 装包 + `json-schema.ts` + `setup.ts` + env 开关；只生成 paths 与请求参数/请求体 | 能打开 `/api-docs`，请求侧完全正确，响应侧是裸 `object` | `pnpm typecheck` / `pnpm lint`（`env-example-sync`）→ 0；浏览器打开 UI；`curl /api-docs-json` 看 paths 数量 = 23 |
| **P1** | `@ApiData` 装饰器 + 信封后处理 + `dto/*.dto.ts` 补响应 schema（user 域 6 个 + auth 域 5 个） | 响应侧完整，可生成客户端 | 上述 + `curl` 抽查 200/400/401/403/409 的 schema 与实际 body 逐字段对齐 |
| **P2** | `undefined` 补齐剩下的响应 schema；`pnpm api:audit`（漏声明检测，复用 `scripts/lib/markers.mjs` 的静态读法） | 门禁脚本 | `pnpm api:audit` 退出码 0；故意删一个 `@ApiData` 应报红 |

不建议一步到位：P0 单独就能交付价值（前端至少能拿到路径与请求体），而 P1 的工作量与 `dto` 数量线性相关。

---

## 4. 已知坑清单（按踩到概率排序）

1. **信封没包** → 文档说 `{id, studentNo}`，实际回 `{success, message, data}`。前端 client 全错，且联调时会被误判成"后端没实现"。
2. **`.refine()` 静默丢失**（事实 6）→ 「角色不能重复」这类跨字段约束在文档里看不见。补法：`.meta({ description })` 写清楚，或在 `json-schema.ts` 里约定"有 refine 的字段必须带 describe"，靠 review 兜。
3. **`z.email()` 的 pattern 噪音**（事实 7）→ 文档膨胀且 Swagger UI 输入框会做正则校验。`json-schema.ts` 清洗时按 `format === 'email'` 删 `pattern`。
4. **`definitions` 不会自动进 `components.schemas`**（事实 8）→ 必须做 `#/definitions/` → `#/components/schemas/` 重写，否则 UI 里全是断链的 `$ref`。
5. **`io` 选错**：请求必须 `io:'input'`（`.default()` 字段非必填、带 `default`），响应用 `io:'output'`。混用会让"可选字段变必填"或反之。
6. **文档站绕过守卫**（事实 4 表格最后一行）→ 生产环境默认关闭；若要开，只在内网/网关后开。
7. **`bootstrap.spec.ts` 会被污染**：现有测试真实起应用，`setupOpenApi` 必须尊重 `SWAGGER_ENABLED`，且测试里保持关闭。
8. **`DatabaseService.onModuleInit` 会 `SELECT 1`**（事实 10）→ 想在 CI 里"无库生成 openapi.json"就得另建一个不含 `DatabaseModule` 的模块组合，成本不低。P0/P1 先只做运行时端点，CI 产物留到有真实需求再说。
9. **`@ZodParams(schema)` 多路径参数** → 一个 object schema 要展开成多个 `in: path` 参数（`session.controller.ts` 的 `revoke` 用了它），不能当成单个参数塞进去。
10. **`@Controller()` 空前缀** → `auth.controller.ts` 用 `@Controller()` 直接在方法上写全路径。`createDocument` 支持，但 tag 分组会退化成一个 `default` tag，需要在 `document.ts` 里手动按第一个路径段分组。
11. **`additionalProperties: false`**（`io:'output'` 会带）→ OpenAPI 3.0 里合法但会让部分生成器把模型变得过分严格，建议清洗掉。

---

## 5. 与你现有不变式的冲突检查

| 红线 / 约定 | 本方案 | 结论 |
| --- | --- | --- |
| #2 导入带 `.js` / 跨目录用 `@/` | 新文件在 `src/common/openapi/`，一律 `@/...` | 由 `convention-audit` 兜 |
| #3 文件后缀黑名单 | 不加新后缀，响应 schema 落在既有 `dto/*.dto.ts` | 不触发 |
| #4 对外字段用列白名单 | `userResponseSchema` 的字段必须与 `userPublicColumns` 对齐（少了 `passwordHash` / `deletedAt`） | 不触发，但需 review：这是**第二处**列清单 |
| #5 角色判定只走三个原语 | 无关；仅读 `ROLE_CODES` 生 schema | 不触发 |
| #6 配置整对象注入 | `setupOpenApi(app, env)` 收 `Env`，内部不碰 `ConfigService.get()` | 不触发 |
| #7 路径参数不用 `z.coerce.number()` | 现有 `params.dto.ts` 已是 regex + transform | 不触发 |
| #9 日志走 `Logger` | 文档装配只打一条启动日志 | 不触发 |
| #10 Controller 不手写响应 | 不改 controller 的响应方式，只加装饰器 | 不触发 |
| #11 每条路由声明访问意图 | 方案**依赖**这条：安全模型直接由它推导 | 协作，不冲突 |
| #16 `envSchema` ↔ `.env.example` | 新增 2 个变量必须两边同步 | 需执行 |
| `common/` 分层不变式 | `common/openapi` 不 import `@/modules/*` 等 | 需在 `http-stages.ts` 头注释的分层说明里补一行 |

---

## 6. 待你拍板的事

1. **文档可见性**：只在 dev 开（我倾向这个），还是内网也开？→ 影响 `SWAGGER_ENABLED` 的默认值与部署文档。
2. **响应侧的投入**：按 §3.3 补 zod 响应 schema（12 个，换完整文档 + 编译期对齐），还是先停在 P0（响应侧留 `object`）？
3. **要不要 `pnpm api:audit`**：多一个门禁脚本（与 `perm:audit` 同风格），能挡住"新增路由忘了声明响应"。
4. **UI 渲染器**：默认 Swagger UI（零额外依赖），还是换 Scalar / RapiDoc（更好看，多一个前端依赖）？
5. **是否要 CI 产物 `openapi.json`**：要就得解决 `DatabaseModule` 的启动探活（见坑 8）。

---

## 7. 不做的事（明确排除）

- 不引入 `class-validator` / `class-transformer`
- 不引入 `nestjs-zod`（Nest 12 不兼容）
- 不用 `@nestjs/swagger/plugin`（CLI 插件面向 class-validator DTO，本项目用不上）
- 不为了文档去改任何 handler 的返回值或错误抛出方式
- 不在 CI 里跑 `pnpm build` 生成文档（AGENTS.md §4 明确禁止日常 build）

---

> **读法**：§1–§7 是最初的方案推演，装饰器名称以 §8 为准 —— 最终落地的是 **`@ApiRoute`**（一个装饰器同时声明请求描述与响应形状），`@ApiDocs` / `@ApiData` / `@ApiNoData` 没有保留。

## 8. 落地结果（已实现）

> 本节记录最终实现，与上文方案一致；差异处已标明。

### 8.1 文件

| 文件 | 作用 |
| --- | --- |
| `src/common/openapi/json-schema.ts` | `toOpenApiSchema()`：zod → OpenAPI schema 唯一入口（`io` 选择 + 三处清洗 + `definitions` 登记 + `$ref` 重写） |
| `src/common/openapi/envelope.ts` | 成功 / 失败信封的文档描述 |
| `src/common/openapi/parameter-doc.ts` | body / query / path 的文档，只被 `param.decorator.ts` 调用 |
| `src/common/openapi/route.decorator.ts` | `@ApiRoute`：请求描述 + 响应形状，状态码由 `@HttpCode` / HTTP 方法推导 |
| `src/common/openapi/response.decorator.ts` | 失败侧：`@ApiFailure` / `@ApiCommonError` |
| `src/common/openapi/errors.ts` | 公共错误（401/403/404/500）的文案与形状，唯一出处 |
| `src/common/openapi/validate.ts` | 文档完备性校验：缺描述 / 空 schema / 断链 → 抛错 |
| `src/common/openapi/document.ts` | `buildOpenApiDocument()`：`paths` + 合并 `components.schemas` |
| `src/common/openapi/setup.ts` | `setupOpenApi()`：env 闸门 + UI / JSON 端点 |
| `src/shared/validation/date.ts` | `dateSchema`：`z.date()` 的文档形态（见 8.6 的第 1 条） |

改动既有文件的**全部 6 处**：
`common/validation/param.decorator.ts`（顺带写文档）、`common/auth/access.decorator.ts`（带出 bearer + 401/403）、
`common/idempotency/idempotency.decorator.ts`（带出 `Idempotency-Key` + 409）、
`server.ts`（调 `setupOpenApi`）、`config/env.ts` + `.env.example`（两个开关）、
`shared/pagination/pagination.schema.ts`（`pageOf()`）、4 个 controller 的 `@ApiTags` 与响应声明。

### 8.2 三条使用规则

1. **请求参数不用写文档**：`@ZodBody` / `@ZodQuery` / `@ZodParam` / `@ZodParams` 已经把 schema 交给文档，400 / 404 也自动带上。
2. **响应只写一行**：`@ApiRoute({ summary, description, data })`。信封、状态码、`data: null`、示例、401/403/500 都自动处理；成功文案另由 `@ApiMessage()` 声明。
3. **响应 schema 分两种情况**，不是一律手写：
   - **形状 = 某组数据库列**（`UserResponse` / `SessionWithCurrent` / `LoginLogResponse`）→
     手写 zod 字段并把 `.describe()` 写在字段上，用 `z.ZodType<表行投影>` 锚定。
     字段集合与类型仍来自列白名单（`Pick<表行, keyof 白名单>`），锚定保证漏写 / 类型错编译期报错。
   - **形状不是表行**（`MeResult` 的嵌套、`LoginResponse` 的组合、`RevokeAllResult` 这类计算值）→
     手写，并用 `const s: z.ZodType<既有 interface>` 锚定，字段写错或漏写 `pnpm typecheck` 直接红。
   - 两种情况都只补"派生不出来的信息"：枚举取值、业务语义、派生字段本身。

### 8.3 开关

`SWAGGER_ENABLED`（默认 `false`，`NODE_ENV=development` 时自动开启）+ `SWAGGER_PATH`（默认 `api-docs`）。
UI 在 `/api-docs`，JSON 在 `/api-docs/json`。

### 8.4 实测结论（本地起应用跑过）

- 20 个 path / 23 个 operation（`/users` 与 `/users/{id}` 各有多个方法），与 `pnpm perm:audit` 的 23 条路由对齐
- `@RequirePermission` 路由：`security: [{ bearer: [] }]` + `200 / 400 / 401 / 403`
- `@Public()` 路由（`/auth/login`、`/auth/refresh`、`/users/health`）：**没有** `security`，也没有 401/403
- `@Idempotent()` 路由：多出 `Idempotency-Key` 请求头参数与 `409`
- 请求体：`required` 正确排除带 `.default()` 的字段；`z.email()` 只留 `format`，无 `pattern` 噪音
- query：object schema 逐字段展开，`enum` 值带出（`role` / `sortBy` / `order`）
- `components.schemas` 自动登记 11 个命名模型（`UserResponse` / `UserResponsePage` / `LoginResponse` / `MeResult` / `SessionWithCurrent` / `SessionWithCurrentPage` / `LoginLogResponse` / `LoginLogResponsePage` / `RevokeAllResult` / `RevokedCount` / `HealthStatus`）

### 8.5 已知未做

- **`pnpm api:audit`**（"新路由忘了声明响应"的门禁）：目前靠 review。做法是复用
  `scripts/lib/markers.mjs` 的静态读法，检查每个 handler 是否有 `@ApiRoute`。
- **CI 产物 `openapi.json`**：`DatabaseService.onModuleInit` 会 `SELECT 1`，无库环境起不来，
  要做得另建一个不含 `DatabaseModule` 的模块组合（见坑 8）。
- **429**（登录限流）没有文档化：限流是 service 内逻辑，装饰器层面不知道，需要时手工加。

### 8.6 实现期踩到的两个静默失效（都已修）

1. **`z.date()` 在 JSON Schema 里输出 `{}`** —— 不报错，但 OpenAPI 里那一列变成空 schema，
   客户端拿到 `any`。修法：统一用 `shared/validation/date.ts` 的 `dateSchema`
   （`z.date().meta({ type:'string', format:'date-time' })`）。不用 `z.iso.datetime()` 是因为它会
   附带一条匹配闰年的超长正则，和 `z.email()` 同款噪音。**这类错误只有把文档导出来看才会发现**，
   typecheck / lint / 审计全都不响。
2. **没人引用的 schema 不会进 `components`** —— 声明了但没被任何 `@ApiRoute` 用到的 schema
   会安静消失，形成"以为文档里有、其实没有"的假象。原先的 `sessionResponseSchema` 就是这样
   （已删）。这正是 `pnpm api:audit` 要挡的洞。
3. **命名定义内部的 `$ref` 不会被自动重写** —— `XxxPage.items → Xxx` 这类嵌套引用会留下
   `#/definitions/...` 的断链，UI 上只表现为"这个模型展开不了"，不报错。修法：定义与根节点
   走同一条 `sanitize → rewriteRef` 链（`json-schema.ts`）。**验收方式**：导出整份文档，
   收集所有 `$ref`，逐个检查是否落在 `components.schemas` 里。

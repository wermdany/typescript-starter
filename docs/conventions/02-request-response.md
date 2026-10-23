# 响应契约、请求校验与分页排序

> 本文件是 AGENTS.md 第 §5、§6、§7 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 动 controller、DTO、响应字段时读这一份。

---

## 5. 响应契约

所有 HTTP 响应都经过全局拦截器/过滤器，形态统一，类型见 `src/common/api-response/api-response.ts`（常用件从 `@/shared/common.js` 取）。

**成功**（`TransformInterceptor` 包装）：

```json
{ "success": true, "message": "创建成功", "data": { "id": 1, "nickname": "小明" } }
```

- `message` 恒有值：默认 `DEFAULT_SUCCESS_MESSAGE`（`'ok'`），`@ApiMessage('创建成功')` 覆盖
- 无返回值的操作（如修改密码）`data` 为 `null`，**不要改成 204**：判别字段在 body 里
- 健康检查、文件下载等特殊端点用 `@SkipTransform()` 跳过包装

**失败**（`HttpExceptionFilter` 转换）：

```json
{ "success": false, "message": "参数校验失败", "data": null,
  "errors": [{ "path": "email", "message": "无效的电子邮件地址" }] }
```

- **参数校验失败（400）**：`message` 默认 `DEFAULT_VALIDATION_MESSAGE`（「参数校验失败」），
  可用 `@ZodBody(schema, { message: '…' })` 覆盖；`errors` 由 zod `issues` 映射而来，
  路径用点号（`address.city`），根级为空串
- **业务失败（401/404/409 等）**：`message` 为自描述短原因（如「用户不存在」「学号已存在」），无 `errors`
- **未知异常（500）**：`message` 固定「服务器内部错误」，堆栈只写服务端日志
- 新增错误场景抛 `HttpException` 子类（`NotFoundException` / `ConflictException` …），
  不要在 Controller 里手写响应对象

两条不变量：

1. **`success === (HTTP 状态码为 2xx)`**，不允许出现 `200` + `success: false`。
   过滤器是唯一失败出口；新增响应路径（自定义 filter、直接操作 `res`、中间件短路）时必须守住
2. **`message` 是给人看的文案，不是机器判据**。客户端分支只能靠 `success` / HTTP 状态码 /
   `errors[].path`；服务端只输出中文，不做 i18n。改文案不算契约变更，改 `success` 语义/字段名算

### `data` 字段：列级白名单

`data` 里的字段由 `dto/<domain>.dto.ts` 的列白名单决定，它同时是 SQL 投影和响应类型：

```ts
export const userPublicColumns = {
  id: users.id,
  studentNo: users.studentNo,
  // …
} as const;

export type UserResponse = Pick<Users, keyof typeof userPublicColumns>;
```

```ts
this.db.select(userPublicColumns).from(users).where(...)          // → UserResponse[]
this.db.insert(users).values(...).returning(userPublicColumns)    // → UserResponse[]
this.db.update(users).set(...).returning(userPublicColumns)       // → UserResponse[]
```

- **不要用 `Omit<Users, 'passwordHash'>` 黑名单**：新增列会默认泄露且编译期不报错
- **不写"把数据库行改造成响应"的映射函数**：白名单在 SQL 层生效，类型由列对象直接推导
- **例外 —— 派生字段可以合成**：`roles` 来自 `user_roles` 关联表，进不了 `RETURNING`
  （PostgreSQL 不允许子查询），只能由 service 批量补齐后合成，即 `toUserResponse(scalars, roles)`。
  判据是"这个字段能不能进 SQL 投影"：能进就走白名单，不能进才允许合成函数，
  且响应的类型形态要如实表达（`UserScalars` + `UserResponse extends UserScalars { roles }`，
  不是一个 `Pick` 走天下）
- 需要敏感列（如登录校验用的 `passwordHash`）时另行显式 select；
  单个接口要额外字段就另建投影（`{ ...userPublicColumns, deletedAt: users.deletedAt }`）
- `deletedAt` 刻意不对外：所有读路径都带 `isNull(deletedAt)`，未删用户返回的它恒为 `null`
- `<domain>/__tests__/<domain>-dto.spec.ts` 把键集合冻结成断言，加列会让测试失败

---

---

## 6. 请求校验

zod 管道按参数显式注册（不存在全局 ValidationPipe），调用点统一用
`@/common/validation/param.decorator.js` 的组合装饰器：

```ts
create(@ZodBody(createUserSchema) dto: CreateUserDto) {}
findOne(@ZodParam('id', idParamSchema) id: IdParam) {}
findAll(@ZodQuery(queryUsersSchema) query: QueryUsersDto) {}
revoke(@ZodParams(userSessionParamsSchema) params: UserSessionParams) {}
```

四个装饰器只是 `@Body()` / `@Query()` / `@Param()` + `new ZodValidationPipe(schema)` 的组合
（校验逻辑仍只有管道一份），好处是调用点不再散落 `new ZodValidationPipe(`，
静态 grep 就能数出"有多少个参数被校验"。**不要在 controller 里直接 new 管道。**

### body：严格，不做空值宽恕

JSON body 原样进 schema（只去掉文本字段首尾空白）：

| 前端想表达 | 正确写法 | 会 400 的写法 |
| --- | --- | --- |
| 不提供该字段 | 省略 key | `"keyword": ""`、`"keyword": null` |
| 提供空字符串 | 文本字段不接受空值 | `""` / 纯空白（`min(1)` 拒绝） |

依据 RFC 7396：JSON 里 `null` 是显式语义，`""` 是长度为 0 的真实值，只有键缺席才等于"没有值"。
**不要**在 `preprocess` / `transform` 里把 body 空值转 `undefined`。

### query：唯一宽容通道

`ZodValidationPipe` 读 `metadata.type`，**仅当 `type === 'query'`** 时把空值归一化为「未提供」：

- `''` 与纯空白 → `undefined`（optional 字段跳过，有默认值的回落默认值）
- URL 的值是字符串装配的产物，`?keyword=` 是传输层假象而非调用方意图
- 仅递归普通对象，数组元素不动
- 调用点零改动：`@ZodQuery(...)` 自动宽容，`@ZodBody(...)` / `@ZodParam(...)` 自动严格

### 首尾空白

- 多字段 DTO 一律 `z.object(trimmedShape({...}))`，每个顶层字段自动 `trimmed`，无例外（`password` 也 trim）
- `trimmed()` 只 trim、不产出 `undefined`：trim 后为空就是空串，交给字段自身约束判定
- 不要写 `z.string().min(8).max(128).trim()`：zod 的 check 按链式顺序执行，
  `'        '` 会先过 `min(8)` 再被 trim 成空串
- 只处理顶层字段；嵌套对象在其定义处自行 `z.object(trimmedShape({...}))`

### 路径参数

路径参数是顶层字符串，query 归一化与 shape 包装都覆盖不到，两个方向都要显式处理
（见 `dto/params.dto.ts`）：

- 文本类 `:studentNo` → `trimmed(studentNoSchema)`
- 数字类 `:id` → `trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`；
  **不要**用 `z.coerce.number()`（`Number('') === 0` 会把空值误报成 `Too small`，
  且 `'0x10'` / `'1e0'` 会被当成合法数字）

其他规则：

- HTTP query 天然是字符串，数字字段用 `z.coerce.number()`
- 路径参数 schema 复用（`idParamSchema` 供全部 `:id` 路由使用）
- 更新类 DTO 用 `.refine()` 保证至少提供一个字段
- **路径参数放在 URL 末尾**：路由形如 `password/:id`、`restore/:id`，不要写 `:id/password`——
  参数后面的静态段容易与子资源路径混淆，也不好按前缀做日志/网关规则
- **静态段路由必须声明在 `:id` 之前**（如 `@Get('by-student-no/:studentNo')` 放在 `@Get(':id')` 前）；
  参数收在末尾后，同前缀的静态路由排序依然要守住这条

---

---

## 7. 分页与排序

- 列表 query DTO 用 `paginationSchema.extend(trimmedShape({...}))`（`page` 默认 1，`pageSize` 默认 10、上限 100）
- 查询走 `paginate()` 回调式助手，返回 `PageResponse<T>`（`items/total/page/pageSize/totalPages`）：

```ts
const result = await paginate(
  (limit, offset) => ({
    rows: this.db.select(userPublicColumns).from(users).where(where).orderBy(orderBy).limit(limit).offset(offset),
    total: this.db.select({ value: count() }).from(users).where(where).then((r) => r[0]?.value ?? 0),
  }),
  query.page,
  query.pageSize,
);
```

- 助手只负责分页数学与并发编排，ORM 查询仍显式构建
- 模糊搜索必须转义 LIKE 通配符（`user.service.ts` 的 `escapeLike()`）

**默认排序：所有列表接口一律 `updatedAt` 降序。**

- query DTO 默认 `sortBy: 'updatedAt'`、`order: 'desc'`
- `sortBy` 枚举白名单必须包含 `updatedAt`
- 排序字段映射表用对象字面量按 `query.sortBy` 索引，枚举缺项时 TS 在索引处报错；
  再按 `query.order === 'desc' ? desc(col) : asc(col)` 应用

---

# typescript-starter 项目记忆

## 项目约定
- NestJS 12 + 纯 ESM（`type: module`，导入需 `.js` 后缀），pnpm，Vitest 4，oxlint
- 2026-10-14 引入 `@nestjs/config` + `zod` 管理 env：
  - 所有环境变量集中在 `src/config/env.ts` 的 zod schema 中声明（注意文件名是 env.ts 不是 env.validation.ts），ConfigModule `validate` 钩子启动时 fail-fast 校验
  - 业务代码取配置用 `ConfigService<Env, true>` + `get('KEY', { infer: true })`，禁止直接 `process.env`
  - 新增 env 变量必须同步更新 schema（用户自管 `.env` 文件，`.env.example` 已被用户删除，不再维护）
  - 本地覆盖用 `.env.local`（gitignore），敏感配置由部署平台注入
## 业务模块约定（2026-10-15 起，User 模块为首个范式）
- 目录：业务模块放 `src/modules/<domain>/`（module/controller/service/mapper/dto），通用件放 `src/common/`
- 响应契约：全局统一 `{ code, message, data }`——成功 `code:0`（`@ApiMessage` 可覆盖 message）；失败 `{ code: httpStatus, message: 简短原因, data: null }`，**参数校验失败额外带 `errors: [{path, message}]`**（zod issues 映射而非透传）；`@SkipTransform()` 可跳过包装；契约类型在 `src/common/response/api-response.ts`
- 请求校验：zod v4 + `ZodValidationPipe` **按参数注册**（`@Body(new ZodValidationPipe(schema))`），不用 class-validator
- 入参归一化（管道层统一）：query/body 中的 `''` 与显式 `null` **一律视为"未提供"**（→ undefined）；数组元素不动；递归只作用于普通对象。领域 schema 保持严格，不为单个 DTO 加空值包装
- **首尾空白规范化（DTO schema 层，2026-10-15）**：`src/common/validation/trimmed.ts` 导出两个工具
  - `trimmedShape({...})` 是**默认写法**：`z.object(trimmedShape({...}))` / `paginationSchema.extend(trimmedShape({...}))`，自动给每个顶层字段包 trim（非字符串字段透传无副作用），**trim 后为空即视为"未提供"**
  - 需要保留空白的字段（仅 `password`）在字段上写 `.meta({ keepWhitespace: true })` 就近声明例外
  - `trimmed(schema)` 仅用于顶层非 shape 场景（如 `:studentNo` 路径参数——管道层只递归对象，path 参数需自行包）
  - 只处理顶层字段，嵌套对象需在其定义处自行包一层；`.optional()/.default()` 写在内层
- **数字路径参数（`:id`，2026-10-15 约定）**：`trimmed(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()))`，全部 `:id` 路由复用它。**不要用 `z.coerce.number()`**——`Number('') === 0` 会把空白值误报成 `Too small: expected number to be >0`（套 trimmed 后是「received undefined」= 未提供），且 `Number()` 会把 `'0x10'` 当 16、`'1e0'` 当 1。数字 ID 由 DB 生成、不接受客户端指定，故不额外约束业务范围（int4 上限不处理）
- 分页：列表 DTO 用 `paginationSchema.extend(...)`，查询走 `paginate()` 回调式助手，返回 `PageResponse<T>`
- **列表默认排序一律 `updatedAt` 降序**（AGENTS.md 第 7 节，user 模块已对齐）：DTO `sortBy` 默认 `'updatedAt'` + 枚举含该项，Service `sortColumn` 映射表必须同步补项（漏项 TS 会报错，新增排序字段时靠它兜底）
- 密码：用 Node 内置 `node:crypto` scrypt（用户明确拒绝 bcrypt），格式 `scrypt$N$r$p$saltHex$hashHex`；工具在 `src/common/crypto/password.scrypt.ts`
- Drizzle 注意：`updatedAt` 不会自动更新，update/restore 必须手动 set；**pg 错误被 drizzle 包装为 DrizzleQueryError，需从 `err.cause` 解包再判断 23505**
- 拦截器顺序：RequestLoggingInterceptor 必须排在 TransformInterceptor 前面（保持最外层，统计完整耗时）

## 数据库迁移与种子数据（2026-10-15 起）
- 库走 **drizzle-kit 迁移流程**（`drizzle.__drizzle_migrations` 有记录），非 `db:push`
- 种子/自定义 DDL 一律用**自定义迁移**：`pnpm db:generate --custom --name=xxx` → 写 SQL 到 `drizzle/000N_xxx.sql` → `pnpm db:migrate`
- 写种子数据的既有范式见 `drizzle/0001_seed_users.sql`：单条 `INSERT ... SELECT generate_series` + CTE 分层（PG 不允许在同一 SELECT 列表引用输出别名，故必须逐层 CTE）、`setseed()` 固定分布、中文/拼音并行数组保证姓名与邮箱一致、`ON CONFLICT DO NOTHING` 保证幂等
- 迁移文件可直接用 psql 在 `BEGIN ... ROLLBACK` 里试跑（`--> statement-breakpoint` 本身就是合法 SQL 注释）
- ⚠️ **identity 序列不参与事务回滚**：反复试跑会烧掉序列值，导致 id 不从 1 开始

## 预置问题
- 旧的 e2e（`GET /` 期望 Hello World）已删除；`src/modules/user/user.e2e-spec.ts` 尚待编写（断言按响应契约 v2 写）
- 每次启动开发服务器，nest 的 deleteOutDir 删除 dist 会触发 safe-delete 保护（>50 文件需用户确认后单独 rm）
- **本环境无法用 `run_in_background` 启动应用**（进程存活但从不 listen，无任何输出）；可靠做法是在**前台**脚本里 `spawn('node', ['dist/main.js'])`，等就绪后跑 fetch 断言再 kill。另：`pnpm exec tsc -p tsconfig.build.json` 可增量编译，绕开 `nest build` 的删 dist 保护

# 代码风格与 scripts/ 目录约定

> 本文件是 AGENTS.md 第 §11、§19 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 写新代码、新增 npm script 或扫描脚本时读这一份。

---

## 11. 代码风格

- 纯 ESM：**所有导入都必须带 `.js` 后缀**（含别名 `@/…js`）
- **跨目录一律用别名** `@/` → `src/`（如 `@/shared/common.js`、`@/database/database.service.js`），
  不写 `../../`；同目录/同级子目录用相对路径（`./dto/x.dto.js`、`../x.js`）
- **常用件走 barrel**：`@/shared/common.js`（装饰器、响应类型、分页、哈希）、
  `@/shared/validation.js`（trimmed/trimmedShape、passwordSchema、paginationSchema）；
  不要在业务代码里直接引 `@/shared/validation/trimmed.js` 这类内部路径
- 新增工具落到 `src/shared/<用途>/`，若会被多数业务文件使用，就同时在对应 barrel 里导出
- Prettier：单引号、`trailingComma: all`、2 空格缩进（`pnpm format`）
- oxlint：`@typescript-eslint/no-explicit-any` 关闭、`no-floating-promises` 为 warn（新增 async 调用要 await）
- **注释写中文，只写必要信息**：说明职责、约束与"为什么这样写"的关键取舍；
  不写代码已能表达的"是什么"，不写改动历史/旧实现对比
- 文件或类用 `/** ... */` 说明职责；复杂函数或需要示范的场景用 JSDoc `@example`
- `strict: true`，避免 `any` 与类型断言；对外类型优先用 `z.infer` / `$inferSelect` / `Pick` 派生

---

---

## 19. `scripts/` 目录约定

脚本是运维与 CI 的一等公民，但**不引入新依赖、缺数据库也能跑**是底线。

- **零新增第三方依赖**：只用 devDependencies 的 `typescript`（AST 解析）与 dependencies 的
  `pg` + `dotenv`；真要新包，先问用户（第 3 节）
- 文件名 kebab-case + `.mjs`（Node ESM 直接跑，无编译步骤）；辅助模块放 `scripts/lib/`
- **单一职责 + 可独立运行**：`pnpm <script>` 一条命令跑完，不依赖测试框架、不绑 `pnpm test`
- **必须支持 `--json`**（供 CI 解析）与**有意义的退出码**：`0` 成功 / `1` 校验失败（发现了问题）/
  `2` 环境或参数错误（脚本自身跑不起来）
- **判定逻辑只写一处**：`scripts/lib/markers.mjs` 的 `analyzeRouteMarkers()` 是单一出口，
  `perm:audit` / `perm:sync` 复用它，禁止各写一套 —— 否则会出现
  "脚本说通过、线上是另一回事"的假安全感
- **纯只读路径必须能在无数据库环境跑通**（如 `perm:audit` 纯 AST、`perm:sync --dry-run`），供 CI 使用；
  需要连库的脚本从 `.env` 读 `DATABASE_URL`，不要把连接串写进脚本
- 脚本生成的文档一律**不要手改**，用 `--check` 与 git 版本比对做漂移校验
  （当前没有生成型脚本；将来若加回权限矩阵生成，产物命名与漂移校验按本节同一规矩）
- 已知识别边界写在脚本头注释，并与 `docs/rbac-plan.md` §5.5 对齐（**那里是唯一权威来源**，新增边界先改文档再改注释）

# typescript-starter 项目记忆

## 项目约定
- NestJS 12 + 纯 ESM（`type: module`，导入需 `.js` 后缀），pnpm，Vitest 4，oxlint
- 2026-10-14 引入 `@nestjs/config` + `zod` 管理 env：
  - 所有环境变量集中在 `src/config/env.validation.ts` 的 zod schema 中声明，ConfigModule `validate` 钩子启动时 fail-fast 校验
  - 业务代码取配置用 `ConfigService<Env, true>` + `get('KEY', { infer: true })`，禁止直接 `process.env`
  - 新增 env 变量必须同步更新 schema（用户自管 `.env` 文件，`.env.example` 已被用户删除，不再维护）
  - 本地覆盖用 `.env.local`（gitignore），敏感配置由部署平台注入
- 预置问题：e2e 测试（`GET /` 期望 Hello World）因 AppModule 无 controller 而 404 失败，属 starter 空白起点遗留，与 env 改动无关

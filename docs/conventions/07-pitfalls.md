# 已知坑与反直觉行为

> 本文件是 AGENTS.md 第 §13 节的完整内容，原文拆分而来，不在 AGENTS.md 里重复。
> 遇到"明明没错却不对"的现象时先搜这一份。

---

## 13. 已知坑

- **`nest build` / `pnpm build` 会杀掉 watch 进程**：根因是 `deleteOutDir`（见第 0 节，现已改为 `false`，
  此坑大幅缓解但仍可能残留 ⇒ 构建产物不一定是当次代码的完整镜像）——改代码前仍建议确认没有正在跑的
  `start:dev`，或改用 `tsc --noEmit` 做类型检查
- **已不再是坑（2026-10-21 起）**：`deleteOutDir: true` 触发的 safe-delete 卡死与端口抢占，已通过将
  `nest-cli.json` 改为 `false` 解决
- **drizzle 包装 pg 错误**：判断 `23505` 必须先读 `err.cause`
- **`timestamps()` 是函数**：写成共享对象常量会导致多表列名错乱
- **`updatedAt` 不自动更新**：所有 update 手动 set
- **路由顺序**：`by-student-no/:studentNo` 必须在 `:id` 之前（路径参数放 URL 末尾，见第 6 节）
- **路径参数不要用 `z.coerce.number()`**：`Number('') === 0` → 见第 6 节
- **空值宽容只发生在 query**：body 里的 `""` / 纯空白 / `null` 一律如实校验；
  发现 body 空串"被静默忽略"，说明有人加回了空值包装
- **`trimmed` 不产出 `undefined`**：trim 后为空就是空串，由字段自身约束判定
- **`ZodValidationPipe` 的宽容靠 `metadata.type === 'query'`**：单测里直调
  `pipe.transform(value)` 走严格分支，要宽容须显式传 `{ type: 'query' }`
- **日志不落盘先查 `LOG_FILE`**：filePath 为空时 `FileLogger` 不建文件通道
- **`bufferLogs: true` 无效**：`init()` 末尾会先 flush；logger 必须注入 `NestFactory.create`
- **`z.coerce.boolean()` 会把 `'false'` 判成 `true`** → 用 `envBoolean()`（第 4 节）
- **zod v4 的 transform 里 `throw` 不被 `safeParse` 接住** → 用 `z.enum` 报 issue
- **body parser 早于 `NestModule.configure()`**：trace/access 中间件要覆盖
  malformed JSON / 无路由 404，必须在 `createApp()`（`server.ts`）里 `app.use()` 即时挂载；
  放进某个 Module 的 `configure()` 会排在 jsonParser 之后（实测层序），
  malformed JSON 的 400 就没有 traceId —— 不要尝试把请求中间件搬进模块
- **`source-map-support` 不再使用**：改用 Node 原生 `--enable-source-maps`，不要 import 它
- **异常日志用单个字符串**：第二个字符串参数会被当成 context
- **排查 500 先看 `caused by:`**：只有外层 `Failed query: ...` 说明根因没展开
- **多行 message 会劈开日志行**：单行日志必须过 `toSingleLine()`
- **pg `Pool` 没有 `error` 监听器会杀掉进程** → 见第 8 节
- **access 日志在中间件层**：删掉 `app.use(accessLogMiddleware)` 会让所有访问行无声消失
- **收尾回调里必须 `runWithTraceId` 恢复上下文**：客户端中断时 `close` 由 socket 触发，
  上下文已丢失，不恢复会丢 traceId
- **access 行耗时**从中间件入口算到响应收尾，含 body 解析 / 守卫 / 校验 / 序列化
- **`success` 与 HTTP 状态码必须同向**；无返回值接口不要改成 204；`message` 不是机器判据
- **没有 `code` 字段**：判别字段是 `success`
- **HTTP 全链路测试**在 `src/__tests__/bootstrap.spec.ts`：mock 了 `DatabaseService`，不能用来验证 SQL；
  验证真实查询要去已运行的服务上 curl。`pnpm test:e2e` 目前没有独立用例

---

import { Module } from '@nestjs/common';

import {
  HTTP_STAGE_DEPENDENCIES,
  HTTP_STAGE_PROVIDERS,
} from '@/common/http-stages.js';

/**
 * HTTP 阶段收口模块：**全局守卫 / 拦截器 / 过滤器的唯一注册处**。
 *
 * `app.module.ts` 只 import 本模块 —— "系统级横切能力"因此只有一个入口
 * （`common/http-stages.ts` 是清单，本模块是注册）。
 *
 * 为什么 `providers` 只有两行：注册项与依赖项分开维护（见 `http-stages.ts` 的
 * `HTTP_STAGE_PROVIDERS` / `HTTP_STAGE_DEPENDENCIES`），这样读清单时不会把
 * "业务 provider"误当成全局注册。
 *
 * P1 请求中间件**不在这里**：它们只能由 `registerRequestStages()` 用 `app.use()`
 * 即时挂载（原因见 `http-stages.ts` 头注释）。
 */
@Module({
  providers: [...HTTP_STAGE_PROVIDERS, ...HTTP_STAGE_DEPENDENCIES],
})
export class HttpStagesModule {}

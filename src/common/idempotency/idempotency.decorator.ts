import { SetMetadata } from '@nestjs/common';

/**
 * `IdempotencyInterceptor` 读取该 metadata 判断路由是否参与幂等。
 *
 * 与 `Idempotency-Key` 请求头是**双条件**：任一缺失就不拦截（见拦截器注释）。
 */
export const IDEMPOTENT_KEY = 'platform:idempotent';

/**
 * 声明这条路由支持 `Idempotency-Key` 重放。
 *
 * 只该加在**非幂等的写接口**上（创建 / 恢复 / 支付 / 提交订单这类"重复执行有副作用"
 * 的路由）。GET / PUT / DELETE 本身幂等，加标记只是多一次内存查找。
 *
 * 不要加在**响应含凭据**的接口上（`/auth/login`、`/auth/refresh`）：
 * 快照只存 `{ status, body }`，不含 `Set-Cookie`；重放会返回一个"没有 Cookie 的登录成功"，
 * 客户端拿到 accessToken 却续不了期 —— 比报错更难查。
 *
 * @example
 * @Idempotent()
 * @Post()
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

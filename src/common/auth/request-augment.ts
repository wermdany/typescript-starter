import type { AuthenticatedUser } from './auth.contract.js';

/**
 * 给 Express 的 `Request` 增补 `user` 字段（认证中间件写入、守卫与 `@CurrentUser()` 读取）。
 *
 * 用全局 `declare global` + `namespace Express`：`@types/express-serve-static-core` 用
 * interface merging 开放了这个命名空间，增补后所有 `Request` 自动带上该字段，
 * 业务代码无需 import 本文件。运行时无副作用，但必须被编译进产物才会生效。
 */
declare global {
  namespace Express {
    interface Request {
      /** 会话校验通过后注入；匿名请求为 `undefined` */
      user?: AuthenticatedUser;
    }
  }
}

// 有 import type 即已是模块，无需额外 export {}

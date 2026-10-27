import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';

/**
 * 续期请求体。
 *
 * **Cookie 模式下前端不发这个 body**（RT 在 HttpOnly Cookie 里自动携带）；
 * body 分支保留给非浏览器客户端。两端都没有时由 controller 统一 401「缺少 refreshToken」。
 *
 * refreshToken 是不透明字符串（43 字符 base64url），这里只校验长度上限 ——
 * 格式细节由服务端查库判定，schema 不做"看起来像不像 token"的猜测。
 */
export const refreshSchema = z.object(
  trimmedShape({
    refreshToken: z
      .string()
      .max(512)
      .optional()
      .describe(
        '不透明字符串（43 字符 base64url）。Cookie 模式下不需要传，由 HttpOnly Cookie 自动携带',
      ),
  }),
);

export type RefreshDto = z.infer<typeof refreshSchema>;

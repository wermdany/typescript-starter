import { z } from 'zod';

import { trimmedShape } from '@/shared/validation.js';

/**
 * 退出全部设备的可选参数。
 *
 * - `keepCurrent` 默认 `false`：默认连当前设备一起踢（"退出所有设备"的直觉语义）
 * - 传 `true` 表示保留本机，只踢其它设备
 *
 * 放在请求体里而不是 query：这是一个有副作用的指令，语义应显式表达。
 */
export const revokeAllSchema = z.object(
  trimmedShape({
    keepCurrent: z.boolean().default(false),
  }),
);

export type RevokeAllDto = z.infer<typeof revokeAllSchema>;

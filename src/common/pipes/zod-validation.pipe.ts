import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

import type { FieldError } from '../response/api-response.js';

/**
 * 把「空串」与「显式 null」归一化为 undefined（即"未提供"）。
 *
 * 约定（社区主流做法，对齐 GMO 银行等生产规约：缺省 / 空串 / null 三态统一）：
 * - `''`（空字符串）与 `null` 一律视为「未提供该字段」，等价于不传
 * - 纯空白字符串（`' '`、`'\t'`）**不**在此处理——文本字段的首尾空白由
 *   schema 层的 `trimmed()`（`src/common/validation/trimmed.ts`）按字段声明，
 *   trim 后为空时同样落到"未提供"。两层分工：管道管"空值语义"，schema 管"文本规范化"
 * - 仅递归处理**普通对象**（query / body 的层级结构）；数组元素原样保留
 *   （数组内的空串、null 多为有意为之，如标签列表、批量操作占位）；
 *   顶层字符串（如 `:param` 路径参数）也不受影响，需要时由对应 schema 自行 `trimmed`
 * - 其他类型（string / number / boolean / Date / Buffer…）原样返回
 *
 * 归一化后交给领域 schema：optional 字段自然通过，required 字段报
 * 「expected string, received undefined」——必填缺失语义比「min 1」更准确，
 * 因此**无需为任何 DTO 单独加空值包装**。
 */
function emptyishToUndefined(value: unknown): unknown {
  // 仅处理普通对象（排除数组、null、Date、Buffer、类实例等）
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.prototype.toString.call(value) !== '[object Object]'
  ) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] =
      item === '' || item === null ? undefined : emptyishToUndefined(item);
  }
  return result;
}

/**
 * 通用 zod 校验管道（按参数注册）。
 *
 * 用法：`@Body(new ZodValidationPipe(createUserSchema))`，
 * 控制器参数类型标注为 `z.infer<typeof createUserSchema>`。
 *
 * 设计说明：zod 管道天然是"有参管道"（需携带各自 schema），
 * 无法像 ValidationPipe 那样无参全局注册，因此刻意保持显式按参数注册，
 * 校验失败时抛出 400，由全局 HttpExceptionFilter 统一转换为响应契约：
 * message 为简短的「参数校验失败」，字段级详情映射进 errors 数组。
 *
 * 入参归一化：校验前先执行 {@link emptyishToUndefined}，
 * 把空串与显式 null 视为"未提供"，避免前端表单/URL 传空值触发无意义的 400。
 */
@Injectable()
export class ZodValidationPipe<S extends ZodType>
  implements PipeTransform<unknown, z.output<S>>
{
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(emptyishToUndefined(value));
    if (!result.success) {
      const errors: FieldError[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({ message: '参数校验失败', errors });
    }
    return result.data;
  }
}

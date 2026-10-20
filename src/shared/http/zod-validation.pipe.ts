import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

import {
  DEFAULT_VALIDATION_MESSAGE,
  type FieldError,
} from '@/common/api-response/api-response.js';

/**
 * URL query 空值归一化：把「没有值」的 query 参数归一化为 `undefined`。
 *
 * URL 的值是字符串装配的产物 —— 浏览器表单、`URLSearchParams`、`?a=` 无法表达
 * "这个键不存在"，清空的输入框天然就是 `?keyword=`。这是传输层假象，宽容掉不丢语义。
 *
 * JSON body 则相反：它天然能表达缺席（省略 key），因此 `''` 是真实值、`null` 是
 * 显式语义（RFC 7396）。把 body 的空值吞成"未提供"会让 PATCH 无法表达"清空字段"。
 *
 * 范围：
 * - `''` 与纯空白字符串 → `undefined`
 * - 仅递归普通对象；数组元素不动（数组内空串多为有意占位）
 * - 其他类型原样返回
 */
function normalizeQueryValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value;
  }

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
    result[key] = normalizeQueryValue(item);
  }
  return result;
}

/** 管道可选项 */
export interface ZodValidationPipeOptions {
  /**
   * 校验失败时对外返回的 message 文案，默认「参数校验失败」。
   *
   * @example
   * create(
   *   @Body(new ZodValidationPipe(createUserSchema, { message: '注册信息有误，请检查后重试' }))
   *   dto: CreateUserDto,
   * ) {}
   */
  message?: string;
}

/**
 * zod 校验管道，按参数显式注册（zod 管道必须携带自己的 schema，无法无参全局注册）：
 *
 * ```ts
 * @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto
 * ```
 *
 * 校验失败抛 400，由全局 `HttpExceptionFilter` 转成失败契约：`message` 取
 * {@link ZodValidationPipeOptions.message}，字段级详情映射进 `errors`。
 *
 * 入参归一化只对 URL query 生效（按 Nest 传入的 `metadata.type` 判定），
 * `@Body` / `@Param` 的值原样进入 schema。
 */
@Injectable()
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<
  unknown,
  z.output<S>
> {
  constructor(
    private readonly schema: S,
    private readonly options: ZodValidationPipeOptions = {},
  ) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<S> {
    let input = metadata?.type === 'query' ? normalizeQueryValue(value) : value;

    // 无 body 的请求（如 Cookie 模式的 POST /auth/refresh）不等于"非法输入"：
    // Express 对没有 Content-Type 的 POST 不跑 body parser，body 是 undefined；
    // 归一为空对象交给 schema 判定（可选字段 schema 会通过，必填字段照样报错）
    if (input === undefined && metadata?.type === 'body') {
      input = {};
    }

    const result = this.schema.safeParse(input);
    if (!result.success) {
      const errors: FieldError[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({
        message: this.options.message ?? DEFAULT_VALIDATION_MESSAGE,
        errors,
      });
    }
    return result.data;
  }
}

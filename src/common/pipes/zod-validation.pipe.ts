import {
  BadRequestException,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

import type { FieldError } from '../response/api-response.js';
import { DEFAULT_VALIDATION_MESSAGE } from '../response/api-response.js';

/**
 * URL query 空值归一化：把「没有值」的 query 参数归一化为 `undefined`。
 *
 * ## 为什么只有 query 需要这一步
 *
 * URL 的值是**字符串装配的产物**——浏览器表单、`URLSearchParams`、`?a=` 这类写法
 * 都无法表达"这个键不存在"，清空的输入框天然就是 `?keyword=`。这是**传输层假象**，
 * 不代表调用方想传一个空字符串，宽容掉不会丢失任何语义。
 *
 * JSON body 则相反，它**天然能表达缺席**（省略 key 即可），于是：
 *
 * - `null` 是显式语义（RFC 7396 / JSON Merge Patch：`null` = 删除该字段）
 * - `""` 是长度为 0 的**真实值**
 * - 只有"键缺席"才等于"没有提供"
 *
 * 把 body 里的 `null` / `''` 吞成"未提供"会让 PATCH 无法表达"清空某字段"，
 * 也会把"显式置空"与"前端忘了传"混为一谈（前端契约要求请求体必须干净，
 * 见 AGENTS.md 第 6 节）。因此 body / param 一律**原样**进 schema。
 *
 * ## 归一化范围
 *
 * - `''` 与**纯空白字符串**（`' '`、`'\t'`、全角空格）→ `undefined`
 *   （query 的空白没有信息量：`?keyword=%20%20` 等价于没传）
 * - 仅递归**普通对象**；**数组元素不动**（数组内的空串多为有意占位，如多选筛选）
 * - 其他类型（number / boolean…）原样返回
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
   * 校验失败时对外返回的 message 文案。
   *
   * 默认取 {@link DEFAULT_VALIDATION_MESSAGE}（「参数校验失败」）——该文案会直接
   * 展示给用户，因此按接口覆盖是常见需求，例如表单类接口用更具体的说法：
   *
   * ```ts
   * create(
   *   @Body(new ZodValidationPipe(createUserSchema, { message: '注册信息有误，请检查后重试' }))
   *   dto: CreateUserDto,
   * ) {}
   * ```
   *
   * 字段级细节始终保留在 `errors[]` 里，不受本项影响。
   */
  message?: string;
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
 * message 取 {@link ZodValidationPipeOptions.message}（默认「参数校验失败」），
 * 字段级详情映射进 errors 数组。
 *
 * ## 入参归一化：只对 URL query 生效
 *
 * 管道从 Nest 传入的 {@link ArgumentMetadata} 读取参数来源（框架给的事实，不是猜测），
 * **仅当 `metadata.type === 'query'` 时**执行 {@link normalizeQueryValue}；
 * `@Body` / `@Param` 收到的值原样进入 schema。
 *
 * 这样调用点不需要任何额外声明——`@Query(new ZodValidationPipe(schema))` 自动宽容、
 * `@Body(...)` 自动严格，新增路由不会漏写标记（社区管道同样按来源分流）。
 * 理由与前端契约见 {@link normalizeQueryValue} 及 AGENTS.md 第 6 节。
 */
@Injectable()
export class ZodValidationPipe<S extends ZodType>
  implements PipeTransform<unknown, z.output<S>>
{
  constructor(
    private readonly schema: S,
    private readonly options: ZodValidationPipeOptions = {},
  ) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<S> {
    const input =
      metadata?.type === 'query' ? normalizeQueryValue(value) : value;

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

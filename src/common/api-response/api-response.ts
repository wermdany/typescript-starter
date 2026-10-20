/**
 * 统一响应契约。
 *
 * 成功与失败是**判别联合**，判别字段为 `success`：
 *
 * ```jsonc
 * { "success": true,  "message": "创建成功", "data": { "id": 1 } }
 * { "success": false, "message": "学号已存在", "data": null }
 * ```
 *
 * 两条不变量：
 *
 * 1. `success === (HTTP 状态码为 2xx)` —— 成功体只有 `TransformInterceptor` 能产出，
 *    失败体只有 `HttpExceptionFilter` 能产出，两者都按状态码决定 `success`
 * 2. `message` 是给人看的文案（可直接 toast），不是机器判据 —— 客户端只按
 *    `success` / HTTP 状态码 / `errors[].path` 分支
 *
 * `data` 里有哪些字段由 `<domain>.projection.ts` 的列白名单决定。
 */

/** 字段级校验错误 */
export interface FieldError {
  /** 字段点路径，如 "email" / "address.city"（根级为空串） */
  path: string;
  /** 错误说明 */
  message: string;
}

/** 成功响应（`data` 为 `null` 表示操作成功但无返回体） */
export interface ApiSuccess<T> {
  success: true;
  /** 默认 `DEFAULT_SUCCESS_MESSAGE`，可用 `@ApiMessage()` 覆盖 */
  message: string;
  data: T | null;
}

/** 失败响应（`errors` 仅在参数校验失败时出现） */
export interface ApiFailure {
  success: false;
  /** 5xx 固定为「服务器内部错误」，内部细节只进服务端日志 */
  message: string;
  data: null;
  errors?: FieldError[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 成功响应的默认 message（未声明 `@ApiMessage()` 时使用） */
export const DEFAULT_SUCCESS_MESSAGE = 'ok';

/** 参数校验失败的默认 message；可按管道覆盖，见 `ZodValidationPipeOptions.message` */
export const DEFAULT_VALIDATION_MESSAGE = '参数校验失败';

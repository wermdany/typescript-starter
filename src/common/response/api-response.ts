/**
 * 统一响应契约类型。
 *
 * ## 成功与失败是**判别联合**，判别字段是 `success`
 *
 * ```jsonc
 * // 成功
 * { "success": true,  "message": "创建成功", "data": { "id": 1 } }
 * // 失败
 * { "success": false, "message": "学号已存在", "data": null }
 * ```
 *
 * 前端**只认 `success` + HTTP 状态码**，不要读 message 做分支。
 *
 * ## 为什么没有 `code`
 *
 * 早期版本用 `{ code, message, data }`：成功时 `code: 0`、失败时 `code: <HTTP 状态>`——
 * 一个字段承载两个不同尺度，文档必须专门解释，且与 HTTP 状态码完全重复
 * （RFC 9457 明确反对「复用 HTTP 状态码当业务错误码」：`{"code": 402}` 没提供
 * 状态行之外的任何信息）。`success` 是布尔，语义无歧义，也不与状态码抢位置。
 *
 * ## 两条硬性不变量（破坏它等于废掉客户端）
 *
 * 1. **`success === (HTTP 状态码为 2xx)`**
 *    绝不允许出现 `200` + `success: false` —— 那会同时废掉重试策略、网关规则
 *    与错误率监控，并逼客户端"先解析再知道成败"。
 * 2. **`message` 是"给人看的"，不是机器判据**
 *    它是可直接 toast 的文案，因此：① 客户端**禁止**用 `if (message === '学号已存在')`
 *    做分支（改文案会静默破坏逻辑，分支只能靠 `success` / HTTP 状态码 / `errors[].path`）；
 *    ② 服务端只有中文，不做 i18n（多语言由前端自行映射）。
 *
 * ## `data` 与 `errors`
 *
 * - 成功：`data` 为业务数据；无返回值的操作为 `null`
 *   （**不改成 204**——判别字段在 body 里，204 无 body 会让前端失去唯一判据）
 * - 失败：`data` 恒为 `null`；`errors` 仅在参数校验失败（400）时出现
 */

/**
 * 字段级校验错误。
 *
 * 由 zod issue 映射而来——契约对 zod 内部结构（code/expected/received 等）
 * 保持无感知，避免 zod 版本演进造成 API 破坏性变更。
 */
export interface FieldError {
  /** 字段点路径，如 "email" / "address.city"（根级为空串） */
  path: string;
  /** 人类可读的错误说明 */
  message: string;
}

/** 成功响应（`data` 为 `null` 表示操作成功但无返回体，如重置密码） */
export interface ApiSuccess<T> {
  success: true;
  /** 可直接展示的提示文案，默认 `DEFAULT_SUCCESS_MESSAGE`，`@ApiMessage` 可覆盖 */
  message: string;
  data: T | null;
}

/** 失败响应（`errors` 仅参数校验失败时出现） */
export interface ApiFailure {
  success: false;
  /** 可直接 toast 的短文案；5xx 固定为「服务器内部错误」，内部细节只进服务端日志 */
  message: string;
  data: null;
  errors?: FieldError[];
}

/** 统一响应契约（判别联合，用 `success` 收窄） */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * 成功响应的默认 message（未声明 `@ApiMessage` 时使用）。
 *
 * 改变它会影响**所有**未显式声明文案的接口，属契约变更。
 */
export const DEFAULT_SUCCESS_MESSAGE = 'ok';

/**
 * 参数校验失败的默认 message。
 *
 * 单个管道可覆盖：`@Body(new ZodValidationPipe(schema, { message: '注册信息有误' }))`；
 * 全局改文案改这里一处即可。
 */
export const DEFAULT_VALIDATION_MESSAGE = '参数校验失败';

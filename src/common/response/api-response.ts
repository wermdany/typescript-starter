/**
 * 统一响应契约类型（成功与失败同构）。
 *
 * - 成功：`{ code: 0, message: 'ok' | '@ApiMessage 覆盖文案', data: T }`
 * - 失败：`{ code: <httpStatus>, message: <简短失败原因>, data: null }`
 *   - 参数校验失败（400）额外携带 `errors` 数组（字段级详情，前端可按 path 绑定表单）
 *   - 业务失败（404/409 等）message 为自描述短原因，无 `errors` 字段
 *   - 未知异常（500）message 固定「服务器内部错误」，细节仅写服务端日志，不泄漏给客户端
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

/** 统一响应契约（`errors` 仅参数校验失败时出现） */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
  errors?: FieldError[];
}

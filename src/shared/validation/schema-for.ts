import { z } from 'zod';

/**
 * 把「响应 schema」和「从列白名单推出来的类型」钉在一起。
 *
 * ## 为什么需要它
 *
 * 白名单（`userPublicColumns`）推导出类型（`UserResponse`），schema 是手写的。
 * 两者之间唯一的联系是编译器 —— 但直接写 `const s: z.ZodType<T> = ...` 只做
 * **单向**检查（`schema 的输出` 能赋给 `T`），实测覆盖：
 *
 * - ✅ 漏字段 → 报错
 * - ✅ 字段类型 / 可空性写错 → 报错
 * - ❌ **schema 比 `T` 多字段 → 不报错**（多的字段照样"能赋给"少的类型）
 *
 * 第三条是文档事故：多出来的字段会出现在接口文档里，但服务端永远不返回它。
 *
 * ## 用法
 *
 * ```ts
 * export const userResponseSchema = schemaFor<UserResponse>()(
 *   z.object({ id: z.number().int().describe('用户 ID'), ... }).meta({ id: 'UserResponse' }),
 * );
 * ```
 *
 * 不匹配时参数类型会变成 {@link SchemaOutputMismatch}，编译错误里直接写着
 * `expected` / `actual`，比 `not assignable to never` 好读。
 */
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/** 不匹配时的替身类型：让编译错误自己说清哪边多了、哪边少了 */
export interface SchemaOutputMismatch<Expected, Actual> {
  readonly __schemaOutputMismatch: {
    readonly expected: Expected;
    readonly actual: Actual;
  };
}

export function schemaFor<T>() {
  return <S extends z.ZodType>(
    schema: MutuallyAssignable<z.infer<S>, T> extends true
      ? S
      : SchemaOutputMismatch<T, z.infer<S>>,
  ): S => schema as unknown as S;
}

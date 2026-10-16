import { z } from 'zod';

/** 字段级例外标记：在字段上写 `.meta({ keepWhitespace: true })` 即可跳过首尾空白规范化 */
const KEEP_WHITESPACE = 'keepWhitespace';

/**
 * 文本字段首尾空白规范化（单个 schema 用；批量场景优先 {@link trimmedShape}）。
 *
 * 语义：先 `trim()`，trim 后为空串则**视为「未提供」**（→ `undefined`），
 * 与管道层「空串 / 显式 null = 未提供」的约定完全衔接。
 *
 * ## 使用纪律（务必遵守）
 *
 * 1. **`.optional()` / `.default()` 必须写在内层**：
 *    `trimmed(z.string().min(1).max(50).optional())` ✅
 *    `trimmed(z.string().min(1).max(50)).optional()` ❌（纯空白会变成"可选的 undefined"而静默通过）
 *    用 {@link trimmedShape} 时天然满足这条（它包装的是整个字段 schema）
 * 2. **不要用于 `password`**——空白可能是密码的熵，社区一致的字段级策略；
 *    在 DTO 里请改用 `.meta({ keepWhitespace: true })` 标注（见 {@link trimmedShape}）
 * 3. **长度校验按 trim 后的值计算**（zod 按顺序执行 check），因此 `max(20)` 不会误伤
 *    `' 20250001 '` 这类"内容合法但带空格"的输入
 *
 * ## 实现取舍
 *
 * 用 `z.preprocess` 而非 `z.string().trim()`：后者 trim 后得到空串，只能报
 * `too_small`，无法产出 `undefined`，也就无法表达"视为未提供"；
 * `overwrite()` 要求返回值与输出同型（不能返回 undefined）；`superRefine` 会丢失
 * 内建的 `expected string, received undefined` 语义（必填缺失的报错会变得含糊）。
 *
 * ## 已知副作用
 *
 * `z.preprocess` 的入参类型是 `unknown`，因此该字段的**输入类型**（`z.input`）会退化为
 * `unknown`，但**输出类型**（`z.output` / `z.infer`）仍是内层 schema 的类型。
 * 本项目 DTO 类型统一取自 `z.infer`（即 output），故实际无影响；
 * 若将来有人写 `schema.parse(typedInput)` 期望输入侧类型提示，需注意这一点。
 *
 * 顶层字符串（如 `:param` 路径参数）不属于 shape，正是本函数的用武之地。
 */
export function trimmed<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const text = value.trim();
    return text === '' ? undefined : text;
  }, schema);
}

/**
 * 把 shape 中每个字段自动包一层 {@link trimmed}，除非该字段标注了
 * `.meta({ keepWhitespace: true })`。
 *
 * 这是 DTO 的**默认写法**——避免逐字段手写包装时"新增字段漏包"，
 * 那会制造「有些接口 trim、有些不 trim」的不一致（唯一性 / 搜索层面的静默 bug）。
 *
 * ```ts
 * export const createUserSchema = z.object(
 *   trimmedShape({
 *     nickname: z.string().min(1).max(50),                               // 自动 trim
 *     password: z.string().min(8).max(128).meta({ keepWhitespace: true }) // 就近声明例外
 *   }),
 * );
 * ```
 *
 * 设计要点：
 *
 * - **只重建 shape，不重建对象**：返回值是普通 shape，由调用方照常交给
 *   `z.object(...)` / `paginationSchema.extend(...)`，因此 `.strict()` / `.catchall()`
 *   等对象级配置、以及链在其后的 `.refine()` 都不会丢失
 * - **对非字符串字段无副作用**：`trimmed` 对非字符串原样透传，`points` / `role` 之类
 *   包一层也不会改变行为，因此无需按字段类型分支
 * - **只处理顶层字段**：嵌套对象（如 `address: z.object({...})`）按其定义处自行处理
 *   （写成 `z.object(trimmedShape({...}))`）；数组元素与管道层一致，不处理
 * - **返回类型声明为 `T`**：`trimmed` 不改变输出类型（只把输入侧变为 `unknown`），
 *   故 `z.infer` 与逐字段包装完全一致
 */
export function trimmedShape<T extends Record<string, z.ZodType>>(shape: T): T {
  const wrapped = Object.entries(shape).map(([key, field]) => {
    const meta = field.meta() as Record<string, unknown> | undefined;
    return [key, meta?.[KEEP_WHITESPACE] === true ? field : trimmed(field)];
  });
  return Object.fromEntries(wrapped) as T;
}

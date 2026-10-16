import { z } from 'zod';

/** 字段级例外标记：在字段上写 `.meta({ keepWhitespace: true })` 即可跳过首尾空白规范化 */
const KEEP_WHITESPACE = 'keepWhitespace';

/**
 * 文本字段首尾空白规范化（单个 schema 用；批量场景优先 {@link trimmedShape}）。
 *
 * 语义：**只去掉首尾空白**。trim 后为空串就保持空串，交给字段自身的约束判定
 * （必填字段的 `min(1)` 会报 `Too small`，可选字段则如实拿到 `''`）。
 *
 * ## 为什么不把「trim 后为空」转成 `undefined`
 *
 * 空值语义**不属于 schema 层**，它取决于参数来源（见 AGENTS.md 第 6 节）：
 *
 * - **URL query**：`''` / 纯空白是传输层假象，管道层（`ZodValidationPipe` 的
 *   `normalizeQueryValue`）在校验前统一归零为「未提供」——schema 根本看不到空值
 * - **JSON body**：`''` 是长度为 0 的真实值，必须**如实**校验；若在这里转成
 *   `undefined`，optional 字段传 `''` 会被静默吞掉、`null` 也会被当成"没传"，
 *   等于替前端掩盖 bug（前端契约要求请求体干净）
 *
 * 早期版本曾在 schema 层统一做"trim 后为空 → 未提供"，那让同一份 schema 无法
 * 区分"谁在宽容"，已废弃。现在 schema 层保持**严格且来源无关**。
 *
 * ## 使用纪律
 *
 * 1. **`.optional()` / `.default()` 写在内层**（`trimmed(z.string().optional())`）——
 *    `trimmedShape` 天然满足。两层写法如今语义一致（本函数不再产出 `undefined`），
 *    保留这条只为写法统一，避免日后有人按位置差异推断出并不存在的语义
 * 2. **不要用于 `password`**——空白可能是密码的熵，社区一致的字段级策略；
 *    在 DTO 里请改用 `.meta({ keepWhitespace: true })` 标注（见 {@link trimmedShape}）
 * 3. **长度校验按 trim 后的值计算**（zod 按顺序执行 check），因此 `max(20)` 不会误伤
 *    `' 20250001 '` 这类"内容合法但带空格"的输入
 *
 * ## 实现取舍
 *
 * 用 `z.preprocess` 而非 `z.string().trim()`：后者只适用于 `ZodString`，
 * 而本函数要**无差别包裹任意字段类型**（`trimmedShape` 会把 enum / number / optional
 * 字段一起包上，非字符串必须原样透传）。`preprocess` 的入参是 `unknown`，
 * 既能安全地做 `typeof === 'string'` 判断，又不改变输出类型。
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
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    schema,
  );
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
 * - **不做空值宽恕**：见 {@link trimmed} 的说明，空值宽容只发生在 query 的管道层
 */
export function trimmedShape<T extends Record<string, z.ZodType>>(shape: T): T {
  const wrapped = Object.entries(shape).map(([key, field]) => {
    const meta = field.meta() as Record<string, unknown> | undefined;
    return [key, meta?.[KEEP_WHITESPACE] === true ? field : trimmed(field)];
  });
  return Object.fromEntries(wrapped) as T;
}

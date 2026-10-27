import type { SchemaObject } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/**
 * zod schema → OpenAPI schema 的**唯一转换入口**。
 *
 * 文档的字段约束不从注释里抄，而是直接来自 `@ZodBody` / `@ZodQuery` / `@ZodParam`
 * 已经在用的那份 schema —— 校验规则改了，文档同步改，物理上不可能漂移。
 *
 * ## 为什么是 `target: 'openapi-3.0'`
 *
 * zod 4 能直接产出 3.0 方言（`nullable` 而非 `type: ['string','null']`），
 * 客户端生成器对 3.0 的支持面比 3.1 稳。
 *
 * ## 三处清洗（都是实测出来的必要动作）
 *
 * 1. 删 `$schema`：OpenAPI 文档里放 JSON Schema 的方言声明会被部分校验器判非法
 * 2. 删 `additionalProperties: false`：`io: 'output'` 会带出来，放进去会让生成器
 *    把每个模型都变成"封闭对象"，后续加字段全部报错
 * 3. 删 `format: 'email'` 旁边的 `pattern`：`z.email()` 会附带一条 80 字符的正则，
 *    与 `format` 重复，只会在 UI 上变成噪音
 *
 * ## 命名 schema 的登记
 *
 * zod 的 `.meta({ id })` 会把子 schema 拆到 `definitions` 并写成 `$ref:#/definitions/X`；
 * OpenAPI 的对应位置是 `components.schemas`。这里把 `definitions` 收进进程内登记表、
 * 把 `$ref` 重写为 `#/components/schemas/X`，等 `buildOpenApiDocument()` 时合并进文档。
 *
 * 登记表是**模块级**的：装饰器在类定义时执行（早于 `createDocument()`），
 * 因此"写文档"这一步不需要回头扫 controller。
 */

/** 对外暴露的 schema 类型别名：用 swagger 的 `SchemaObject`，调用点不必再断言 */
export type OpenApiSchema = SchemaObject;

/** 已登记的命名 schema（`$ref` 的目标） */
const componentSchemas = new Map<string, SchemaObject>();

/** 取出全部命名 schema，供 `components.schemas` 合并 */
export function openApiComponentSchemas(): Record<string, SchemaObject> {
  return Object.fromEntries(componentSchemas);
}

const DEFINITIONS_PREFIX = '#/definitions/';
const COMPONENTS_PREFIX = '#/components/schemas/';

type RawSchema = Record<string, unknown>;

/** 深度遍历 schema 树，对每个对象节点做一次就地改写 */
function mapSchemaNode(
  node: unknown,
  visit: (node: RawSchema) => RawSchema,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => mapSchemaNode(item, visit));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const visited = visit({ ...(node as RawSchema) });
  for (const [key, value] of Object.entries(visited)) {
    visited[key] = mapSchemaNode(value, visit);
  }
  return visited;
}

function sanitize(node: RawSchema): RawSchema {
  const cleaned = { ...node };
  delete cleaned.$schema;
  if (cleaned.additionalProperties === false) {
    delete cleaned.additionalProperties;
  }
  if (cleaned.format === 'email') {
    delete cleaned.pattern;
  }
  return cleaned;
}

function rewriteRef(node: RawSchema): RawSchema {
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith(DEFINITIONS_PREFIX)) {
    return { ...node, $ref: COMPONENTS_PREFIX + ref.slice(DEFINITIONS_PREFIX.length) };
  }
  return node;
}

/**
 * 把 zod schema 转成 OpenAPI schema，并顺带登记它的命名子 schema。
 *
 * @param schema 任意 zod schema
 * @param io `'input'` 用于请求（`.default()` 不算必填），`'output'` 用于响应（默认值已落成实际值）
 *
 * @example
 * ApiBody({ schema: toOpenApiSchema(createUserSchema, 'input') })
 */
export function toOpenApiSchema(
  schema: ZodType,
  io: 'input' | 'output' = 'input',
): OpenApiSchema {
  const raw = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as RawSchema;

  const { definitions, ...root } = raw;

  if (definitions !== null && typeof definitions === 'object') {
    for (const [name, definition] of Object.entries(
      definitions as Record<string, unknown>,
    )) {
      // 定义内部也可能带 `$ref`（如 `XxxPage.items → Xxx`），必须**和根节点走同一条
      // 清洗 + 重写链**；只清洗不重写会留下 `#/definitions/...` 的断链，
      // 而 UI 上只表现为"这个模型展开不了"，不会报错。
      const cleaned = mapSchemaNode(definition, sanitize);
      componentSchemas.set(
        name,
        mapSchemaNode(cleaned, rewriteRef) as OpenApiSchema,
      );
    }
  }

  const cleaned = mapSchemaNode(root, sanitize);
  return mapSchemaNode(cleaned, rewriteRef) as OpenApiSchema;
}

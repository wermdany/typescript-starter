import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * 文档完整性校验：把「必须写描述」变成启动期报错。
 *
 * 这些约束**只能**在生成出来的文档上检查 —— 源码里看不出来：
 * 字段描述写在 zod 的 `.describe()` 上，只有把 schema 真正生成出来
 * 才知道有没有漏（比如某个字段忘了写、或 `z.date()` 把类型吞了）。
 *
 * 检查项对应 `docs/conventions/08-contract-layers.md` §20.6：
 * 1. 每个 operation 必须有 summary（这个请求做什么）
 * 2. 每个参数、请求体字段必须有描述
 * 3. 每个响应必须有描述；响应体的每个字段必须有描述
 * 4. 不允许「没有类型信息」的空 schema（`z.date()` 那种静默失效）
 * 5. 不允许断链的 `$ref`
 */

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

/** 文档里的任意对象节点；swagger 的类型分得很细，这里只关心几个键 */
type Node = Record<string, unknown>;

function isObject(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRef(node: Node): boolean {
  return typeof node.$ref === 'string';
}

function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** schema 是否没有任何形状信息：`{}` 或只有 `nullable`，UI 上会变成一个"any" */
function lacksShape(node: Node): boolean {
  return (
    node.type === undefined &&
    node.$ref === undefined &&
    node.properties === undefined &&
    node.items === undefined &&
    node.enum === undefined &&
    node.allOf === undefined &&
    node.anyOf === undefined &&
    node.oneOf === undefined
  );
}

interface Context {
  readonly components: Record<string, unknown>;
  readonly violations: string[];
  readonly visitedRefs: Set<string>;
}

function report(context: Context, where: string, detail: string): void {
  context.violations.push(`${where} ${detail}`);
}

/** 递归检查一个 schema 节点：形状信息 + 每个命名属性的描述 */
function checkNode(node: unknown, where: string, context: Context): void {
  if (!isObject(node)) {
    report(context, where, '缺少 schema');
    return;
  }

  if (isRef(node)) {
    const name = refName(String(node.$ref));
    const target = context.components[name];
    if (!target) {
      report(context, where, `$ref 断链：${String(node.$ref)}`);
      return;
    }
    if (context.visitedRefs.has(name)) {
      return;
    }
    context.visitedRefs.add(name);
    checkNode(target, where, context);
    return;
  }

  if (lacksShape(node)) {
    report(
      context,
      where,
      'schema 没有类型信息（可能是 z.date() 或未映射的列类型）',
    );
  }

  if (isObject(node.properties)) {
    for (const [name, property] of Object.entries(node.properties)) {
      const child = where === '' ? name : `${where}.${name}`;
      if (isObject(property) && !isRef(property) && !property.description) {
        report(context, child, '字段缺少 description');
      }
      checkNode(property, child, context);
    }
  }

  if (node.items) {
    checkNode(node.items, `${where}[]`, context);
  }
}

/** 请求体 / 响应体：`content['application/json'].schema` */
function checkBody(content: unknown, where: string, context: Context): void {
  if (!isObject(content)) {
    return;
  }
  const media = content['application/json'];
  if (isObject(media) && media.schema) {
    checkNode(media.schema, where, context);
  }
}

function checkParameter(parameter: unknown, where: string, context: Context): void {
  if (!isObject(parameter) || isRef(parameter)) {
    return;
  }
  const schema = isObject(parameter.schema) ? parameter.schema : undefined;
  const described = parameter.description ?? schema?.description;
  if (!described) {
    report(context, `${where} 参数 ${String(parameter.name)}`, '缺少 description');
  }
}

/**
 * 校验整份文档，返回人类可读的违规清单（空数组 = 通过）。
 *
 * 每条都带 `METHOD /path` 前缀，和 Swagger UI 里的位置对得上。
 */
export function validateOpenApiDocument(document: OpenAPIObject): string[] {
  const context: Context = {
    components: document.components?.schemas ?? {},
    violations: [],
    visitedRefs: new Set(),
  };

  for (const [path, item] of Object.entries(document.paths)) {
    if (!isObject(item)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isObject(operation)) {
        continue;
      }
      const where = `${method.toUpperCase()} ${path}`;

      if (!operation.summary) {
        report(context, where, '缺少 summary（用 @ApiRoute 声明这个请求做什么）');
      }

      if (Array.isArray(operation.parameters)) {
        for (const parameter of operation.parameters) {
          checkParameter(parameter, where, context);
        }
      }

      if (isObject(operation.requestBody) && !isRef(operation.requestBody)) {
        checkBody(operation.requestBody.content, `${where} 请求体`, context);
      }

      if (isObject(operation.responses)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          if (!isObject(response) || isRef(response)) {
            continue;
          }
          if (!response.description) {
            report(context, `${where} → ${status}`, '响应缺少 description');
          }
          checkBody(response.content, `${where} → ${status}`, context);
        }
      }
    }
  }

  return context.violations;
}

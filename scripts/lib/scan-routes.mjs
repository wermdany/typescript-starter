import { promises as fs } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  HTTP_DECORATOR_METHODS,
  MARKER_NAMES,
  analyzeRouteMarkers,
} from './markers.mjs';

const EXCLUDED_DIRECTORY_NAMES = new Set(['__tests__', 'dist', 'node_modules']);

/**
 * 扫描目录中的 Nest HTTP 路由及权限标记。
 *
 * 只解析源码 AST，不解析模块、不加载 TypeScript 文件，也不访问数据库。因此它既能在
 * 项目尚未通过类型检查时运行，也不会触发应用启动副作用。
 *
 * @param {{ root: string, cwd?: string }} options 扫描配置。
 * @returns {Promise<{
 *   root: string,
 *   scannedFiles: number,
 *   controllers: number,
 *   routes: Array<object>,
 *   permissionCodes: string[],
 * }>} 可供审计、同步及矩阵脚本复用的扫描结果。
 */
export async function scanRoutes({ root, cwd = process.cwd() }) {
  const absoluteRoot = path.resolve(cwd, root);
  await assertDirectory(absoluteRoot);

  const files = await collectTypeScriptFiles(absoluteRoot);
  const routes = [];
  let controllers = 0;

  for (const filePath of files) {
    const sourceText = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    assertParseSucceeded(sourceFile, cwd);

    const file = toPosixPath(path.relative(cwd, filePath));
    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) {
        continue;
      }

      const classDecorators = readDecorators(statement, sourceFile);
      const controllerDecorator = classDecorators.find(
        (decorator) => decorator.name === MARKER_NAMES.controller,
      );
      if (!controllerDecorator) {
        continue;
      }

      controllers += 1;
      const controllerName = statement.name?.text ?? '<anonymous>';
      const controllerPaths = readControllerPaths(controllerDecorator);
      const classMarkers = classDecorators.filter((decorator) =>
        MARKER_NAMES.tracking.has(decorator.name),
      );

      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) {
          continue;
        }

        const methodDecorators = readDecorators(member, sourceFile);
        const httpDecorators = methodDecorators.filter((decorator) =>
          HTTP_DECORATOR_METHODS.has(decorator.name),
        );
        if (httpDecorators.length === 0) {
          continue;
        }

        const methodMarkers = methodDecorators.filter((decorator) =>
          MARKER_NAMES.tracking.has(decorator.name),
        );
        const methodName = member.name.getText(sourceFile);

        for (const httpDecorator of httpDecorators) {
          const methodPaths = readRoutePaths(httpDecorator);
          for (const controllerPath of controllerPaths) {
            for (const methodPath of methodPaths) {
              const routePath = joinRoutePaths(controllerPath, methodPath);
              const analysis = analyzeRouteMarkers({
                classMarkers,
                methodMarkers,
                routePath,
              });

              routes.push({
                file,
                line: httpDecorator.line,
                controllerName,
                methodName,
                httpMethod: HTTP_DECORATOR_METHODS.get(httpDecorator.name),
                path: routePath.display,
                pathKind: routePath.kind,
                markerLevel: analysis.markerLevel,
                tracking: analysis.tracking,
                marker: analysis.marker,
                markerLine: analysis.markerLine,
                permissionCodes: analysis.permissionCodes,
                dynamicPermissionCodes: analysis.dynamicPermissionCodes,
                errors: analysis.errors,
                warnings: analysis.warnings,
                hasConflict: analysis.hasConflict,
              });
            }
          }
        }
      }
    }
  }

  const permissionCodes = [
    ...new Set(routes.flatMap((route) => route.permissionCodes)),
  ].sort((left, right) => left.localeCompare(right));

  return {
    root: toPosixPath(path.relative(cwd, absoluteRoot)) || '.',
    scannedFiles: files.length,
    controllers,
    routes,
    permissionCodes,
  };
}

async function assertDirectory(directoryPath) {
  let stat;
  try {
    stat = await fs.stat(directoryPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`扫描目录不存在：${directoryPath}`);
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new Error(`扫描根路径不是目录：${directoryPath}`);
  }
}

async function collectTypeScriptFiles(directoryPath) {
  const files = [];

  async function visit(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          await visit(path.join(currentPath, entry.name));
        }
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(path.join(currentPath, entry.name));
      }
    }
  }

  await visit(directoryPath);
  return files;
}

function assertParseSucceeded(sourceFile, cwd) {
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length === 0) {
    return;
  }

  const diagnostic = diagnostics[0];
  const position = diagnostic.start ?? 0;
  const { line, character } =
    sourceFile.getLineAndCharacterOfPosition(position);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const file = toPosixPath(path.relative(cwd, sourceFile.fileName));
  throw new Error(
    `${file}:${line + 1}:${character + 1} 语法解析失败：${message}`,
  );
}

function readDecorators(node, sourceFile) {
  if (!ts.canHaveDecorators(node)) {
    return [];
  }

  return (ts.getDecorators(node) ?? [])
    .map((decorator) => describeDecorator(decorator, sourceFile))
    .filter((decorator) => decorator !== null);
}

function describeDecorator(decorator, sourceFile) {
  const expression = decorator.expression;
  const callExpression = ts.isCallExpression(expression) ? expression : null;
  const target = callExpression?.expression ?? expression;
  const name = decoratorName(target);
  if (!name) {
    return null;
  }

  const { line } = sourceFile.getLineAndCharacterOfPosition(
    decorator.getStart(sourceFile),
  );
  return {
    name,
    line: line + 1,
    text: decorator.getText(sourceFile),
    args: (callExpression?.arguments ?? []).map((argument) =>
      describeArgument(argument, sourceFile),
    ),
  };
}

function decoratorName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function describeArgument(argument, sourceFile) {
  if (ts.isStringLiteral(argument)) {
    return {
      kind: 'string',
      value: argument.text,
      text: argument.getText(sourceFile),
    };
  }
  if (ts.isNoSubstitutionTemplateLiteral(argument)) {
    return {
      kind: 'template',
      value: argument.text,
      text: argument.getText(sourceFile),
    };
  }
  if (ts.isArrayLiteralExpression(argument)) {
    return {
      kind: 'array',
      elements: argument.elements.map((element) =>
        describeArgument(element, sourceFile),
      ),
      text: argument.getText(sourceFile),
    };
  }
  if (ts.isObjectLiteralExpression(argument)) {
    const pathProperty = argument.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === 'path') ||
          (ts.isStringLiteral(property.name) && property.name.text === 'path')),
    );
    if (pathProperty && ts.isPropertyAssignment(pathProperty)) {
      return {
        kind: 'object-path',
        path: describeArgument(pathProperty.initializer, sourceFile),
        text: argument.getText(sourceFile),
      };
    }
  }
  if (ts.isRegularExpressionLiteral(argument)) {
    return {
      kind: 'regexp',
      value: argument.text,
      text: argument.getText(sourceFile),
    };
  }
  return {
    kind: 'dynamic',
    text: argument.getText(sourceFile),
  };
}

function readControllerPaths(controllerDecorator) {
  if (controllerDecorator.args.length === 0) {
    return [staticPath('')];
  }
  const argument = controllerDecorator.args[0];
  if (argument.kind === 'object-path') {
    return routePathsFromArgument(argument.path);
  }
  return routePathsFromArgument(argument);
}

function readRoutePaths(routeDecorator) {
  if (routeDecorator.args.length === 0) {
    return [staticPath('')];
  }
  return routePathsFromArgument(routeDecorator.args[0]);
}

function routePathsFromArgument(argument) {
  if (!argument) {
    return [staticPath('')];
  }
  if (argument.kind === 'string' || argument.kind === 'template') {
    return [staticPath(argument.value)];
  }
  if (argument.kind === 'array') {
    if (argument.elements.length === 0) {
      return [staticPath('')];
    }
    return argument.elements.flatMap((element) =>
      routePathsFromArgument(element),
    );
  }
  if (argument.kind === 'regexp') {
    return [
      {
        kind: 'pattern',
        value: argument.value,
        display: argument.text,
      },
    ];
  }
  return [
    {
      kind: 'dynamic',
      value: null,
      display: `<动态路径:${argument.text}>`,
    },
  ];
}

function staticPath(value) {
  return { kind: 'static', value, display: value };
}

function joinRoutePaths(controllerPath, methodPath) {
  if (controllerPath.kind === 'dynamic' || methodPath.kind === 'dynamic') {
    return {
      kind: 'dynamic',
      value: null,
      display: joinDisplayPaths(controllerPath.display, methodPath.display),
    };
  }

  if (controllerPath.kind === 'pattern' || methodPath.kind === 'pattern') {
    return {
      kind: 'pattern',
      value: null,
      display: joinDisplayPaths(controllerPath.display, methodPath.display),
    };
  }

  const segments = [controllerPath.value, methodPath.value]
    .flatMap((value) => value.split('/'))
    .filter(Boolean);
  const value = `/${segments.join('/')}`;
  return { kind: 'static', value, display: value };
}

function joinDisplayPaths(prefix, suffix) {
  const parts = [prefix, suffix].filter(Boolean);
  return parts.length === 0 ? '/' : `/${parts.join('/').replaceAll('//', '/')}`;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

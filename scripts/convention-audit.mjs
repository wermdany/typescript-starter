/**
 * 项目规范审计：把 AGENTS.md 里"只能靠自觉"的约定变成有退出码的检查。
 *
 * 只解析源码 AST + 少量正则，不启动应用、不连数据库、不要求代码先通过类型检查，
 * 因此可以在 CI 与 pre-commit 里跑（与 permission-audit.mjs 同一取向）。
 *
 * 已知识别边界：
 * - 只覆盖能静态判定的规则；"仓储写方法首参必须是 actor"这类需要类型信息的规则不在此列
 *   （R1 已由 TypeScript 编译期兜住，见 AGENTS.md 第 18 节）
 * - `env-example-sync` 只比对键集合，不校验值与注释；`src/config/env.ts` 或 `.env.example`
 *   任一缺失时该规则静默跳过（`--root` 指向子目录时找不到它们是正常的）
 * - 正则类规则（`Omit<…passwordHash>`、`process.env`）以"出现即违规"为准，
 *   可能出现极少量误报；确需豁免时在规则里显式登记白名单文件，不要靠注释绕过
 * - 新增规则必须同步进 RULE_META，并在 AGENTS.md 的"谁检查"一列登记脚本名
 *
 * 退出码：0 无违规 / 1 发现违规 / 2 参数或环境错误。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const USAGE = `用法：node scripts/convention-audit.mjs [选项]

把 AGENTS.md 的约定从"文档"变成"红绿灯"：扫描 src/ 下的 TypeScript 源码，
报告违反项目规范的位置。

选项：
  --root=<dir>       覆盖扫描根目录（默认：src）
  --rule=<id>        只跑指定规则，可重复（默认：全部）
  --list-rules       只列出规则清单
  --json             输出可供机器读取的 JSON
  --quiet            人类可读报告中省略"建议"行
  -h, --help         显示帮助`;

const DEFAULT_ROOT = 'src';
const EXCLUDED_DIRECTORY_NAMES = new Set(['dist', 'node_modules']);

/** 角色判定豁免目录：`isAdmin()` / `hasRole()` 的实现本身就在这里（AGENTS.md §16）。 */
const ROLE_RULE_EXEMPT_PREFIXES = ['src/common/auth/'];

/** 配置读取豁免目录：ENV / AUTH_CONFIG 的装配处允许碰 ConfigService 与 process.env（§4）。 */
const CONFIG_RULE_EXEMPT_PREFIXES = ['src/config/'];

/** 禁止自造的文件后缀（§2）。`.d.ts`、`*.spec.ts`、`*.e2e-spec.ts` 不在其列。 */
const FORBIDDEN_FILE_SUFFIX_RE = /\.(use-case|projection|handler|policy)\.ts$/;

/** 整名即自造后缀的测试文件（如 `projection.spec.ts`）：去掉 `.spec.ts` 后整名命中。 */
const FORBIDDEN_BARE_NAMES = new Set(['projection.ts', 'use-case.ts', 'handler.ts', 'policy.ts']);

/**
 * 注释里的"历史脉络"标记（§2 #18）。
 *
 * 只收高精度词，宁可漏判也不误报：`不再` / `已删除` 这类词在描述当前语义与
 * 软删除状态时同样正常（"用户已删除"是领域词），不能当演进叙述处理。
 */
const COMMENT_HISTORY_RE =
  /重构前|重构后|改造前|改造后|多键时代|旧实现|旧版本|以前是|原来是|原先的|原先写|之前是|之前写|之前的实现|已废弃|已改名为|已移除|本轮改|上一版/;

/** 注释行：`//` 行、块注释续行 `*`、块注释起始 `/*` */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\*|\/\*)/;

/**
 * `isAdmin()` 的合法使用处：契约定义（`common/`）、守卫与 barrel（`shared/`）、
 * 权限码解析器（`modules/rbac/`）。业务模块里出现即视为"用角色代替权限码做分支"。
 */
const ADMIN_BRANCH_EXEMPT_PREFIXES = ['src/common/', 'src/shared/', 'src/modules/rbac/'];

/** §2 明确授权的白名单位置：字段级修改权限用「角色 → 可改字段集」映射，那本来就是角色语义。 */
const ADMIN_BRANCH_EXEMPT_FILES = new Set(['update-policy.ts']);

/** 环境变量"唯一声明处"与模板的一致性比对（§4）。 */
const ENV_SCHEMA_FILE = 'src/config/env.ts';
const ENV_EXAMPLE_FILE = '.env.example';

const RULE_META = {
  'import-suffix': {
    section: '§11',
    title: '本地导入必须带 .js 后缀',
    suggest: "相对导入与 `@/` 别名导入都以 `.js` 结尾（纯 ESM）",
  },
  'cross-dir-relative': {
    section: '§11',
    title: '跨目录导入一律用 @/ 别名',
    suggest: '两级以上的 `../../` 说明越了目录，改成 `@/shared/common.js` 这类别名',
  },
  'role-literal': {
    section: '§16',
    title: '角色判定只走 isAdmin() / hasRole() / hasAnyRole()',
    suggest: '散落的 `role === \'admin\'` / `roles.includes(...)` 在多角色下必然出偏差',
  },
  'projection-blacklist': {
    section: '§5',
    title: '对外字段用列白名单，不用 Omit 黑名单',
    suggest: '新增列会默认泄露且编译期不报错；换成 `xxxPublicColumns` 白名单',
  },
  'config-service-get': {
    section: '§4',
    title: '业务代码禁止逐键 ConfigService.get()',
    suggest: '改用 `@Inject(ENV) env: Env` 整对象直取',
  },
  'process-env': {
    section: '§4',
    title: '业务代码禁止直读 process.env',
    suggest: '配置项统一在 `src/config/env.ts` 的 envSchema 声明',
  },
  'file-suffix': {
    section: '§2',
    title: '文件后缀只用约定的五种',
    suggest: '`*.use-case.ts` / `*.projection.ts` / `*.handler.ts` / `*.policy.ts` 一律不用',
  },
  'timestamps-spread': {
    section: '§8',
    title: 'timestamps 必须函数调用展开',
    suggest: '写成 `...timestamps()`；共享列 builder 会让多表列名错乱',
  },
  'coerce-boolean': {
    section: '§4',
    title: '布尔环境变量不要用 z.coerce.boolean()',
    suggest: "`Boolean('false') === true`，改用 envBoolean()`",
  },
  'coerce-number-param': {
    section: '§6',
    title: '路径参数不要用 z.coerce.number()',
    suggest: "`Number('') === 0`，用 regex + transform(Number) + pipe 的写法",
  },
  'console-log': {
    section: '§10',
    title: '业务代码不要用 console.log',
    suggest: '改用 `new Logger(\'Context\')`',
  },
  'manual-response': {
    section: '§5',
    title: 'Controller 不手写响应对象',
    suggest: '成功走 TransformInterceptor，失败抛 HttpException 子类',
  },
  'env-example-sync': {
    section: '§4',
    title: 'envSchema 与 .env.example 必须一一对应',
    suggest: '新增变量同时改 `src/config/env.ts` 与 `.env.example`（清单别手抄，以本规则为准）',
  },
  'admin-role-branch': {
    section: '§16 §18',
    title: '业务代码不用 isAdmin() 决定"能否操作别人的资源"',
    suggest: '准入问权限码（`user:delete` / `user:restore` / `user:reset-password`），角色只是权限码的载体',
  },
  'comment-history': {
    section: '§2 #18',
    title: '注释不写功能的历史脉络',
    suggest: '只写"当前怎么设计、为什么必须这样"；"重构前/原先/已废弃/本轮"这类演进叙述删掉 —— git 已经记了历史，注释只对读代码当刻的人负责',
  },
};

const RULE_IDS = Object.keys(RULE_META);

class CliArgumentError extends Error {}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.listRules) {
    process.stdout.write(options.json ? `${JSON.stringify({ rules: RULE_META }, null, 2)}\n` : `${formatRuleList()}\n`);
    return 0;
  }

  const result = await runAudit(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHumanReport(result, options)}\n`);
  }
  return result.exitCode;
}

async function runAudit(options) {
  const cwd = process.cwd();
  const absoluteRoot = path.resolve(cwd, options.root);
  await assertDirectory(absoluteRoot, options.root);

  const files = await collectTypeScriptFiles(absoluteRoot);
  const findings = [];

  await collectEnvExampleFindings(cwd, options, findings);

  for (const filePath of files) {
    const relativePath = toPosixPath(path.relative(cwd, filePath));
    collectFilenameFindings(relativePath, options, findings);

    const sourceText = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assertParseSucceeded(sourceFile, relativePath);

    collectTextFindings(sourceText, relativePath, options, findings);
    collectAstFindings(sourceFile, relativePath, options, findings);
  }

  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

  return {
    schemaVersion: 1,
    root: options.root,
    scannedFiles: files.length,
    rules: options.rules,
    violationCount: findings.length,
    violations: findings,
    exitCode: findings.length === 0 ? 0 : 1,
  };
}

function parseArguments(args) {
  const options = {
    root: DEFAULT_ROOT,
    rules: [...RULE_IDS],
    listRules: false,
    json: false,
    quiet: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--quiet') {
      options.quiet = true;
    } else if (argument === '--list-rules') {
      options.listRules = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--root=')) {
      const root = argument.slice('--root='.length).trim();
      if (root.length === 0) {
        throw new CliArgumentError('--root 不能为空');
      }
      options.root = root;
    } else if (argument.startsWith('--rule=')) {
      const rule = argument.slice('--rule='.length).trim();
      if (!RULE_META[rule]) {
        throw new CliArgumentError(`未知规则：${rule}（可用规则：${RULE_IDS.join('、')}）`);
      }
      options.rules = [...new Set([...options.rules, rule])];
    } else {
      throw new CliArgumentError(`未知参数：${argument}`);
    }
  }

  if (!args.some((argument) => argument.startsWith('--rule='))) {
    options.rules = [...RULE_IDS];
  }
  return options;
}

async function assertDirectory(absolutePath, originalPath) {
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new CliArgumentError(`扫描根目录不存在或不是目录：${originalPath}`);
  }
}

function assertParseSucceeded(sourceFile, relativePath) {
  if (sourceFile.parseDiagnostics.length > 0) {
    const first = sourceFile.parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    throw new CliArgumentError(`${relativePath} 解析失败：${message}`);
  }
}

async function collectTypeScriptFiles(absoluteRoot) {
  const files = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }

  await walk(absoluteRoot);
  files.sort();
  return files;
}

function enabled(options, ruleId) {
  return options.rules.includes(ruleId);
}

function addFinding(findings, options, rule, file, line, detail) {
  if (!enabled(options, rule)) {
    return;
  }
  findings.push({ rule, section: RULE_META[rule].section, file, line, detail });
}

function isExempt(file, prefixes) {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function collectFilenameFindings(file, options, findings) {
  const base = path.basename(file);
  if (FORBIDDEN_FILE_SUFFIX_RE.test(base)) {
    addFinding(findings, options, 'file-suffix', file, 1, `文件名 ${base} 用了自造后缀`);
    return;
  }
  // 测试文件跟着被测文件命名：`login.service.ts` → `login.service.spec.ts`。
  // 孤儿名（`login.use-case.spec.ts`、`projection.spec.ts`）说明源文件早已改名/删除而测试没跟上。
  if (/\.spec\.ts$/.test(base)) {
    const asSource = `${base.slice(0, -'.spec.ts'.length)}.ts`;
    if (FORBIDDEN_FILE_SUFFIX_RE.test(asSource) || FORBIDDEN_BARE_NAMES.has(asSource)) {
      addFinding(
        findings,
        options,
        'file-suffix',
        file,
        1,
        `测试文件名 ${base} 指向一个自造后缀的源文件；被测文件按五类后缀命名后，测试名应为 <被测文件名>.spec.ts`,
      );
    }
  }
}

/**
 * 比对 `envSchema` 的键与 `.env.example` 的键（§4：两者必须一一对应）。
 *
 * 只解析 AST 与行文本，不加载模块、不读真实环境变量。两个文件任一缺失时跳过判定
 * （`--root` 可以指向子目录，那时不该因为找不到文件而报错）。
 */
async function collectEnvExampleFindings(cwd, options, findings) {
  if (!enabled(options, 'env-example-sync')) {
    return;
  }

  const [schemaText, exampleText] = await Promise.all([
    fs.readFile(path.resolve(cwd, ENV_SCHEMA_FILE), 'utf8').catch(() => null),
    fs.readFile(path.resolve(cwd, ENV_EXAMPLE_FILE), 'utf8').catch(() => null),
  ]);
  if (schemaText === null || exampleText === null) {
    return;
  }

  const schemaKeys = readEnvSchemaKeys(schemaText);
  const exampleKeys = readEnvExampleKeys(exampleText);
  if (schemaKeys.size === 0) {
    return;
  }

  for (const [key, line] of [...schemaKeys].sort()) {
    if (!exampleKeys.has(key)) {
      addFinding(findings, options, 'env-example-sync', ENV_SCHEMA_FILE, line, `envSchema 里的 ${key} 没有同步进 ${ENV_EXAMPLE_FILE}`);
    }
  }
  for (const [key, line] of [...exampleKeys].sort()) {
    if (!schemaKeys.has(key)) {
      addFinding(findings, options, 'env-example-sync', ENV_EXAMPLE_FILE, line, `${ENV_EXAMPLE_FILE} 里的 ${key} 不在 envSchema 中`);
    }
  }
}

function readEnvSchemaKeys(sourceText) {
  const sourceFile = ts.createSourceFile(ENV_SCHEMA_FILE, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Map();

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'envSchema' &&
      node.initializer
    ) {
      const objectCall = findZObjectCall(node.initializer, sourceFile);
      const argument = objectCall?.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (!property.name) {
            continue;
          }
          keys.set(
            property.name.getText(sourceFile),
            sourceFile.getLineAndCharacterOfPosition(property.name.getStart(sourceFile)).line + 1,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

function findZObjectCall(node, sourceFile) {
  let found = null;
  const visit = (current) => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(current) && current.expression.getText(sourceFile) === 'z.object') {
      found = current;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function readEnvExampleKeys(sourceText) {
  const keys = new Map();
  sourceText.split('\n').forEach((line, index) => {
    const matched = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (matched) {
      keys.set(matched[1], index + 1);
    }
  });
  return keys;
}

function collectTextFindings(sourceText, file, options, findings) {
  const lines = sourceText.split('\n');

  // Omit<Users, 'passwordHash'> 这类黑名单投影
  const omitRe = /\bOmit\s*<[^>]*(passwordHash|password_hash|tokenHash|refreshTokenHash)/;
  findRegexMatches(lines, omitRe, (lineNumber, matched) => {
    addFinding(findings, options, 'projection-blacklist', file, lineNumber, `黑名单投影：${matched.trim()}`);
  });

  // 注释不写功能的历史脉络（§2 #18）：git 已记录演进过程，注释只对读代码当刻负责
  lines.forEach((line, index) => {
    if (!COMMENT_LINE_RE.test(line)) {
      return;
    }
    if (!COMMENT_HISTORY_RE.test(line)) {
      return;
    }
    addFinding(
      findings,
      options,
      'comment-history',
      file,
      index + 1,
      `注释写功能历史脉络：${line.trim().slice(0, 60)}`,
    );
  });

  if (!isExempt(file, CONFIG_RULE_EXEMPT_PREFIXES)) {
    findRegexMatches(lines, /\bConfigService\s*\.\s*get\s*\(/, (lineNumber, matched) => {
      addFinding(findings, options, 'config-service-get', file, lineNumber, `逐键取配置：${matched.trim()}`);
    });
    findRegexMatches(lines, /\bconfigService\s*\.\s*get\s*\(/, (lineNumber, matched) => {
      addFinding(findings, options, 'config-service-get', file, lineNumber, `逐键取配置：${matched.trim()}`);
    });
    findRegexMatches(lines, /\bprocess\s*\.\s*env\b/, (lineNumber, matched) => {
      addFinding(findings, options, 'process-env', file, lineNumber, `直读环境变量：${matched.trim()}`);
    });
  }
}

function findRegexMatches(lines, regex, onMatch) {
  const matcher = new RegExp(regex.source, 'g');
  lines.forEach((line, index) => {
    matcher.lastIndex = 0;
    const matched = matcher.exec(line);
    if (matched) {
      onMatch(index + 1, matched[0]);
    }
  });
}

function collectAstFindings(sourceFile, file, options, findings) {
  const visit = (node) => {
    checkImportSpecifier(node, sourceFile, file, options, findings);
    checkRoleLiteral(node, sourceFile, file, options, findings);
    checkConsoleLog(node, sourceFile, file, options, findings);
    checkTimestampsSpread(node, sourceFile, file, options, findings);
    checkCoerce(node, sourceFile, file, options, findings);
    checkManualResponse(node, sourceFile, file, options, findings);
    checkAdminRoleBranch(node, sourceFile, file, options, findings);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkImportSpecifier(node, sourceFile, file, options, findings) {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return;
  }
  const specifier = node.moduleSpecifier?.text;
  if (typeof specifier !== 'string') {
    return;
  }
  const isLocal = specifier.startsWith('.') || specifier.startsWith('@/');
  if (!isLocal) {
    return;
  }
  const line = lineOf(node, sourceFile);
  if (!specifier.endsWith('.js')) {
    addFinding(findings, options, 'import-suffix', file, line, `导入缺少 .js 后缀：${specifier}`);
  }
  if (specifier.includes('../../')) {
    addFinding(findings, options, 'cross-dir-relative', file, line, `跨目录相对导入：${specifier}`);
  }
}

function checkRoleLiteral(node, sourceFile, file, options, findings) {
  if (isExempt(file, ROLE_RULE_EXEMPT_PREFIXES)) {
    return;
  }
  const line = lineOf(node, sourceFile);

  if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) {
    for (const side of [node.left, node.right]) {
      if (ts.isPropertyAccessExpression(side) && ['role', 'roles'].includes(side.name.text)) {
        addFinding(findings, options, 'role-literal', file, line, `散落的角色判断：${node.getText(sourceFile).replace(/\s+/g, ' ')}`);
      }
    }
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const object = node.expression.expression;
    const method = node.expression.name.text;
    if (ts.isIdentifier(object) && object.text === 'roles' && ['includes', 'some', 'every'].includes(method)) {
      addFinding(findings, options, 'role-literal', file, line, `散落的角色判断：${node.getText(sourceFile).replace(/\s+/g, ' ')}`);
    }
  }
}

function checkConsoleLog(node, sourceFile, file, options, findings) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return;
  }
  const owner = node.expression.expression;
  if (ts.isIdentifier(owner) && owner.text === 'console' && node.expression.name.text === 'log') {
    addFinding(findings, options, 'console-log', file, lineOf(node, sourceFile), 'console.log 不进日志文件，也没有 traceId');
  }
}

function checkTimestampsSpread(node, sourceFile, file, options, findings) {
  const isSpread = ts.isSpreadElement(node) || ts.isSpreadAssignment(node);
  if (!isSpread || !ts.isIdentifier(node.expression) || node.expression.text !== 'timestamps') {
    return;
  }
  addFinding(findings, options, 'timestamps-spread', file, lineOf(node, sourceFile), '写成 `...timestamps`（少了调用），列 builder 会被多表共享');
}

function checkCoerce(node, sourceFile, file, options, findings) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return;
  }
  const callee = node.expression.getText(sourceFile);
  const line = lineOf(node, sourceFile);
  if (callee === 'z.coerce.boolean') {
    addFinding(findings, options, 'coerce-boolean', file, line, "`z.coerce.boolean()` 会把 'false' 判成 true");
  }
  if (callee === 'z.coerce.number' && /params\.dto\.ts$/.test(file)) {
    addFinding(findings, options, 'coerce-number-param', file, line, '路径参数用 z.coerce.number()，空值会被误报成 Too small');
  }
}

function checkManualResponse(node, sourceFile, file, options, findings) {
  if (!file.endsWith('.controller.ts') || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return;
  }
  const owner = node.expression.expression;
  const method = node.expression.name.text;
  if (ts.isIdentifier(owner) && ['res', 'response'].includes(owner.text) && ['status', 'json', 'send', 'end'].includes(method)) {
    addFinding(findings, options, 'manual-response', file, lineOf(node, sourceFile), `Controller 手写响应：${node.getText(sourceFile).replace(/\s+/g, ' ')}`);
  }
}

function checkAdminRoleBranch(node, sourceFile, file, options, findings) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'isAdmin') {
    return;
  }
  if (isExempt(file, ADMIN_BRANCH_EXEMPT_PREFIXES) || ADMIN_BRANCH_EXEMPT_FILES.has(path.basename(file))) {
    return;
  }
  addFinding(
    findings,
    options,
    'admin-role-branch',
    file,
    lineOf(node, sourceFile),
    '用 isAdmin() 决定"能不能操作别人的资源"：新增角色就要改业务代码；应改为按权限码判定',
  );
}

function isEqualityOperator(kind) {
  return [
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ].includes(kind);
}

function lineOf(node, sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function formatRuleList() {
  const lines = [`规则 ${RULE_IDS.length} 条：`];
  for (const id of RULE_IDS) {
    lines.push(`  ${id.padEnd(22)} ${RULE_META[id].section.padEnd(5)} ${RULE_META[id].title}`);
  }
  return lines.join('\n');
}

function formatHumanReport(result, options) {
  if (result.violationCount === 0) {
    return `规范审计通过：扫描 ${result.scannedFiles} 个文件，0 处违规\n${padExitCode(result.exitCode)}`;
  }

  const grouped = new Map();
  for (const violation of result.violations) {
    if (!grouped.has(violation.rule)) {
      grouped.set(violation.rule, []);
    }
    grouped.get(violation.rule).push(violation);
  }

  const lines = [`规范审计未通过：扫描 ${result.scannedFiles} 个文件，发现 ${result.violationCount} 处违规`, ''];
  for (const ruleId of RULE_IDS) {
    const violations = grouped.get(ruleId);
    if (!violations) {
      continue;
    }
    const meta = RULE_META[ruleId];
    lines.push(`[${ruleId}] ${meta.section} ${meta.title}（${violations.length} 处）`);
    for (const violation of violations) {
      lines.push(`  ${violation.file}:${violation.line}`);
      lines.push(`      ${violation.detail}`);
    }
    if (!options.quiet) {
      lines.push(`    建议：${meta.suggest}`);
    }
    lines.push('');
  }
  lines.push(padExitCode(result.exitCode));
  return lines.join('\n');
}

function padExitCode(exitCode) {
  return `                                        退出码 ${exitCode}`;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CliArgumentError) {
      process.stderr.write(`参数错误：${message}\n\n${USAGE}\n`);
    } else {
      process.stderr.write(`规范审计失败：${message}\n`);
    }
    process.exitCode = 2;
  });

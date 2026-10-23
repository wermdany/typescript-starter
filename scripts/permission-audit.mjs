import process from 'node:process';

import { scanRoutes } from './lib/scan-routes.mjs';

const USAGE = `用法：node scripts/permission-audit.mjs [选项]

选项：
  --root=<dir>       覆盖扫描根目录（默认：src）
  --strict-conflict  将 RequirePermission/OwnerOrPermission 冲突计为失败
  --json             输出可供机器读取的 JSON
  --list-codes       只输出扫描到的静态权限码
  --quiet            人类可读报告中省略逐条问题
  -h, --help         显示帮助`;

class CliArgumentError extends Error {}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const scan = await scanRoutes({ root: options.root });
  const audit = buildAuditResult(scan, options);

  if (options.json) {
    const output = options.listCodes
      ? {
          schemaVersion: 1,
          root: audit.root,
          permissionCodes: audit.permissionCodes,
          count: audit.permissionCodes.length,
          passed: audit.passed,
          exitCode: audit.exitCode,
        }
      : audit;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else if (options.listCodes) {
    process.stdout.write(`${formatPermissionCodes(audit.permissionCodes)}\n`);
  } else {
    process.stdout.write(`${formatHumanReport(audit, options)}\n`);
  }

  return audit.exitCode;
}

function parseArguments(args) {
  const options = {
    root: 'src',
    strictConflict: false,
    json: false,
    listCodes: false,
    quiet: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === '--strict-conflict') {
      options.strictConflict = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--list-codes') {
      options.listCodes = true;
    } else if (argument === '--quiet') {
      options.quiet = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--root=')) {
      const root = argument.slice('--root='.length).trim();
      if (root.length === 0) {
        throw new CliArgumentError('--root 不能为空');
      }
      options.root = root;
    } else {
      throw new CliArgumentError(`未知参数：${argument}`);
    }
  }

  return options;
}

function buildAuditResult(scan, options) {
  const routes = scan.routes.map((route) => ({
    ...route,
    status: routeStatus(route),
  }));
  const tracked = routes.filter(
    (route) => route.tracking?.valid && route.errors.length === 0,
  ).length;
  const untracked = routes.filter((route) => route.tracking === null).length;
  const misuse = routes.filter((route) => route.errors.length > 0).length;
  const warnings = routes.reduce(
    (count, route) => count + route.warnings.length,
    0,
  );
  const conflicts = routes.filter((route) => route.hasConflict).length;

  const failureReasons = [];
  if (untracked > 0) {
    failureReasons.push(`${untracked} 条路由未追踪`);
  }
  if (misuse > 0) {
    failureReasons.push(`${misuse} 处装饰器误用`);
  }
  if (options.strictConflict && conflicts > 0) {
    failureReasons.push(`${conflicts} 处标记冲突（strict-conflict）`);
  }

  const exitCode = failureReasons.length > 0 ? 1 : 0;
  return {
    schemaVersion: 1,
    root: scan.root,
    options: {
      strictConflict: options.strictConflict,
    },
    summary: {
      scannedFiles: scan.scannedFiles,
      controllers: scan.controllers,
      routes: routes.length,
      tracked,
      untracked,
      misuse,
      warnings,
      conflicts,
    },
    permissionCodes: scan.permissionCodes,
    routes,
    failureReasons,
    passed: exitCode === 0,
    exitCode,
  };
}

function routeStatus(route) {
  if (route.errors.length > 0) {
    return 'misuse';
  }
  if (route.tracking === null) {
    return 'untracked';
  }
  return 'tracked';
}

function formatHumanReport(audit, options) {
  const { summary } = audit;
  const lines = [
    `权限点追踪审计 · 扫描 ${summary.scannedFiles} 个文件 / ${summary.controllers} 个控制器 / ${summary.routes} 条路由`,
  ];
  const findingLines = [];

  if (!options.quiet) {
    for (const route of audit.routes) {
      appendRouteFindings(findingLines, route, options);
    }
  }
  if (findingLines.length > 0) {
    lines.push(
      '────────────────────────────────────────────────────────────────────',
      ...findingLines,
    );
  }

  lines.push(
    '────────────────────────────────────────────────────────────────────',
    `汇总   路由 ${summary.routes} · 已追踪 ${summary.tracked} · 未追踪 ${summary.untracked} · 误用 ${summary.misuse} · 告警 ${summary.warnings}`,
    formatPermissionCodes(audit.permissionCodes),
  );

  if (audit.passed) {
    lines.push(`✔ 全部路由均已追踪并通过校验${padExitCode(0)}`);
  } else {
    lines.push(
      `✖ ${audit.failureReasons.join(' + ')}（pnpm perm:audit 失败）${padExitCode(1)}`,
    );
  }
  return lines.join('\n');
}

function appendRouteFindings(lines, route, options) {
  const location = `${route.file}:${route.markerLine ?? route.line}`;
  const routeLine = `    ${route.httpMethod.padEnd(7)} ${route.path.padEnd(42)} ${route.methodName}${route.marker ? `   ${route.marker}` : ''}`;

  if (route.status === 'untracked') {
    lines.push(
      `[未追踪] ${route.file}:${route.line}`,
      routeLine,
      '    理由：既无 @RequirePermission / @OwnerOrPermission / @Public / @Authenticated；修复：按路由语义补充显式标记',
    );
  }

  if (route.errors.length > 0) {
    lines.push(
      `[误用]   ${location}`,
      routeLine,
      `    理由：${route.errors.map((issue) => issue.reason).join('；')}；修复：${route.errors.map((issue) => issue.suggestion).join('；')}`,
    );
  }

  for (const warning of route.warnings) {
    const isStrictConflict =
      warning.code === 'owner-require-conflict' && options.strictConflict;
    const label = isStrictConflict ? '[冲突]' : '[告警]';
    lines.push(
      `${label.padEnd(6)} ${route.file}:${warning.line}`,
      routeLine,
      `    提示：${warning.reason}；建议：${warning.suggestion}${isStrictConflict ? '；strict-conflict 已将其计入失败' : ''}`,
    );
  }
}

function formatPermissionCodes(permissionCodes) {
  if (permissionCodes.length === 0) {
    return '权限码 0 个：—';
  }
  return `权限码 ${permissionCodes.length} 个：${permissionCodes.join('、')}`;
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
      process.stderr.write(`权限点追踪审计失败：${message}\n`);
    }
    process.exitCode = 2;
  });

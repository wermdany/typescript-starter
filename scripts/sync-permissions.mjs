import process from 'node:process';

import {
  DbConfigError,
  DbConnectionError,
  connect,
  describeTarget,
  loadDatabaseUrl,
} from './lib/db.mjs';
import { scanRoutes } from './lib/scan-routes.mjs';

const USAGE = `用法：node scripts/sync-permissions.mjs [选项]

把路由上静态声明的权限码幂等同步进 permissions 表（方案 §5.5 #18）。

选项：
  --dry-run          只报告将执行的动作，不写库（不连库也能跑）
  --json             输出可供机器读取的 JSON
  --quiet            人类可读报告中省略逐条明细
  -h, --help         显示帮助

退出码：0 成功 / 1 校验失败（如扫描到 0 个权限码）/ 2 环境或连接错误`;

/** `permissions.code` 是 varchar(64)、`group` 是 varchar(32)：超长会在 INSERT 时炸库，先本地拦住 */
const MAX_CODE_LENGTH = 64;
const MAX_GROUP_LENGTH = 32;
/** 通配权限由种子迁移维护，脚本不推导它的分组，但仍要能识别 */
const WILDCARD_CODE = '*';
const WILDCARD_GROUP = 'system';
/** 新行的说明统一标注来源，方便管理端区分"手写"与"从路由同步来的" */
const AUTO_DESCRIPTION = '由 pnpm perm:sync 从路由权限标记自动同步';

class CliArgumentError extends Error {}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const scan = await scanRoutes({ root: 'src' });
  const staticCodes = scan.permissionCodes;
  // 动态码只统计不写库：写入空串/占位符会污染权限码表，运行时表现为谁都过不了
  const dynamicCodes = [
    ...new Set(scan.routes.flatMap((route) => route.dynamicPermissionCodes)),
  ].sort((left, right) => left.localeCompare(right));

  const codeIndex = buildCodeIndex(scan.routes);
  const problems = staticCodes.flatMap((code) =>
    validateCode(code).map((problem) => ({
      ...problem,
      // 权限码本身不带出处，报告里补上「哪个路由声明了它」才修得动
      source: codeIndex.get(code) ?? null,
    })),
  );
  const audit = {
    schemaVersion: 1,
    root: scan.root,
    dryRun: options.dryRun,
    scannedFiles: scan.scannedFiles,
    routes: scan.routes.length,
    permissionCodes: staticCodes,
    dynamicPermissionCodes: dynamicCodes,
    problems,
    plans: [],
    database: null,
    notes: [],
  };

  if (problems.length > 0) {
    audit.passed = false;
    audit.exitCode = 1;
    emit(audit, options);
    return audit.exitCode;
  }

  if (staticCodes.length === 0) {
    // 0 个码几乎一定是扫描根或判定逻辑坏了，静默"同步成功"会让权限表悄悄失效
    audit.notes.push(
      '扫描到 0 个静态权限码：请检查 -- 扫描根是否为 src、路由是否已打 @RequirePermission / @OwnerOrPermission',
    );
    audit.passed = false;
    audit.exitCode = 1;
    emit(audit, options);
    return audit.exitCode;
  }

  const sessions = await openDatabase(options);
  audit.database = sessions.info;
  audit.notes.push(...sessions.notes);

  if (sessions.db) {
    try {
      const existing = await readExisting(sessions.db, staticCodes);
      audit.plans = planFromDatabase(staticCodes, existing);
      if (!options.dryRun) {
        await applyPlan(sessions.db, audit.plans);
      }
    } finally {
      await sessions.db.close();
    }
  } else {
    // dry-run 且连不上库：仍要给出「将 upsert 哪些码」，只是状态未知
    audit.plans = staticCodes.map((code) => ({
      code,
      group: groupOf(code),
      action: 'planned',
    }));
  }

  audit.summary = summarize(audit.plans, staticCodes, dynamicCodes);
  audit.passed = true;
  audit.exitCode = 0;
  emit(audit, options);
  return audit.exitCode;
}

function parseArguments(args) {
  const options = {
    dryRun: false,
    json: false,
    quiet: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--quiet') {
      options.quiet = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new CliArgumentError(`未知参数：${argument}`);
    }
  }

  return options;
}

/**
 * 打开数据库；`--dry-run` 下连不上不算失败。
 *
 * 取舍：dry-run 的用途是"CI 里无库也能跑"，所以配置/连接错误在这里降级为提示，
 * 库里能连上时则照常给出 新增/复活/未变 的真实分类（只读不写）。
 */
async function openDatabase(options) {
  try {
    const target = describeTarget(loadDatabaseUrl());
    const db = await connect();
    return {
      db,
      info: { target, connected: true },
      notes: [],
    };
  } catch (error) {
    if (!options.dryRun) {
      throw error;
    }
    if (
      !(error instanceof DbConfigError) &&
      !(error instanceof DbConnectionError)
    ) {
      throw error;
    }
    return {
      db: null,
      info: { target: null, connected: false, reason: error.message },
      notes: ['dry-run 未连库：只列出将 upsert 的权限码，库内状态未查询'],
    };
  }
}

function buildCodeIndex(routes) {
  const index = new Map();
  for (const route of routes) {
    for (const code of route.permissionCodes) {
      if (!index.has(code)) {
        index.set(
          code,
          `${route.file}:${route.markerLine ?? route.line} ${route.httpMethod} ${route.path}`,
        );
      }
    }
  }
  return index;
}

function validateCode(code) {
  const problems = [];
  if (code.length > MAX_CODE_LENGTH) {
    problems.push({
      code,
      reason: `权限码超过 ${MAX_CODE_LENGTH} 字符（permissions.code 是 varchar(${MAX_CODE_LENGTH})）`,
      suggestion: '缩短资源前缀或换成缩写，再跑 pnpm perm:audit 确认',
    });
  }

  if (code === WILDCARD_CODE) {
    return problems;
  }

  const separatorIndex = code.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === code.length - 1) {
    problems.push({
      code,
      reason: '权限码必须是「资源:动作」形式（如 user:read）',
      suggestion: '按 <资源>:<动作> 命名，例如 user:read',
    });
    return problems;
  }

  const group = groupOf(code);
  if (group.length > MAX_GROUP_LENGTH) {
    problems.push({
      code,
      reason: `分组 ${group} 超过 ${MAX_GROUP_LENGTH} 字符（permissions.group 是 varchar(${MAX_GROUP_LENGTH})）`,
      suggestion: '把资源名收敛到 32 字符内，动作差异放到冒号右侧',
    });
  }

  return problems;
}

/** 分组 = 权限码里 `:` 之前的段：`login-log:read` → `login-log` */
function groupOf(code) {
  if (code === WILDCARD_CODE) {
    return WILDCARD_GROUP;
  }
  const separatorIndex = code.indexOf(':');
  return separatorIndex > 0 ? code.slice(0, separatorIndex) : 'general';
}

async function readExisting(db, codes) {
  return db.query(
    'SELECT code, "group", deleted_at FROM permissions WHERE code = ANY($1::text[])',
    [codes],
  );
}

/**
 * 对比「扫描到的码」与「库里的行」，得出每条待执行动作。
 *
 * 单独做这一步而不是直接 upsert，是因为报告要区分 新增 / 复活 / 未变 ——
 * 光靠 `ON CONFLICT` 的返回值分不出来。写库仍然走 upsert，保证并发下也收敛。
 */
function planFromDatabase(codes, existingRows) {
  const existingByCode = new Map(existingRows.map((row) => [row.code, row]));

  return codes.map((code) => {
    const group = groupOf(code);
    const existing = existingByCode.get(code);
    if (!existing) {
      return { code, group, action: 'insert' };
    }
    if (existing.deleted_at) {
      // 软删后 code 仍被列级唯一约束占着，只有复活才能重新加回来
      return { code, group, action: 'revive' };
    }
    if (existing.group !== group) {
      return { code, group, action: 'regroup' };
    }
    return { code, group, action: 'unchanged' };
  });
}

async function applyPlan(db, plans) {
  await db.query('BEGIN');
  try {
    for (const plan of plans) {
      if (plan.action === 'insert') {
        await db.query(
          `INSERT INTO permissions (code, name, description, "group")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO UPDATE SET
             deleted_at = NULL,
             "group" = EXCLUDED."group",
             updated_at = now()`,
          [plan.code, plan.code, AUTO_DESCRIPTION, plan.group],
        );
      } else if (plan.action === 'revive') {
        await db.query(
          `UPDATE permissions
              SET deleted_at = NULL, "group" = $2, updated_at = now()
            WHERE code = $1`,
          [plan.code, plan.group],
        );
      } else if (plan.action === 'regroup') {
        await db.query(
          'UPDATE permissions SET "group" = $2, updated_at = now() WHERE code = $1',
          [plan.code, plan.group],
        );
      }
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function summarize(plans, staticCodes, dynamicCodes) {
  const count = (action) =>
    plans.filter((plan) => plan.action === action).length;
  return {
    staticCodes: staticCodes.length,
    dynamicSkipped: dynamicCodes.length,
    insert: count('insert'),
    revive: count('revive'),
    regroup: count('regroup'),
    unchanged: count('unchanged'),
    planned: count('planned'),
  };
}

function emit(audit, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatHumanReport(audit, options)}\n`);
}

function formatHumanReport(audit, options) {
  const lines = [
    `权限码同步 · 扫描 ${audit.scannedFiles} 个文件 / ${audit.routes} 条路由${audit.dryRun ? ' · dry-run' : ''}`,
  ];
  const detailLines = [];

  // 误用明细不随 --quiet 隐藏：它是失败原因，藏起来等于让人猜为什么退出 1
  for (const problem of audit.problems) {
    detailLines.push(
      `[误用]   ${problem.code}${problem.source ? `   ${problem.source}` : ''}`,
      `    理由：${problem.reason}；修复：${problem.suggestion}`,
    );
  }

  if (!options.quiet) {
    for (const plan of audit.plans) {
      // dry-run 的用途是"肉眼确认要同步哪些码"，此时连未变的也列出来
      if (plan.action === 'unchanged' && !audit.dryRun) {
        continue;
      }
      detailLines.push(
        `[${actionLabel(plan.action)}]   ${plan.code.padEnd(28)} 分组 ${plan.group}`,
      );
    }
    for (const code of audit.dynamicPermissionCodes) {
      detailLines.push(
        `[告警]   ${code}`,
        '    提示：动态权限码无法静态取值，已跳过（不写入空串/占位符）；请改为字符串字面量',
      );
    }
  }
  if (detailLines.length > 0) {
    lines.push(divider(), ...detailLines);
  }

  const summary = audit.summary;
  lines.push(
    divider(),
    summary
      ? `汇总   路由 ${audit.routes} · 静态码 ${summary.staticCodes} · 动态码跳过 ${summary.dynamicSkipped} · 新增 ${summary.insert} · 复活 ${summary.revive} · 分组 ${summary.regroup} · 未变 ${summary.unchanged}${summary.planned > 0 ? ` · 计划 ${summary.planned}` : ''}`
      : `汇总   路由 ${audit.routes} · 静态码 ${audit.permissionCodes.length} · 动态码跳过 ${audit.dynamicPermissionCodes.length} · 未执行同步（校验失败）`,
    formatTarget(audit),
  );

  for (const note of audit.notes) {
    lines.push(`注意   ${note}`);
  }

  lines.push(
    audit.passed
      ? audit.dryRun
        ? `✔ dry-run 完成，未写库${padExitCode(0)}`
        : `✔ 已同步 ${audit.permissionCodes.length} 个权限码${padExitCode(0)}`
      : `✖ 同步未执行${padExitCode(1)}`,
  );
  return lines.join('\n');
}

function actionLabel(action) {
  if (action === 'insert') {
    return '新增';
  }
  if (action === 'revive') {
    return '复活';
  }
  if (action === 'regroup') {
    return '分组';
  }
  if (action === 'unchanged') {
    return '未变';
  }
  return '计划';
}

function formatTarget(audit) {
  const database = audit.database;
  if (!database?.connected) {
    const reason = database?.reason ? `（${database.reason}）` : '';
    return `目标   未连接数据库${reason}`;
  }
  const mode = audit.dryRun ? 'dry-run 未写库' : '已提交事务';
  return `目标   ${database.target}（${mode}）`;
}

function divider() {
  return '────────────────────────────────────────────────────────────────────';
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
    } else if (
      error instanceof DbConfigError ||
      error instanceof DbConnectionError
    ) {
      process.stderr.write(`环境错误：${message}\n`);
    } else {
      process.stderr.write(`权限码同步失败：${message}\n`);
    }
    process.exitCode = 2;
  });

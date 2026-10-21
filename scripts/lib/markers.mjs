/*
 * 脚本只做 AST 静态识别，下面是它已知识别不到的面（原文见 docs/rbac-plan.md §5.5，
 * §5.5 是唯一权威来源；新增发现请追加编号并同步写回文档，不要在此单独维护）。
 *
 * | #  | 边界情况 | 后果 | 缓解 |
 * | --- | --- | --- | --- |
 * | 1  | 装饰器别名导入（`import { RequirePermission as ReqPerm }`） | 漏判（当成未追踪） | 约定禁用别名；脚本可在报告中列"疑似未识别装饰器"辅助人工确认 |
 * | 2  | 装饰器间接引用（`const d = RequirePermission; @d('x')`） | 漏判 | 同上；要解引用就得起类型检查器（成本高，不做） |
 * | 3  | 权限码用常量/模板串（`@RequirePermission(PERM.userCreate)`） | 记为 ⚠️ 动态权限码（已追踪但不可静态取值） | 约定权限码必须是字面量；该告警本身就是提醒 |
 * | 4  | 跨文件继承的基类 Controller（基类里定义 HTTP 方法） | 漏报（本类看不到基类成员） | 约定：HTTP 方法必须写在带 `@Controller()` 的类里，禁止抽象基类控制器 |
 * | 5  | 一条 handler 上叠多个 HTTP 装饰器 | 逐条分别判定，报告中体现 | 无需处理 |
 * | 6  | 模板串/常量拼接的路由路径 | 路径显示为 `<动态路径:...>`，不影响追踪判定 | — |
 * | 7  | `__tests__` 里的假 Controller | 已排除目录 ⇒ 不误报 | 靠目录白名单，不要改成靠"是否被 import"判断 |
 * | 8  | 类级 `@Public()` + 方法无标记 | 方法被判为 public（与运行时一致）⇒ 不报错但值得警惕 | 可选 `--warn-inherited` 给出提示，不计入失败（避免噪音） |
 * | 9  | `@SkipTransform()`、`@HttpCode()`、`@ApiMessage()` 等无关装饰器 | 忽略 | — |
 * | 10 | 非 HTTP 通道（WS / gRPC / Cron / `@MessagePattern`） | 不在范围内 | 将来若要支持，另写一个 `--mode=ws` 的 collector |
 * | 11 | `@OwnerOrPermission` 的 ownerParam 与类级 `@Controller('users/:userId')` 里的参数同名 | C1 需要合并类前缀后再解析参数名，否则误报 | 合并 `@Controller(prefix) + @Get(path)` 后统一提取 `:xxx` |
 * | 12 | 路由用通配符（`@Get('*')` / 正则路由） | 参数列表不敢断言 → C1 放宽为 warn | 路径含 `*` 或 `(` 时降级为提示 |
 * | 13 | ownerParam 指向的不是用户 ID（未来扩展到 session 等资源） | 守卫会把 `actor.id` 与业务 ID 比较 ⇒ 语义错误 | 约定 ownerParam 只能指向用户 ID；其他资源走 service 断言（§10.2） |
 * | 14 | `@OwnerOrPermission` 与 `@AdminOnly()` 并存 | 语义以 Owner 优先，容易让人困惑 | 校验 C3 扩展：与遗留标记并存时输出提示，建议先升级 `@AdminOnly()` |
 * | 15 | ① 数组形态路由（`@Get(['a', 'b'])`，Nest 支持 `string[]` path）；② 对象形态（`@Controller({ path: 'users' })`） | ① 一条 handler 展开成多个端点，少算即漏判；② 不会展开，风险是类前缀藏在对象字面量里取不到 | ① 展开后逐条判定与计数；② 从对象字面量的 `path` 属性取前缀，取不到按 `<动态路径:...>` 显示（**路径显示不改变追踪判定**，别把它做成失败项） |
 * | 16 | 只按装饰器最终名称识别，无模块解析 | 同名本地装饰器会被误判为标记 | 约定标记装饰器只从 `@/shared/auth.js` 取；脚本可在"疑似未识别装饰器"里列出可疑来源供人工确认（与 #1 对齐） |
 * | 17 | 报告「扫描 N 个文件」的口径 | 读者会以为 `N` 随工程/脚本数量漂移 | `N` = 扫描根下递归到的 `.ts` 文件数：排除 `__tests__/`、`dist/`、`node_modules/` 与 `*.d.ts`，`.mjs`（脚本自身）不在口径内；加脚本不会让 `N` 变化 |
 * | 18 | `perm:sync` 把扫描到的权限码写回 `permissions` 表时（T07） | 动态权限码（`PERM.xxx` 这类非字面量，见 #3）若被取用，会写入空串/占位符 ⇒ 污染权限码表并在运行时表现为"谁都过不了" | sync 只消费扫描结果里的静态码集合（`scan-routes.mjs` 已把静态码与 `dynamicPermissionCodes` 分开返回，不要重实现提取逻辑）；动态码显式跳过并在报告里计数告警 |
 *
 * 实现补记：上述判定统一走 `analyzeRouteMarkers()` 单一出口，`perm:sync` / `perm:matrix`
 * 复用同一语义，不再各写一套；`perm:matrix --check` 需先按「角色 code + 权限码」稳定
 * 排序再 diff，否则顺序抖动会让 CI 误报漂移。
 *
 * 新增发现继续追加编号（#19…）并同步写回 `docs/rbac-plan.md` §5.5。
 * 新增用例前先看这里：能命中上述任一面的写法请主动规避。
 */

export const MARKER_NAMES = Object.freeze({
  controller: 'Controller',
  public: 'Public',
  authenticated: 'Authenticated',
  permission: 'RequirePermission',
  owner: 'OwnerOrPermission',
  legacy: 'AdminOnly',
  tracking: new Set([
    'Public',
    'Authenticated',
    'RequirePermission',
    'OwnerOrPermission',
    'AdminOnly',
  ]),
});

export const HTTP_DECORATOR_METHODS = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Head', 'HEAD'],
  ['Options', 'OPTIONS'],
  ['All', 'ALL'],
]);

/**
 * 按方法优先、类级回落的规则分析一条路由的权限标记。
 *
 * 这里集中全部判定规则，后续同步权限码和渲染矩阵时可复用同一语义，避免各入口
 * 分别维护一套容易漂移的条件分支。
 *
 * @param {{ classMarkers: object[], methodMarkers: object[], routePath: object }} input 路由上下文。
 * @returns {object} 路由的追踪类型、权限码、误用和告警。
 */
export function analyzeRouteMarkers({
  classMarkers,
  methodMarkers,
  routePath,
}) {
  const markers = resolveEffectiveMarkers(classMarkers, methodMarkers);
  if (markers.length === 0) {
    return {
      markerLevel: 'none',
      tracking: null,
      marker: null,
      markerLine: null,
      permissionCodes: [],
      dynamicPermissionCodes: [],
      errors: [],
      warnings: [],
      hasConflict: false,
    };
  }

  const errors = [];
  const warnings = [];
  const permissionCodes = new Set();
  const dynamicPermissionCodes = [];
  const byName = groupMarkersByName(markers);
  const permissionMarkers = byName.get(MARKER_NAMES.permission) ?? [];
  const ownerMarkers = byName.get(MARKER_NAMES.owner) ?? [];
  const legacyMarkers = byName.get(MARKER_NAMES.legacy) ?? [];

  for (const marker of permissionMarkers) {
    analyzePermissionMarker({
      marker,
      errors,
      warnings,
      permissionCodes,
      dynamicPermissionCodes,
    });
  }
  for (const marker of ownerMarkers) {
    analyzeOwnerMarker({
      marker,
      routePath,
      errors,
      warnings,
      permissionCodes,
      dynamicPermissionCodes,
    });
  }

  const conflictMarker = ownerMarkers.find((ownerMarker) =>
    permissionMarkers.some(
      (permissionMarker) => permissionMarker.level === ownerMarker.level,
    ),
  );
  const hasConflict = conflictMarker !== undefined;
  if (conflictMarker) {
    warnings.push({
      code: 'owner-require-conflict',
      line: conflictMarker.line,
      reason:
        'C3：同一方法或类上同时存在 @RequirePermission 与 @OwnerOrPermission，语义以 @OwnerOrPermission 优先',
      suggestion:
        '移除 @RequirePermission，把非本人所需权限码保留在 @OwnerOrPermission 中',
    });
  }

  if (ownerMarkers.length > 0 && legacyMarkers.length > 0) {
    const marker = ownerMarkers[0];
    warnings.push({
      code: 'owner-admin-coexist',
      line: marker.line,
      reason:
        '@OwnerOrPermission 与 @AdminOnly 并存，审计按 Owner 优先，但运行时仍可能受到遗留管理员限制',
      suggestion: '先移除或升级 @AdminOnly，避免两套权限语义叠加',
    });
  }

  const selectedMarker = selectTrackingMarker(byName);
  const tracking = selectedMarker
    ? {
        kind: trackingKind(selectedMarker.name),
        valid: errors.length === 0,
        legacy: selectedMarker.name === MARKER_NAMES.legacy,
      }
    : null;

  return {
    markerLevel: selectedMarker?.level ?? 'none',
    tracking,
    marker: selectedMarker?.text ?? null,
    markerLine: selectedMarker?.line ?? null,
    permissionCodes: [...permissionCodes].sort((left, right) =>
      left.localeCompare(right),
    ),
    dynamicPermissionCodes,
    errors,
    warnings,
    hasConflict,
  };
}

function resolveEffectiveMarkers(classMarkers, methodMarkers) {
  const resolved = [];
  for (const name of MARKER_NAMES.tracking) {
    const methodMatches = methodMarkers.filter(
      (marker) => marker.name === name,
    );
    const sourceMarkers =
      methodMatches.length > 0
        ? methodMatches.map((marker) => ({ ...marker, level: 'method' }))
        : classMarkers
            .filter((marker) => marker.name === name)
            .map((marker) => ({ ...marker, level: 'class' }));
    resolved.push(...sourceMarkers);
  }
  return resolved;
}

function groupMarkersByName(markers) {
  const grouped = new Map();
  for (const marker of markers) {
    const values = grouped.get(marker.name) ?? [];
    values.push(marker);
    grouped.set(marker.name, values);
  }
  return grouped;
}

function analyzePermissionMarker({
  marker,
  errors,
  warnings,
  permissionCodes,
  dynamicPermissionCodes,
}) {
  if (marker.args.length === 0) {
    errors.push({
      code: 'empty-permission-arguments',
      line: marker.line,
      reason:
        '@RequirePermission() 未提供权限码，运行时会退化为登录即可，不能表达授权意图',
      suggestion:
        "提供至少一个非空字符串字面量，例如 @RequirePermission('user:read')",
    });
    return;
  }

  analyzePermissionArguments({
    args: marker.args,
    marker,
    errors,
    warnings,
    permissionCodes,
    dynamicPermissionCodes,
  });
}

function analyzeOwnerMarker({
  marker,
  routePath,
  errors,
  warnings,
  permissionCodes,
  dynamicPermissionCodes,
}) {
  const ownerArgument = marker.args[0];
  if (!ownerArgument) {
    errors.push({
      code: 'missing-owner-param',
      line: marker.line,
      reason: 'C2：@OwnerOrPermission 缺少 ownerParam',
      suggestion:
        "第一个参数传入路由中的用户 ID 参数名，例如 @OwnerOrPermission('id')",
    });
  } else if (ownerArgument.kind !== 'string') {
    errors.push({
      code: 'dynamic-owner-param',
      line: marker.line,
      reason: `C2：ownerParam 必须是字符串字面量，当前为 ${ownerArgument.text}`,
      suggestion: "直接写路由参数名，例如 @OwnerOrPermission('id')",
    });
  } else if (ownerArgument.value.length === 0) {
    errors.push({
      code: 'empty-owner-param',
      line: marker.line,
      reason: 'C2：ownerParam 不能为空字符串',
      suggestion: "改为路由中真实存在的参数名，例如 @OwnerOrPermission('id')",
    });
  } else {
    validateOwnerPath({
      ownerParam: ownerArgument.value,
      marker,
      routePath,
      errors,
      warnings,
    });
  }

  analyzePermissionArguments({
    args: marker.args.slice(1),
    marker,
    errors,
    warnings,
    permissionCodes,
    dynamicPermissionCodes,
  });
}

function validateOwnerPath({
  ownerParam,
  marker,
  routePath,
  errors,
  warnings,
}) {
  const isUnverifiable =
    routePath.kind !== 'static' ||
    routePath.value.includes('*') ||
    routePath.value.includes('(');
  if (isUnverifiable) {
    warnings.push({
      code: 'owner-path-unverifiable',
      line: marker.line,
      reason: `C1：路由 ${routePath.display} 含动态、通配符或正则片段，无法静态确认 ownerParam '${ownerParam}'`,
      suggestion: '人工确认该路径在运行时会提供同名用户 ID 参数',
    });
    return;
  }

  const routeParams = new Set(
    [...routePath.value.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]),
  );
  if (!routeParams.has(ownerParam)) {
    const routeParamText =
      routeParams.size > 0 ? [...routeParams].join('、') : '无';
    errors.push({
      code: 'owner-param-not-in-route',
      line: marker.line,
      reason: `C1：ownerParam '${ownerParam}' 不在路由参数中（当前：${routeParamText}），线上将取不到归属人`,
      suggestion:
        routeParams.size === 1
          ? `改为 @OwnerOrPermission('${[...routeParams][0]}', ...)`
          : '改为完整路由中真实存在且代表用户 ID 的参数名',
    });
  }
}

function analyzePermissionArguments({
  args,
  marker,
  errors,
  warnings,
  permissionCodes,
  dynamicPermissionCodes,
}) {
  for (const argument of args) {
    if (argument.kind === 'string') {
      if (argument.value.length === 0) {
        errors.push({
          code: 'empty-permission-code',
          line: marker.line,
          reason: `${marker.name} 包含空权限码`,
          suggestion: '删除空参数或改为非空权限码字符串字面量',
        });
      } else {
        permissionCodes.add(argument.value);
      }
      continue;
    }

    dynamicPermissionCodes.push(argument.text);
    warnings.push({
      code: 'dynamic-permission-code',
      line: marker.line,
      reason: `${marker.name} 使用动态权限码 ${argument.text}，无法静态确定取值`,
      suggestion: '优先改为非空字符串字面量，确保权限清单可审计',
    });
  }
}

function selectTrackingMarker(byName) {
  const priority = [
    MARKER_NAMES.public,
    MARKER_NAMES.owner,
    MARKER_NAMES.permission,
    MARKER_NAMES.authenticated,
    MARKER_NAMES.legacy,
  ];
  for (const name of priority) {
    const marker = byName.get(name)?.[0];
    if (marker) {
      return marker;
    }
  }
  return null;
}

function trackingKind(markerName) {
  if (markerName === MARKER_NAMES.public) {
    return 'public';
  }
  if (markerName === MARKER_NAMES.authenticated) {
    return 'authenticated';
  }
  if (markerName === MARKER_NAMES.permission) {
    return 'permission';
  }
  if (markerName === MARKER_NAMES.owner) {
    return 'owner';
  }
  return 'legacy';
}

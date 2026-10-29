/**
 * 测试入口守卫：单元测试 / e2e 只在 CI 执行，日常开发不跑。
 *
 * 为什么用脚本拦住而不是只写在文档里：本地跑一遍 `pnpm test` 要两分钟以上，
 * 而它验证的是"全部用例仍然成立"，与"这次改动是否成立"不是同一个问题 ——
 * 后者由 typecheck / lint / perm:audit / 目标 curl 回答。测试的价值在合并前的
 * 回归，那是 CI 的职责；放回本地只会用"跑得慢"换一个"跑过了"的错觉。
 *
 * 由 `package.json` 的 `pretest` / `pretest:cov` / `pretest:e2e` 调用。
 * 放行条件：
 *   1. CI 环境（`CI=true`，GitHub Actions 自带）
 *   2. 显式覆盖 `TEST_ALLOW_LOCAL=1`（在改测试本身时才用）
 *
 * 只读：不启动进程、不写文件。
 *
 * 退出码：0 放行 / 2 环境不满足（本地且未显式覆盖）。
 * 用 2 而不是 1 —— 这不是"代码有问题"，是"这个环境不该跑测试"。
 */

import process from 'node:process';

const CI = (process.env.CI ?? '').trim().toLowerCase();
const OVERRIDE = process.env.TEST_ALLOW_LOCAL;
const ALLOWED_CI_VALUES = new Set(['1', 'true', 'yes']);

const json = process.argv.slice(2).includes('--json');
const inCi = ALLOWED_CI_VALUES.has(CI);
const overridden = OVERRIDE === '1';
const allowed = inCi || overridden;

const example = 'TEST_ALLOW_LOCAL=1 pnpm test';
const message = [
  '测试只在 CI 运行，本次已在本地拦截（scripts/test-guard.mjs）',
  '',
  '  日常开发的验证链：pnpm verify（typecheck + lint + perm:audit），',
  '  动接口时再加目标 curl。',
  '  单测 / e2e 由 GitHub Actions 在 push 与 PR 时执行，见 .github/workflows/ci.yml。',
  '',
  `  确实需要在本地跑（例如正在改测试本身）：${example}`,
].join('\n');

if (json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        allowed,
        reason: inCi ? 'ci' : overridden ? 'override' : 'local',
        example,
      },
      null,
      2,
    )}\n`,
  );
} else if (allowed) {
  process.stdout.write(
    inCi
      ? '测试守卫：CI 环境，放行。\n'
      : '测试守卫：TEST_ALLOW_LOCAL=1 显式覆盖，放行（改动提交前确认这不是常态）。\n',
  );
} else {
  process.stderr.write(`${message}\n`);
}

if (!allowed) {
  process.exitCode = 2;
}

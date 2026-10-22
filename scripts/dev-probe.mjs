/**
 * 开发服务器状态探针：一条命令拿全"现在到底能不能验"，避免反复探测。
 *
 * AGENTS.md 第 0 节要求不要重启开发服务器，但光靠 `lsof` 判断不出
 * "watch 正在重编译"还是"服务真挂了" —— 本脚本把端口、进程、产物新旧、
 * 日志尾行一次性输出，供调用方**一次**判定，而不是多轮试探。
 *
 * 只读：不启动、不重启、不 kill 任何进程。
 *
 * 退出码：0 端口在监听 / 1 端口未监听（发现问题）/ 2 参数或环境错误。
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const USAGE = `用法：node scripts/dev-probe.mjs [选项]

探测开发服务器状态（只读，不启动也不重启任何进程）。

选项：
  --port=<n>         监听端口（默认：env PORT 或 8000）
  --lines=<n>        日志尾行数（默认：5，0 表示不读日志）
  --log=<path>       日志文件路径（默认：env LOG_FILE 或 logs/app.log）
  --json             输出可供机器读取的 JSON
  -h, --help         显示帮助`;

const DEFAULT_PORT = 8000;
const DEFAULT_LOG_FILE = 'logs/app.log';
const DEFAULT_LOG_LINES = 5;
const PROBE_TIMEOUT_MS = 1500;

/** src 比 dist 新但没超过这个秒数，判定为"watch 正在重编译"。 */
const COMPILING_WINDOW_SECONDS = 15;

const EXCLUDED_DIRECTORY_NAMES = new Set(['dist', 'node_modules']);

class CliArgumentError extends Error {}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const result = await runProbe(options);
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHumanReport(result)}\n`);
  return result.exitCode;
}

function parseArguments(args) {
  const fromEnv = Number.parseInt(process.env.PORT ?? '', 10);
  const options = {
    port: Number.isInteger(fromEnv) ? fromEnv : DEFAULT_PORT,
    logFile: process.env.LOG_FILE ?? DEFAULT_LOG_FILE,
    lines: DEFAULT_LOG_LINES,
    json: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('--port=')) {
      const port = Number.parseInt(argument.slice('--port='.length).trim(), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new CliArgumentError(`--port 必须是 1~65535 的整数：${argument}`);
      }
      options.port = port;
    } else if (argument.startsWith('--lines=')) {
      const lines = Number.parseInt(argument.slice('--lines='.length).trim(), 10);
      if (!Number.isInteger(lines) || lines < 0) {
        throw new CliArgumentError(`--lines 必须是非负整数：${argument}`);
      }
      options.lines = lines;
    } else if (argument.startsWith('--log=')) {
      options.logFile = argument.slice('--log='.length).trim();
    } else {
      throw new CliArgumentError(`未知参数：${argument}`);
    }
  }

  return options;
}

async function runProbe(options) {
  const cwd = process.cwd();
  const listeners = await readListeners(options.port);
  const build = await readBuildState(cwd);
  const log = await readLogTail(path.resolve(cwd, options.logFile), options.lines);
  const listening = listeners.length > 0;

  return {
    schemaVersion: 1,
    port: options.port,
    listening,
    listeners,
    build,
    log,
    curl: `curl -s --max-time 3 --noproxy '*' -w '\\n%{http_code}' http://localhost:${options.port}/`,
    hint: buildHint(listening, build),
    exitCode: listening ? 0 : 1,
  };
}

async function readListeners(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      timeout: PROBE_TIMEOUT_MS * 2,
    });
    return parseLsof(stdout);
  } catch {
    // lsof 不存在（非 macOS/Linux）或无权限：退化成一次主动连接探测
    const reachable = await probeTcp(port);
    return reachable ? [{ pid: null, command: null, address: `127.0.0.1:${port}`, source: 'tcp-connect' }] : [];
  }
}

function parseLsof(stdout) {
  const listeners = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('COMMAND')) {
      continue;
    }
    const columns = trimmed.split(/\s+/);
    const [command, pid, , , , , , , address] = columns;
    if (!address) {
      continue;
    }
    listeners.push({
      pid: Number.parseInt(pid, 10) || null,
      command,
      address,
      source: 'lsof',
    });
  }
  return listeners;
}

function probeTcp(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function readBuildState(cwd) {
  const distEntry = path.join(cwd, 'dist', 'main.js');
  const distStat = await fs.stat(distEntry).catch(() => null);
  const srcNewest = await newestSourceMtime(path.join(cwd, 'src'));

  if (!distStat) {
    return {
      distEntry: 'dist/main.js',
      distExists: false,
      srcNewerThanDist: null,
      ageSeconds: null,
      state: 'no-dist',
    };
  }

  const distMs = distStat.mtimeMs;
  const srcMs = srcNewest?.mtimeMs ?? 0;
  const ageSeconds = Math.round((srcMs - distMs) / 1000);

  let state = 'idle';
  if (ageSeconds > 0) {
    state = ageSeconds <= COMPILING_WINDOW_SECONDS ? 'compiling' : 'stale';
  }

  return {
    distEntry: 'dist/main.js',
    distExists: true,
    srcNewerThanDist: ageSeconds > 0,
    ageSeconds,
    newestSource: srcNewest?.file ?? null,
    state,
  };
}

async function newestSourceMtime(absoluteRoot) {
  let newest = null;

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) {
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) {
        continue;
      }
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = {
          file: toPosixPath(path.relative(process.cwd(), fullPath)),
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  }

  await walk(absoluteRoot);
  return newest;
}

async function readLogTail(absolutePath, lines) {
  if (lines === 0) {
    return { path: absolutePath, exists: false, lines: [], skipped: true };
  }
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    return { path: absolutePath, exists: false, lines: [] };
  }
  const content = await fs.readFile(absolutePath, 'utf8');
  const all = content.split('\n');
  const tail = all.slice(Math.max(0, all.length - lines)).filter((line) => line.length > 0);
  return { path: absolutePath, exists: true, lines: tail };
}

function buildHint(listening, build) {
  if (!listening) {
    return '端口无监听：不要重启服务器，把下面的诊断交给用户决定（AGENTS.md 第 0 节）';
  }
  if (build.state === 'compiling') {
    return `源码比产物新 ${build.ageSeconds} 秒，watch 可能正在重编译：等 1~3 秒再请求一次，仍失败就停下问用户`;
  }
  if (build.state === 'stale') {
    return `源码比产物新 ${build.ageSeconds} 秒：watch 可能已停，产物是旧的，不要据此下结论`;
  }
  if (build.state === 'no-dist') {
    return '没有 dist/main.js 但端口在监听：服务可能是以 ts 方式运行的，按响应结果判定即可';
  }
  return '服务在监听且产物是最新的：直接发请求验证';
}

function formatHumanReport(result) {
  const lines = [`开发服务器探针：端口 ${result.port}`, ''];

  if (result.listening) {
    lines.push(`监听中：是`);
    for (const listener of result.listeners) {
      const pid = listener.pid === null ? '未知 pid' : `pid ${listener.pid}`;
      lines.push(`  ${listener.command ?? '未知进程'}（${pid}）→ ${listener.address}`);
    }
  } else {
    lines.push('监听中：否（退出码 1）');
  }

  lines.push('');
  lines.push(`产物状态：${formatBuildState(result.build)}`);
  if (result.build.newestSource) {
    lines.push(`  最新改动：${result.build.newestSource}`);
  }

  lines.push('');
  if (result.log.exists && result.log.lines.length > 0) {
    lines.push(`日志尾行（${result.log.path}）：`);
    for (const line of result.log.lines) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push(`日志尾行：无（${result.log.path} 不存在或未配置 LOG_FILE）`);
  }

  lines.push('');
  lines.push(`提示：${result.hint}`);
  lines.push(`验证命令：${result.curl}`);
  lines.push('');
  lines.push(padExitCode(result.exitCode));
  return lines.join('\n');
}

function formatBuildState(build) {
  const labels = {
    idle: '产物为最新',
    compiling: '正在重编译',
    stale: '产物已过期',
    'no-dist': '无 dist 产物',
  };
  const label = labels[build.state] ?? build.state;
  return build.ageSeconds === null ? label : `${label}（src 比 dist 新 ${build.ageSeconds} 秒）`;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
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
      process.stderr.write(`开发服务器探针失败：${message}\n`);
    }
    process.exitCode = 2;
  });

import path from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

/** `.env` 缺失 / 变量缺失：属于「配置问题」，调用方应映射为退出码 2 */
export class DbConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DbConfigError';
  }
}

/** 连接失败（服务没起、密码错、库不存在）：同样是退出码 2，但提示不同 */
export class DbConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DbConnectionError';
  }
}

/**
 * 解析数据库连接串。
 *
 * 优先用已注入的 `process.env.DATABASE_URL`（CI / `DATABASE_URL=... node ...` 场景），
 * 只有环境里没有时才回落读 `.env` —— 这样脚本不会覆盖调用方显式指定的库。
 *
 * @param {{ cwd?: string }} [options] 读取 `.env` 的基准目录。
 * @returns {string} 非空的连接串。
 */
export function loadDatabaseUrl({ cwd = process.cwd() } = {}) {
  const injected = process.env.DATABASE_URL?.trim();
  if (injected) {
    return injected;
  }

  const envPath = path.resolve(cwd, '.env');
  // quiet：dotenv 默认会往 stdout 打 "injected env"，会污染 --json 输出
  const result = dotenv.config({ path: envPath, quiet: true });
  if (result.error) {
    throw new DbConfigError(
      `未找到 .env（${envPath}）：请复制 .env.example 为 .env 并填写 DATABASE_URL`,
    );
  }

  const fromFile = process.env.DATABASE_URL?.trim();
  if (!fromFile) {
    throw new DbConfigError(
      '.env 中缺少 DATABASE_URL：请按 .env.example 补上 postgres 连接串',
    );
  }
  return fromFile;
}

/**
 * 建立单连接客户端。
 *
 * 用单连接而不是连接池：脚本是「读一遍 + 写一遍就退出」的短进程，池只会多留句柄。
 *
 * @param {{ cwd?: string }} [options] 读取 `.env` 的基准目录。
 * @returns {Promise<{
 *   client: import('pg').Client,
 *   query: (text: string, params?: unknown[]) => Promise<object[]>,
 *   close: () => Promise<void>,
 * }>} `query` 直接返回 `rows`，脚本层不必再解包 `result`。
 */
export async function connect({ cwd = process.cwd() } = {}) {
  const connectionString = loadDatabaseUrl({ cwd });
  const client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (error) {
    // 失败时立刻释放句柄，否则 Node 会因 pending socket 迟迟不退
    await client.end().catch(() => undefined);
    throw new DbConnectionError(
      `连接数据库失败：${describeError(error)}；请确认 \`docker compose up -d db\` 已启动且 DATABASE_URL 可用`,
    );
  }

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await client.end();
  };

  const query = async (text, params = []) => {
    const result = await client.query(text, params);
    return result.rows;
  };

  return { client, query, close };
}

/**
 * 把连接串转成可打印的库标识（去掉密码）。
 *
 * 报告要贴到 issue / CI 日志里，连接串里的密码不能跟着外泄。
 *
 * @param {string} connectionString `postgres://user:pass@host:port/db`。
 * @returns {string} 形如 `learn_nest@localhost:5432/learn_nest` 的标识。
 */
export function describeTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    return '(未配置连接串)';
  }
  try {
    const url = new URL(connectionString);
    const user = url.username ? `${decodeURIComponent(url.username)}@` : '';
    const database = url.pathname.replace(/^\//, '') || '(未指定库)';
    return `${user}${url.host}/${database}`;
  } catch {
    return '(无法解析的连接串)';
  }
}

/**
 * 把驱动错误压成一行可读原因。
 *
 * Node 在 `localhost` 上会同时尝试 IPv6/IPv4，失败时抛的是 `AggregateError`：
 * 它的 `message` 往往是空串，真正的原因沉在 `errors[].message` 或 `code` 里。
 *
 * @param {unknown} error 驱动抛出的错误。
 * @returns {string} 非空原因。
 */
function describeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const nested = Array.isArray(error.errors)
    ? error.errors.map((inner) => inner?.message).filter(Boolean)
    : [];
  const messages = [error.message, ...nested].filter(Boolean);
  if (messages.length > 0) {
    return messages.join('；');
  }
  return error.code ?? error.name;
}

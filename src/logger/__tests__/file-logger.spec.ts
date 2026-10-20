import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLogger } from '@/logger/file-logger.js';
import { getLogLevels } from '@/logger/log-levels.js';
import { runWithTraceId } from '@/logger/trace.js';

/** 全部级别都开启，测试落盘时不被级别过滤干扰 */
const ALL = getLogLevels('verbose');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'file-logger-'));
  // FILE LOGGER 同时会写控制台，这里静音以免污染测试输出
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('FileLogger', () => {
  it('把日志追加写入文件，并自动创建父目录', () => {
    const file = join(dir, 'nested', 'logs', 'app.log');

    const first = new FileLogger({ logLevels: ALL, filePath: file });
    first.log('第一条');
    first.close();

    // 第二个实例不应覆盖已有内容
    const second = new FileLogger({ logLevels: ALL, filePath: file });
    second.log('第二条');
    second.close();

    const content = readFileSync(file, 'utf8');
    expect(content).toContain('第一条');
    expect(content).toContain('第二条');
    expect(content).toContain('LOG');
  });

  it('写入文件时剥离 ANSI 颜色码', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({ logLevels: ALL, filePath: file });

    logger.log('\u001B[32mgreen\u001B[39m');
    logger.close();

    const content = readFileSync(file, 'utf8');
    expect(content).toContain('green');
    expect(content).not.toContain('\u001B');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('按 logLevels 过滤：最小级别为 error 时 log 不落盘', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({
      logLevels: ['error', 'fatal'],
      filePath: file,
    });

    logger.log('不该出现');
    logger.error('应该出现');
    logger.close();

    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('不该出现');
    expect(content).toContain('应该出现');
  });

  it('error(Error) 会把堆栈一并写入文件', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({ logLevels: ALL, filePath: file });

    logger.error(new Error('boom'));
    logger.close();

    const content = readFileSync(file, 'utf8');
    expect(content).toContain('boom');
    expect(content).toContain('at ');
  });

  it('不传 filePath 时只输出控制台，close() 幂等', () => {
    const logger = new FileLogger({ logLevels: ALL });

    expect(() => logger.log('only console')).not.toThrow();
    expect(() => logger.close()).not.toThrow();
    expect(() => logger.close()).not.toThrow();
  });

  it('处于请求上下文中时在消息前自动附加 traceId', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({ logLevels: ALL, filePath: file });

    runWithTraceId('t-1', () => logger.log('带上下文'));
    logger.close();

    const content = readFileSync(file, 'utf8');
    // 前置而非后置：多行消息（异常堆栈）时 traceId 才恒定落在首行
    expect(content).toContain('[traceId=t-1] 带上下文');
  });

  it('多行消息（异常堆栈）时 traceId 仍落在首行', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({ logLevels: ALL, filePath: file });

    runWithTraceId('t-2', () => logger.error('第一行\n第二行\n第三行'));
    logger.close();

    const firstLine = readFileSync(file, 'utf8').split('\n')[0];
    expect(firstLine).toContain('[traceId=t-2]');
    expect(firstLine).toContain('第一行');
  });

  it('不在请求上下文中时不附加 traceId（保持原格式）', () => {
    const file = join(dir, 'app.log');
    const logger = new FileLogger({ logLevels: ALL, filePath: file });

    logger.log('无上下文');
    logger.close();

    const content = readFileSync(file, 'utf8');
    expect(content).toContain('无上下文');
    expect(content).not.toContain('[traceId=');
  });

  it('路径不可用（父级是普通文件）时降级为仅控制台，不抛错', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');

    const logger = new FileLogger({
      logLevels: ALL,
      filePath: join(blocker, 'app.log'),
    });

    expect(() => logger.log('fallback')).not.toThrow();
    expect(() => logger.close()).not.toThrow();
    expect(existsSync(join(blocker, 'app.log'))).toBe(false);
  });
});

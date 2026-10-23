import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { getTraceId } from '@/common/context/trace.js';

/** 移除 ANSI 转义序列（颜色码），文件内容保持纯文本 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

export interface FileLoggerOptions {
  logLevels?: LogLevel[];
  /** 日志文件路径（相对路径按 cwd 解析）；不传或传空串则只输出控制台 */
  filePath?: string;
}

/**
 * 继承 ConsoleLogger：控制台输出不变，额外把每条日志追加写入文件（无 ANSI 色码）。
 *
 * - **自动附加 traceId**：处于请求上下文时每条字符串日志前补 `[traceId=...] `，
 *   控制台与文件同时生效，调用方不要手写。前置而非后缀：异常堆栈是多行的，
 *   只有前置才能恒定出现在首行
 * - **同步 fd 写**（`openSync` / `writeSync`）：进程级兜底记完 fatal 要立刻
 *   `process.exit(1)`，异步流不保证落盘。低流量服务开销可忽略
 * - **写入故障不外抛**：目录不可写、磁盘满等情况降级为仅控制台并警告一次
 */
export class FileLogger extends ConsoleLogger {
  private fileFd?: number;
  private fileDisabled = false;

  constructor({ logLevels, filePath }: FileLoggerOptions = {}) {
    super({ logLevels });
    if (!filePath) return;

    const absolutePath = resolve(filePath);
    try {
      mkdirSync(dirname(absolutePath), { recursive: true });
      this.fileFd = openSync(absolutePath, 'a');
    } catch (err) {
      this.disableFileOutput(`打开日志文件 ${absolutePath} 失败`, err);
    }
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: string,
    params?: Record<string, unknown>,
  ): void {
    // 在唯一公共入口补 traceId：控制台与文件共用这份数组。
    // 只处理字符串消息 —— error(Error) 拼进文本会破坏堆栈格式。
    const traceId = getTraceId();
    const augmented = traceId
      ? messages.map((message) =>
          typeof message === 'string'
            ? `[traceId=${traceId}] ${message}`
            : message,
        )
      : messages;

    super.printMessages(
      augmented,
      context,
      logLevel,
      writeStreamType,
      errorStack,
      params,
    );
    for (const message of augmented) {
      this.append(this.formatPlainLine(logLevel, message, context, params));
    }
  }

  protected override printStackTrace(stack?: string): void {
    // 与父类行为一致：无堆栈时不输出
    if (!stack) return;
    super.printStackTrace(stack);
    this.append(`${stripAnsi(stack)}\n`);
  }

  /** 生成不带 ANSI 颜色码的一行日志，格式与控制台一致 */
  private formatPlainLine(
    logLevel: LogLevel,
    message: unknown,
    context: string,
    params?: Record<string, unknown>,
  ): string {
    const output = this.stringifyMessage(message, logLevel);
    const paramsOutput = params ? ` ${this.stringifyParams(params)}` : '';
    const line = `${this.formatPid(process.pid)} ${this.getTimestamp()} ${logLevel.toUpperCase().padStart(7, ' ')} ${this.formatContext(context)}${output}${paramsOutput}\n`;
    return stripAnsi(line);
  }

  /** 写入一行；文件通道不可用时静默跳过（故障已报告过一次） */
  private append(text: string): void {
    if (this.fileFd === undefined || this.fileDisabled) return;
    try {
      writeSync(this.fileFd, text);
    } catch (err) {
      this.disableFileOutput('写入日志文件失败', err);
    }
  }

  /** 关闭文件句柄；幂等 */
  close(): void {
    if (this.fileFd === undefined) return;
    try {
      closeSync(this.fileFd);
    } catch {
      // 关闭失败无需上抛：进程退出时内核会回收
    }
    this.fileFd = undefined;
  }

  private disableFileOutput(reason: string, err: unknown): void {
    if (this.fileDisabled) return;
    this.fileDisabled = true;
    this.close();
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[FileLogger] ${reason}，已降级为仅控制台输出：${detail}\n`,
    );
  }
}

import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

/** 移除 ANSI 转义序列（颜色码），文件内容保持纯文本 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

export interface FileLoggerOptions {
  logLevels?: LogLevel[];
  /** 日志文件路径；不传则只输出控制台 */
  filePath?: string;
}

/**
 * 继承 ConsoleLogger：控制台行为完全不变，额外把每条日志追加写入文件。
 * 文件内容不带 ANSI 颜色码，方便 grep 和日志采集。
 */
export class FileLogger extends ConsoleLogger {
  private readonly fileStream?: WriteStream;

  constructor({ logLevels, filePath }: FileLoggerOptions = {}) {
    super({ logLevels });
    if (filePath) {
      // 父目录不存在时自动创建
      mkdirSync(dirname(filePath), { recursive: true });
      this.fileStream = createWriteStream(filePath, { flags: 'a' });
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
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, params);
    if (!this.fileStream) return;
    for (const message of messages) {
      this.fileStream.write(this.formatPlainLine(logLevel, message, context, params));
    }
  }

  protected override printStackTrace(stack?: string): void {
    // 与父类行为一致：无堆栈时不输出（error(Error 实例) 时堆栈已内嵌在消息里，stack 为 undefined）
    if (!stack) return;
    super.printStackTrace(stack);
    this.fileStream?.write(`${stripAnsi(stack)}\n`);
  }

  /** 生成不带 ANSI 颜色码的一行日志，格式与控制台输出一致 */
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

  /** 进程退出前调用，确保缓冲日志落盘 */
  close(): void {
    this.fileStream?.end();
  }
}

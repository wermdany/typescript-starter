import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { getTraceId } from './trace.js';

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
 * 继承 ConsoleLogger：控制台行为完全不变，额外把每条日志追加写入文件。
 * 文件内容不带 ANSI 颜色码，方便 grep 和日志采集。
 *
 * **自动附加 traceId**：处于请求上下文（见 `trace.ts` 的 AsyncLocalStorage）时，
 * 每条字符串日志都会在消息前补上 `[traceId=...] `，控制台与文件一处生效 ——
 * 因此拦截器/过滤器不再手写 traceId（否则会重复）。启动阶段与进程级异常
 * 不在上下文内，就不追加，保持原格式。
 *
 * **为什么是同步 fd 写（openSync / writeSync），而不是 createWriteStream：**
 * 进程级兜底 handler 记完 fatal 要立刻 `process.exit(1)`，异步流的缓冲写不保证落盘；
 * 同步写天然没有"退出丢尾部日志"的问题，也就不需要 flush / close 的时序保证
 * （pino 默认的 destination 同样是 writeSync）。本项目是低流量服务，逐行同步写的开销可忽略；
 * 日后日志量真上来了再换异步流 + 写入队列。
 *
 * **写入故障不抛给调用方：** 目录不可写、磁盘满等情况降级为"仅控制台"并只警告一次，
 * 避免日志本身成为新的故障源（也避免每行日志都抛一次错）。
 */
export class FileLogger extends ConsoleLogger {
  private fileFd?: number;
  private fileDisabled = false;

  constructor({ logLevels, filePath }: FileLoggerOptions = {}) {
    super({ logLevels });
    if (!filePath) return;

    const absolutePath = resolve(filePath);
    try {
      // 父目录不存在时自动创建；相对路径显式按 cwd 解析，避免启动方式不同时文件落到别处
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
    // 在唯一的公共入口补 traceId：super.printMessages（控制台）与下面的循环（文件）
    // 共用同一份 augmented 数组，因此控制台和文件同时生效，无需分别处理。
    // 无上下文（启动期 / 进程级异常）时保持原样。只处理字符串消息 ——
    // error(Error) 这类对象消息拼进文本反而会破坏堆栈格式。
    //
    // **前置而非后置**：异常消息/堆栈本身是多行的，拼在尾部会让 traceId 落到
    // 「最后一行」；前置则恒定出现在消息首行，`grep traceId=` 一眼能定位到事件本身。
    const traceId = getTraceId();
    const augmented = traceId
      ? messages.map((message) =>
          typeof message === 'string' ? `[traceId=${traceId}] ${message}` : message,
        )
      : messages;

    super.printMessages(augmented, context, logLevel, writeStreamType, errorStack, params);
    for (const message of augmented) {
      this.append(this.formatPlainLine(logLevel, message, context, params));
    }
  }

  protected override printStackTrace(stack?: string): void {
    // 与父类行为一致：无堆栈时不输出（error(Error 实例) 时堆栈已内嵌在消息里，stack 为 undefined）
    if (!stack) return;
    super.printStackTrace(stack);
    this.append(`${stripAnsi(stack)}\n`);
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

  /** 写入一行；文件通道不可用时静默跳过（故障已在 disableFileOutput 报告过一次） */
  private append(text: string): void {
    if (this.fileFd === undefined || this.fileDisabled) return;
    try {
      writeSync(this.fileFd, text);
    } catch (err) {
      this.disableFileOutput('写入日志文件失败', err);
    }
  }

  /** 关闭文件句柄；幂等。同步写不需要 flush，这里只是把 fd 还回去 */
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
    process.stderr.write(`[FileLogger] ${reason}，已降级为仅控制台输出：${detail}\n`);
  }
}

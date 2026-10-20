import type { LogLevel } from '@nestjs/common';

/** 严重级别从高到低 */
const VERBOSITY: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

/** 把单一最小级别展开为 ConsoleLogger 需要的 logLevels 数组 */
export function getLogLevels(minLevel: LogLevel): LogLevel[] {
  const index = VERBOSITY.indexOf(minLevel);
  if (index === -1) {
    return [...VERBOSITY];
  }
  return VERBOSITY.slice(0, index + 1);
}

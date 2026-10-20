import { describe, expect, it } from 'vitest';
import { getLogLevels } from '@/logger/log-levels.js';

describe('getLogLevels', () => {
  it('fatal 只包含自身', () => {
    expect(getLogLevels('fatal')).toEqual(['fatal']);
  });

  it('log 包含 fatal/error/warn/log', () => {
    expect(getLogLevels('log')).toEqual(['fatal', 'error', 'warn', 'log']);
  });

  it('verbose 展开全部 6 个级别', () => {
    expect(getLogLevels('verbose')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('未知级别回退为全量（防御）', () => {
    expect(getLogLevels('unknown' as never)).toHaveLength(6);
  });
});

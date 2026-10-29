import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HealthService } from '@/modules/health/health.service.js';

function setup(ping: () => Promise<void>) {
  const service = new HealthService({ ping } as never);
  return { service };
}

describe('HealthService（存活 vs 就绪）', () => {
  it('存活：不产生任何 I/O，恒返回 ok', () => {
    const ping = vi.fn(async () => undefined);
    const { service } = setup(ping);

    expect(service.check()).toEqual({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('就绪：探库通过 ⇒ ok + database ok', async () => {
    const { service } = setup(async () => undefined);

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('就绪：数据库不可达 ⇒ 503（摘流量，不是 500 也不是重启）', async () => {
    const { service } = setup(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(service.ready()).rejects.toThrow(ServiceUnavailableException);
    await expect(service.ready()).rejects.toThrow('数据库不可达');
  });
});

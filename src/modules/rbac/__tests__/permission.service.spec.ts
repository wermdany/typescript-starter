import { ForbiddenException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionService } from '@/modules/rbac/permission.service.js';

/**
 * `PermissionService` 的不变量（全部是"写错也不报错"的那一类）：
 * 多角色取并集、无角色不打库、TTL 内不重载、加载失败时 fail-closed。
 *
 * 用一个"查询构造器形状"的假 db：每次 `select()` 计一次，两条查询的用户
 * 由调用链的形态区分 —— `from().where()` 取角色，`from().innerJoin()...` 取授权。
 */
function setup(ttlSeconds = 60) {
  const state = {
    roles: [] as string[],
    grants: [] as { role: string; code: string }[],
    fail: false,
    selectCalls: 0,
  };

  const db = {
    select: vi.fn(() => {
      state.selectCalls += 1;
      return {
        from: () => ({
          where: () =>
            state.fail
              ? Promise.reject(new Error('db down'))
              : Promise.resolve(state.roles.map((code) => ({ code }))),
          innerJoin: () => ({
            innerJoin: () => ({
              where: () =>
                state.fail
                  ? Promise.reject(new Error('db down'))
                  : Promise.resolve(state.grants),
            }),
          }),
        }),
      };
    }),
  };

  const service = new PermissionService(
    { db } as never,
    { RBAC_CACHE_TTL_SECONDS: ttlSeconds } as never,
  );

  return { service, db, state };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 静音 Nest Logger，避免 fail-closed 用例把 warn 打到测试输出里 */
function silenceWarn() {
  return vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
}

describe('PermissionService（角色 → 权限码）', () => {
  it('无角色 ⇒ 空集合，且不打库（fail-closed 不该付一次查询的代价）', async () => {
    const { service, db } = setup();

    const codes = await service.resolveCodes({ roles: [] });

    expect(codes.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('多角色取并集并去重', async () => {
    const { service, state } = setup();
    state.roles = ['teacher', 'admin'];
    state.grants = [
      { role: 'teacher', code: 'user:read' },
      { role: 'admin', code: 'user:read' },
      { role: 'admin', code: 'user:delete' },
    ];

    const codes = await service.resolveCodes({ roles: ['teacher', 'admin'] });

    expect([...codes].sort()).toEqual(['user:delete', 'user:read']);
  });

  it('TTL 内复用缓存：第二次调用不产生新查询', async () => {
    const { service, state } = setup();
    state.roles = ['teacher'];
    state.grants = [{ role: 'teacher', code: 'user:read' }];

    await service.resolveCodes({ roles: ['teacher'] });
    await service.resolveCodes({ roles: ['teacher'] });

    // 一次加载 = 两条查询（角色、授权）；第二次应命中缓存
    expect(state.selectCalls).toBe(2);
  });

  it('TTL 到期后重新加载（授权变更最终会生效）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const { service, state } = setup(60);
    state.roles = ['teacher'];
    state.grants = [{ role: 'teacher', code: 'user:read' }];

    await service.resolveCodes({ roles: ['teacher'] });
    expect(state.selectCalls).toBe(2);

    state.grants = [{ role: 'teacher', code: 'user:delete' }];
    vi.setSystemTime(new Date('2026-10-29T00:01:01Z')); // +61s > TTL

    const codes = await service.resolveCodes({ roles: ['teacher'] });

    expect(state.selectCalls).toBe(4);
    expect([...codes]).toEqual(['user:delete']);
  });

  it('没有权限码的角色同样进缓存（否则每个请求都会重载一次）', async () => {
    const { service, state } = setup();
    state.roles = ['guest'];

    await service.resolveCodes({ roles: ['guest'] });
    const codes = await service.resolveCodes({ roles: ['guest'] });

    expect(codes.size).toBe(0);
    expect(state.selectCalls).toBe(2);
  });

  it('首次加载失败且无缓存 ⇒ 403（绝不 fail-open）', async () => {
    const warn = silenceWarn();
    const { service, state } = setup();
    state.fail = true;

    await expect(service.resolveCodes({ roles: ['admin'] })).rejects.toThrow(
      ForbiddenException,
    );
    expect(warn).toHaveBeenCalled();
  });

  it('加载失败但有旧缓存 ⇒ 沿用旧值，不把全站打成 500', async () => {
    silenceWarn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const { service, state } = setup(60);
    state.roles = ['teacher'];
    state.grants = [{ role: 'teacher', code: 'user:read' }];

    await service.resolveCodes({ roles: ['teacher'] });

    state.fail = true;
    vi.setSystemTime(new Date('2026-10-29T00:01:01Z'));

    const codes = await service.resolveCodes({ roles: ['teacher'] });
    expect([...codes]).toEqual(['user:read']);
  });

  it('invalidate() 后下一次调用立刻重载（管理端改完授权主动调用）', async () => {
    const { service, state } = setup();
    state.roles = ['teacher'];
    state.grants = [{ role: 'teacher', code: 'user:read' }];

    await service.resolveCodes({ roles: ['teacher'] });
    service.invalidate();
    state.grants = [{ role: 'teacher', code: 'user:delete' }];

    const codes = await service.resolveCodes({ roles: ['teacher'] });

    expect(state.selectCalls).toBe(4);
    expect([...codes]).toEqual(['user:delete']);
  });
});

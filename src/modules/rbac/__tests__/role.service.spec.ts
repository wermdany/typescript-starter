import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { rolePermissions, roles } from '@/database/schema/rbac.schema.js';
import type { RoleScalars } from '@/modules/rbac/role/dto/role.dto.js';
import { RoleService } from '@/modules/rbac/role/role.service.js';
import type { Actor } from '@/shared/auth.js';

const ACTOR: Actor = {
  id: 9,
  studentNo: '2019010001',
  nickname: '管理员',
  roles: ['admin'],
  sessionId: 12,
};

const CREATED_AT = new Date('2026-01-01T00:00:00Z');

const TEACHER: RoleScalars = {
  id: 2,
  code: 'teacher',
  name: '教师',
  description: null,
  level: 20,
  isSystem: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

const ADMIN: RoleScalars = {
  ...TEACHER,
  id: 1,
  code: 'admin',
  name: '管理员',
  level: 100,
  isSystem: true,
};

/**
 * 假 `DatabaseService`：非事务读走 `db`，`transaction()` 直接把假 `tx` 交给回调。
 *
 * `tx.update(...).set(...).where(...)` 在两种用法下都要成立（`remove` 里
 * 一处带 `.returning()`、一处直接 await），因此 `where()` 返回一个 thenable。
 */
function setup(options: { role?: RoleScalars | null; holders?: number } = {}) {
  const { role = TEACHER, holders = 0 } = options;

  // 参数只用于断言"改的是哪张表"，函数体不读它
  const update = vi.fn((_table: unknown) => ({
    set: () => ({
      where: () => {
        const rows = [{ id: 1 }];
        return {
          // oxlint-disable-next-line unicorn/no-thenable
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(rows).then(resolve),
          returning: () => Promise.resolve(rows),
        };
      },
    }),
  }));

  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ value: holders }]),
      }),
    }),
    update,
  };

  const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(role ? [role] : []),
        }),
      }),
    }),
  };
  const invalidate = vi.fn();

  const service = new RoleService(
    { db, transaction } as never,
    { invalidate } as never,
  );

  return { service, transaction, update, invalidate };
}

describe('RoleService（角色字典的删除与授权不变量）', () => {
  it('内置角色 ⇒ 409，且不进事务（删掉 admin 等于全站自锁）', async () => {
    const { service, transaction } = setup({ role: ADMIN });

    await expect(service.remove(ACTOR, ADMIN.id)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.remove(ACTOR, ADMIN.id)).rejects.toThrow(
      /内置角色不可删除/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('角色不存在（或已软删）⇒ 404', async () => {
    const { service, transaction } = setup({ role: null });

    await expect(service.remove(ACTOR, 404)).rejects.toThrow(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('仍有人持有 ⇒ 409，且不产生任何写入（否则这些用户会变成零角色）', async () => {
    const { service, update } = setup({ holders: 3 });

    await expect(service.remove(ACTOR, TEACHER.id)).rejects.toThrow(
      /仍被 3 个用户持有/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('无人持有 ⇒ 软删角色并一并软删其授权行，同时清缓存', async () => {
    const { service, update, invalidate } = setup({ holders: 0 });

    await service.remove(ACTOR, TEACHER.id);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.[0]).toBe(roles);
    expect(update.mock.calls[1]?.[0]).toBe(rolePermissions);
    // 只靠 TTL 的话，刚收回的授权最多还能用 60 秒
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('replacePermissions：超级管理员的通配权限不能被接口改 ⇒ 409', async () => {
    const { service, transaction } = setup({ role: ADMIN });

    await expect(
      service.replacePermissions(ACTOR, ADMIN.id, { codes: ['user:read'] }),
    ).rejects.toThrow(/超级管理员的通配权限由种子维护/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

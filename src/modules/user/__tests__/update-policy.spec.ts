import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import {
  systemActor,
  type Actor,
} from '@/common/auth/ownership.contract.js';
import {
  filterUpdatable,
  policyKeyFor,
  updatableFieldsFor,
} from '@/modules/user/update-policy.js';

const STUDENT: AuthenticatedUser = {
  id: 1,
  studentNo: '2019010001',
  nickname: '学生',
  roles: ['student'],
  sessionId: 7,
};
const TEACHER: AuthenticatedUser = { ...STUDENT, id: 3, roles: ['teacher'] };
const ADMIN: AuthenticatedUser = { ...STUDENT, id: 2, roles: ['admin'] };
const SYSTEM: Actor = systemActor('test:update-policy');

describe('policyKeyFor（四分支，穷尽且互斥）', () => {
  it('本人 → self（与是否管理员无关，先判管理员再判归属）', () => {
    expect(policyKeyFor(STUDENT, 1)).toBe('self');
    expect(policyKeyFor(TEACHER, 3)).toBe('self');
  });

  it('管理员改他人 → admin', () => {
    expect(policyKeyFor(ADMIN, 999)).toBe('admin');
  });

  it('系统身份 → system（显式绕过，不冒充管理员角色）', () => {
    expect(policyKeyFor(SYSTEM, 999)).toBe('system');
  });

  it('非本人且非管理员 → none', () => {
    expect(policyKeyFor(STUDENT, 999)).toBe('none');
    expect(policyKeyFor(TEACHER, 999)).toBe('none');
  });
});

describe('updatableFieldsFor（白名单）', () => {
  it('本人（任意非管理员角色）→ 只能改 email / nickname', () => {
    for (const actor of [STUDENT, TEACHER]) {
      expect([...updatableFieldsFor(actor, actor.id)].sort()).toEqual([
        'email',
        'nickname',
      ]);
    }
  });

  it('管理员 → 全部字段可改（含受控的 roles / points）', () => {
    expect([...updatableFieldsFor(ADMIN, 999)].sort()).toEqual([
      'email',
      'nickname',
      'points',
      'roles',
    ]);
  });

  it('系统身份 → 与管理员同权（内部调用不该比管理员更弱）', () => {
    expect([...updatableFieldsFor(SYSTEM, 999)].sort()).toEqual([
      'email',
      'nickname',
      'points',
      'roles',
    ]);
  });

  it('非本人且非管理员 → 空集合（一个字段都改不了）', () => {
    expect(updatableFieldsFor(STUDENT, 999).size).toBe(0);
    expect(updatableFieldsFor(TEACHER, 999).size).toBe(0);
  });
});

describe('filterUpdatable（DTO 过滤）', () => {
  it('本人改自己：基础资料放行，受控字段进 denied（稳定排序）', () => {
    const { allowed, denied } = filterUpdatable(STUDENT, 1, {
      nickname: '新昵称',
      roles: ['admin'],
      points: 100,
    });
    expect(allowed).toEqual({ nickname: '新昵称' });
    expect(denied).toEqual(['points', 'roles']);
  });

  it('本人改自己：省略 key 不参与判定（undefined 不算越权）', () => {
    const { allowed, denied } = filterUpdatable(STUDENT, 1, {
      email: 'new@example.com',
      roles: undefined,
    });
    expect(allowed).toEqual({ email: 'new@example.com' });
    expect(denied).toEqual([]);
  });

  it('管理员改他人：受控字段放行', () => {
    const { allowed, denied } = filterUpdatable(ADMIN, 999, {
      roles: ['teacher'],
      points: 5,
    });
    expect(allowed).toEqual({ roles: ['teacher'], points: 5 });
    expect(denied).toEqual([]);
  });

  it('非本人改他人：所有字段都进 denied', () => {
    const { allowed, denied } = filterUpdatable(STUDENT, 999, {
      nickname: 'x',
    });
    expect(allowed).toEqual({});
    expect(denied).toEqual(['nickname']);
  });

  it('空 allowed 由调用方处理（纯函数不抛异常）', () => {
    const { allowed } = filterUpdatable(STUDENT, 999, { nickname: 'x' });
    expect(allowed).toEqual({});
  });
});

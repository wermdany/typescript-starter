import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import {
  filterUpdatable,
  updatableFieldsFor,
} from '@/modules/user/update-policy.js';

const STUDENT: AuthenticatedUser = {
  id: 1,
  studentNo: '2019010001',
  nickname: '学生',
  role: 'student',
  sessionId: 7,
};
const TEACHER: AuthenticatedUser = { ...STUDENT, id: 3, role: 'teacher' };
const ADMIN: AuthenticatedUser = { ...STUDENT, id: 2, role: 'admin' };

describe('updatableFieldsFor（白名单）', () => {
  it('本人（任意非管理员角色）→ 只能改 email / nickname', () => {
    for (const actor of [STUDENT, TEACHER]) {
      expect([...updatableFieldsFor(actor, actor.id)].sort()).toEqual([
        'email',
        'nickname',
      ]);
    }
  });

  it('管理员 → 全部字段可改（含受控的 role / points）', () => {
    expect([...updatableFieldsFor(ADMIN, 999)].sort()).toEqual([
      'email',
      'nickname',
      'points',
      'role',
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
      role: 'admin',
      points: 100,
    });
    expect(allowed).toEqual({ nickname: '新昵称' });
    expect(denied).toEqual(['points', 'role']);
  });

  it('本人改自己：省略 key 不参与判定（undefined 不算越权）', () => {
    const { allowed, denied } = filterUpdatable(STUDENT, 1, {
      email: 'new@example.com',
      role: undefined,
    });
    expect(allowed).toEqual({ email: 'new@example.com' });
    expect(denied).toEqual([]);
  });

  it('管理员改他人：受控字段放行', () => {
    const { allowed, denied } = filterUpdatable(ADMIN, 999, {
      role: 'teacher',
      points: 5,
    });
    expect(allowed).toEqual({ role: 'teacher', points: 5 });
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

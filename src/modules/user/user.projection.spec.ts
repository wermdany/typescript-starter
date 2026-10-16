import { describe, expect, it } from 'vitest';

import { userPublicColumns } from './user.projection.js';

/**
 * 把「对外字段白名单」冻结成可回归的契约。
 *
 * 这里断言的是**当前认可的公开字段集**：往 `userPublicColumns` 里加列会让本文件失败，
 * 逼改动者显式确认「客户端真的需要这个字段吗」。
 */
describe('userPublicColumns（对外字段白名单）', () => {
  it('逻辑字段冻结为契约 —— 增删列必须同步改此断言', () => {
    expect(Object.keys(userPublicColumns).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'nickname',
      'points',
      'role',
      'studentNo',
      'updatedAt',
    ]);
  });

  it('映射到预期的物理列名', () => {
    expect(
      Object.values(userPublicColumns)
        .map((column) => column.name)
        .sort(),
    ).toEqual([
      'created_at',
      'email',
      'id',
      'nickname',
      'points',
      'role',
      'student_no',
      'updated_at',
    ]);
  });

  it('不含密码哈希（登录校验必须另行显式 select）', () => {
    expect(userPublicColumns).not.toHaveProperty('passwordHash');
  });

  it('不含软删除标记 —— 未删用户恒为 null，是噪音；删除语义由 HTTP 状态表达', () => {
    expect(userPublicColumns).not.toHaveProperty('deletedAt');
  });
});

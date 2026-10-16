import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from './password.js';
import { trimmed } from './trimmed.js';

/** 断言校验失败并返回 issues（不用 JSON 快照——会隐藏 undefined 键） */
function expectIssues(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error(`期望校验失败，实际通过：${JSON.stringify(result.data)}`);
  }
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('passwordSchema：字符白名单（仅字母 / 数字 / 下划线）', () => {
  it('白名单内字符照常通过，且**原样返回**（只校验、不改写）', () => {
    for (const password of ['pass1234', 'PASS_1234', '1234567_', 'abcdefg_']) {
      expect(passwordSchema.parse(password)).toBe(password);
    }
  });

  it.each([
    ['空格', 'pass 1234'],
    ['连字符', 'pass-1234'],
    ['点号', 'pass.1234'],
    ['感叹号', 'pass1234!'],
    ['@ 与 #', 'pass@1234#'],
    ['制表符', 'pass\t1234'],
    ['中文', '密码abcd1234'],
    ['emoji', 'pass1234😀'],
    ['零宽空格（肉眼不可见）', 'pass\u200b1234'],
  ])('白名单外字符：%s → 拒绝', (_label, password) => {
    expect(
      expectIssues(passwordSchema, password).map((i) => i.message),
    ).toContain('密码只能包含字母、数字与下划线');
  });
});

describe('passwordSchema：三类字符至少占两类', () => {
  it.each([
    ['字母 + 数字', 'pass1234'],
    ['数字 + 下划线', '1234567_'],
    ['字母 + 下划线', 'abcdefg_'],
    ['三类齐全', 'pass_1234'],
    ['大小写视为同一类（字母）', 'PASSW123'],
  ])('%s → 通过', (_label, password) => {
    expect(passwordSchema.safeParse(password).success).toBe(true);
  });

  it.each([
    ['纯数字（种子演示账号的密码形态）', '12345678'],
    ['纯字母', 'abcdefgh'],
    ['纯下划线', '________'],
  ])('%s → 只占一类，拒绝', (_label, password) => {
    expect(
      expectIssues(passwordSchema, password).map((i) => i.message),
    ).toContain('密码需至少包含字母、数字、下划线中的两种');
  });
});

describe('passwordSchema：长度 8~18', () => {
  it('下边界 8 位通过、7 位拒绝', () => {
    expect(passwordSchema.safeParse('pass123').success).toBe(false);
    expect(passwordSchema.safeParse('pass1234').success).toBe(true);
  });

  it('上边界 18 位通过、19 位拒绝', () => {
    const max = 'a'.repeat(PASSWORD_MAX_LENGTH - 1) + '1';
    const tooLong = 'a'.repeat(PASSWORD_MAX_LENGTH) + '1';
    expect(max).toHaveLength(PASSWORD_MAX_LENGTH);
    expect(passwordSchema.safeParse(max).success).toBe(true);
    expect(expectIssues(passwordSchema, tooLong)[0]?.message).toBe(
      `密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`,
    );
  });

  it('空串 → 长度下限；非字符串 → 类型错误（含 null / undefined / number）', () => {
    expect(expectIssues(passwordSchema, '').map((i) => i.message)).toContain(
      `密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`,
    );
    expect(expectIssues(passwordSchema, undefined)[0]?.message).toContain(
      'expected string',
    );
    expect(expectIssues(passwordSchema, 12345678)[0]?.message).toContain(
      'expected string',
    );
    expect(expectIssues(passwordSchema, null)[0]?.message).toContain(
      'received null',
    );
  });
});

describe('passwordSchema：不负责 trim（交由 trimmed / trimmedShape）', () => {
  it('直接 parse 带首尾空白的密码 → 被字符白名单拒绝（空格不在白名单里）', () => {
    expect(
      expectIssues(passwordSchema, '  pass1234  ').map((i) => i.message),
    ).toContain('密码只能包含字母、数字与下划线');
  });

  it('套一层 trimmed() 后同样输入通过 —— 规范化在校验之前生效', () => {
    const trimmedPassword = trimmed(passwordSchema);
    expect(trimmedPassword.parse('  pass1234  ')).toBe('pass1234');
    // 全空白 trim 成空串 → 落回长度下限，不会"蒙混过关"
    expect(
      expectIssues(trimmedPassword, '        ').map((i) => i.message),
    ).toContain(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
  });
});

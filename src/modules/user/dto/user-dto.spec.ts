import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { createUserSchema } from './create-user.dto.js';
import { queryUsersSchema } from './query-users.dto.js';
import {
  idParamSchema,
  resetPasswordSchema,
  studentNoParamSchema,
} from './reset-password.dto.js';
import { updateUserSchema } from './update-user.dto.js';

/**
 * 来源元数据（等价于 @Query() / @Body() 的真实调用）。
 *
 * 请求体契约（AGENTS.md 第 6 节）：body 不做任何空值宽恕，schema 层同样严格；
 * URL query 的宽容由管道按来源提供，因此"空白视为未提供"这类断言必须走 query 管道。
 */
const QUERY: ArgumentMetadata = { type: 'query' };

/** 断言校验失败并返回 errors（不用 JSON 快照——会隐藏 undefined 键） */
function expectFail(schema: { safeParse: (v: unknown) => unknown }, input: unknown) {
  const result = schema.safeParse(input) as
    | { success: true; data: unknown }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  if (result.success) {
    throw new Error(`期望校验失败，实际通过：${JSON.stringify(result.data)}`);
  }
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

const validCreate = {
  studentNo: '20250001',
  email: 'ming@example.com',
  nickname: '小明',
  password: '12345678',
};

describe('createUserSchema：文本字段规范化 + password 例外', () => {
  it('学号 / 邮箱 / 昵称的首尾空白被去掉', () => {
    const dto = createUserSchema.parse({
      ...validCreate,
      studentNo: '  20250001  ',
      email: '  ming@example.com  ',
      nickname: '  小明  ',
    });
    expect(dto.studentNo).toBe('20250001');
    expect(dto.email).toBe('ming@example.com');
    expect(dto.nickname).toBe('小明');
  });

  it('password 不做 trim——首尾空白原样保留', () => {
    const dto = createUserSchema.parse({
      ...validCreate,
      password: '  pass1234  ',
    });
    expect(dto.password).toBe('  pass1234  ');
  });

  it('password 字段以 .meta({ keepWhitespace: true }) 声明例外', () => {
    expect(createUserSchema.shape.password.meta()).toMatchObject({
      keepWhitespace: true,
    });
    expect(resetPasswordSchema.shape.password.meta()).toMatchObject({
      keepWhitespace: true,
    });
    // 其他文本字段不应带该标记（由 trimmedShape 自动规范化）
    expect(createUserSchema.shape.nickname.meta()?.keepWhitespace).toBeUndefined();
  });

  it('password 全为空白且长度达标 → 通过（未被归零），证明未 trim', () => {
    const dto = createUserSchema.parse({
      ...validCreate,
      password: '        ',
    });
    expect(dto.password).toBe('        ');
  });

  it('必填字段纯空白 → trim 成空串后被 min(1) 拒绝（不再等同于"未提供"）', () => {
    const issues = expectFail(createUserSchema, {
      ...validCreate,
      nickname: '   ',
    });
    expect(issues[0]?.path).toBe('nickname');
    expect(issues[0]?.message).toContain('>=1');
  });

  it('必填字段传空串同样被 min(1) 拒绝——前端必须省略 key 而不是传空值', () => {
    const issues = expectFail(createUserSchema, { ...validCreate, studentNo: '' });
    expect(issues[0]?.path).toBe('studentNo');
    expect(issues[0]?.message).toContain('>=1');
  });

  it('role 带空白 → 规范化后取值', () => {
    expect(
      createUserSchema.parse({ ...validCreate, role: ' admin ' }).role,
    ).toBe('admin');
  });

  it('role 纯空白（或空串）→ 报非法枚举，不静默回落默认值', () => {
    for (const input of ['  ', '']) {
      expect(expectFail(createUserSchema, { ...validCreate, role: input })[0]?.path).toBe(
        'role',
      );
    }
    // 只有"不传"才走默认值
    expect(createUserSchema.parse(validCreate).role).toBe('student');
  });

  it('null 报类型错误（RFC 7396 的 null 是显式语义，不能当成"没传"）', () => {
    expect(expectFail(createUserSchema, { ...validCreate, nickname: null })[0]?.message)
      .toContain('received null');
  });
});

describe('resetPasswordSchema：同样排除 password', () => {
  it('首尾空白保留', () => {
    expect(resetPasswordSchema.parse({ password: '  pass1234  ' }).password).toBe(
      '  pass1234  ',
    );
  });

  it('空密码被 min(8) 拒绝（不被吞成"未提供"）', () => {
    expect(expectFail(resetPasswordSchema, { password: '' })[0]?.path).toBe(
      'password',
    );
  });
});

describe('updateUserSchema：严格三态（省略 / 空值 / null）', () => {
  it('带空白的有效值被规范化', () => {
    expect(updateUserSchema.parse({ nickname: '  小明  ' })).toEqual({
      nickname: '小明',
    });
  });

  it('空对象 → 「至少提供一个更新字段」', () => {
    const issues = expectFail(updateUserSchema, {});
    expect(issues.map((i) => i.message)).toContain('至少提供一个更新字段');
  });

  it.each([
    ['空串', { nickname: '' }],
    ['纯空白', { nickname: '   ' }],
    ['空枚举串', { role: '' }],
  ])('%s → 字段级 400（不再被静默吞掉后落到 refine）', (_label, input) => {
    const issues = expectFail(updateUserSchema, input);
    expect(issues.map((i) => i.path)).toContain(
      _label === '空枚举串' ? 'role' : 'nickname',
    );
    expect(issues.map((i) => i.message)).not.toContain('至少提供一个更新字段');
  });

  it('显式 null → 类型错误（PATCH 里 null ≠ "没有值"，后端不代为解释）', () => {
    const issues = expectFail(updateUserSchema, { nickname: null });
    expect(issues[0]?.message).toContain('received null');
  });

  it('经管道后显式 null 仍是类型错误（body 不做空值归一化）', () => {
    const pipe = new ZodValidationPipe(updateUserSchema);
    try {
      pipe.transform({ nickname: null }, { type: 'body' });
      throw new Error('应当抛出 BadRequestException');
    } catch (err) {
      const response = (
        err as { getResponse(): { errors: { message: string }[] } }
      ).getResponse();
      expect(response.errors[0]?.message).toContain('received null');
    }
  });

  it('points: 0 必须通过（判定用 !== undefined 而非真值）', () => {
    expect(updateUserSchema.parse({ points: 0 })).toEqual({ points: 0 });
  });

  it('混杂场景：有效字段与带空白的有效字段并存 → 都保留并规范化', () => {
    expect(updateUserSchema.parse({ nickname: '  小明  ', points: 5 })).toEqual({
      nickname: '小明',
      points: 5,
    });
  });
});

describe('queryUsersSchema：schema 自身严格，宽容由 query 管道提供', () => {
  const queryPipe = new ZodValidationPipe(queryUsersSchema);

  it('空查询 → 第一页 / 10 条 / 修改时间倒序（AGENTS.md 第 7 节约定）', () => {
    expect(queryPipe.transform({}, QUERY)).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      order: 'desc',
    });
  });

  it('sortBy 白名单包含 updatedAt 与 createdAt（后者仍可按需显式指定）', () => {
    expect(queryUsersSchema.parse({ sortBy: 'updatedAt' }).sortBy).toBe('updatedAt');
    expect(queryUsersSchema.parse({ sortBy: 'createdAt' }).sortBy).toBe('createdAt');
    // 未列入白名单的列（如 deletedAt）仍拒绝
    expect(expectFail(queryUsersSchema, { sortBy: 'deletedAt' })[0]?.path).toBe(
      'sortBy',
    );
  });

  it('keyword 空白 → 经 query 管道视为未提供（直接 parse schema 则被 min(1) 拒绝）', () => {
    expect(queryPipe.transform({ keyword: '   ' }, QUERY).keyword).toBeUndefined();
    expect(expectFail(queryUsersSchema, { keyword: '   ' })[0]?.path).toBe('keyword');
  });

  it('keyword 带空白 → 规范化', () => {
    expect(queryUsersSchema.parse({ keyword: '  小明  ' }).keyword).toBe('小明');
  });

  it('枚举字段带空白 → 规范化后正常解析', () => {
    const dto = queryUsersSchema.parse({
      role: ' student ',
      sortBy: ' points ',
      order: ' asc ',
    });
    expect(dto).toMatchObject({ role: 'student', sortBy: 'points', order: 'asc' });
  });

  it('枚举值大小写敏感（trim 不做大小写折叠）', () => {
    expect(expectFail(queryUsersSchema, { order: ' ASC ' })[0]?.path).toBe('order');
  });

  it('枚举值非法仍拒绝', () => {
    expect(expectFail(queryUsersSchema, { role: 'teacher' })[0]?.path).toBe('role');
  });
});

describe('studentNoParamSchema：路径参数校验', () => {
  it('首尾空白被规范化', () => {
    expect(studentNoParamSchema.parse('  20250001  ')).toBe('20250001');
  });

  it('纯空白 → trim 成空串后被 min(1) 拒绝', () => {
    expect(expectFail(studentNoParamSchema, '   ')[0]?.message).toContain('>=1');
  });

  it('超长学号 → 长度错误（前置拦截 PG 22001 导致的 500）', () => {
    const issues = expectFail(studentNoParamSchema, 'a'.repeat(21));
    expect(issues[0]?.message).toMatch(/at most 20|<=20|20 characters/i);
  });
});

describe('idParamSchema：:id 路径参数（纯数字字符串 → number）', () => {
  it('数字字符串 → number，并去掉首尾空白', () => {
    expect(idParamSchema.parse('1')).toBe(1);
    expect(idParamSchema.parse(' 12 ')).toBe(12);
    expect(idParamSchema.parse('007')).toBe(7);
    expect(typeof idParamSchema.parse('42')).toBe('number');
  });

  it('空串 / 纯空白 → trim 后由 /^\\d+$/ 拦下（而非被 Number("") === 0 误导成 too_small）', () => {
    for (const input of ['', '   ']) {
      const issues = expectFail(idParamSchema, input);
      expect(issues[0]?.path).toBe('');
      expect(issues[0]?.message).toBe('ID 必须是正整数');
    }
  });

  it.each([
    ['字母', 'abc'],
    ['负数', '-1'],
    ['小数', '1.5'],
    ['十六进制', '0x10'],
    ['科学计数法', '1e0'],
    ['显式正号', '+1'],
    ['数字分隔符', '1_000'],
    ['数字后跟字母', '12abc'],
  ])('%s → 拒绝（不受 Number() 宽松解析影响）', (_label, input) => {
    expect(expectFail(idParamSchema, input)[0]?.message).toBe('ID 必须是正整数');
  });

  it('0 / 000 → 非正整数', () => {
    expect(expectFail(idParamSchema, '0')[0]?.message).toContain('>0');
    expect(expectFail(idParamSchema, '000')[0]?.message).toContain('>0');
  });

  it('超出安全整数 → Too big（不把失真浮点数带进 DB）', () => {
    expect(expectFail(idParamSchema, '99999999999999999999')[0]?.message).toMatch(
      /Too big/i,
    );
  });

  it('经管道后失败形态符合契约：message 固定 + errors 数组', () => {
    const pipe = new ZodValidationPipe(idParamSchema);
    try {
      pipe.transform('abc');
      throw new Error('应当抛出 BadRequestException');
    } catch (err) {
      const response = (
        err as {
          getResponse(): { message: string; errors: unknown };
        }
      ).getResponse();
      expect(response.message).toBe('参数校验失败');
      expect(response.errors).toEqual([{ path: '', message: 'ID 必须是正整数' }]);
    }
  });

  it('经管道后空白值同样被拒绝（param 不在 query 宽容范围内）', () => {
    const pipe = new ZodValidationPipe(idParamSchema);
    try {
      pipe.transform('   ');
      throw new Error('应当抛出 BadRequestException');
    } catch (err) {
      const response = (
        err as { getResponse(): { errors: { message: string }[] } }
      ).getResponse();
      expect(response.errors[0]?.message).toBe('ID 必须是正整数');
    }
  });
});

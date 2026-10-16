import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { queryUsersSchema } from '../../modules/user/dto/query-users.dto.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** 必填字段 + 可选字段的最小领域 schema，用于观察归一化后的语义 */
const schema = z.object({
  nickname: z.string().min(1).max(50),
  points: z.coerce.number().int().min(1).default(10).optional(),
});

/** 捕获 BadRequestException 的响应体（含 message + errors） */
function catchResponse(fn: () => unknown): {
  message: string;
  errors: { path: string; message: string }[];
} {
  try {
    fn();
  } catch (err) {
    return (err as { getResponse(): never }).getResponse();
  }
  throw new Error('应当抛出 BadRequestException');
}

describe('ZodValidationPipe 空值归一化', () => {
  const pipe = new ZodValidationPipe(schema);

  it('空字符串视为未提供：必填字段报「received undefined」而非长度错误', () => {
    const res = catchResponse(() => pipe.transform({ nickname: '', points: 5 }));
    expect(res.errors[0]).toMatchObject({
      path: 'nickname',
      message: expect.stringContaining('received undefined'),
    });
  });

  it('显式 null 与空串同处理', () => {
    const res = catchResponse(() => pipe.transform({ nickname: null }));
    expect(res.errors[0]).toMatchObject({
      path: 'nickname',
      message: expect.stringContaining('received undefined'),
    });
  });

  it('可选字段传空串 → 视为未提供，走默认值', () => {
    expect(pipe.transform({ nickname: '小明', points: '' })).toEqual({
      nickname: '小明',
      points: 10,
    });
  });

  it('纯空白字符串不属于空值，原样参与校验', () => {
    expect(pipe.transform({ nickname: ' ' })).toMatchObject({ nickname: ' ' });
  });

  it('数组元素内的空串不被归一化（多为有意占位）', () => {
    const arrayPipe = new ZodValidationPipe(z.object({ tags: z.array(z.string()) }));
    expect(arrayPipe.transform({ tags: ['', 'a'] })).toEqual({
      tags: ['', 'a'],
    });
  });

  it('非法值仍被拒绝（归一化不绕过校验）', () => {
    expect(() => pipe.transform({ nickname: 'ok', points: 'abc' })).toThrow();
  });
});

describe('ZodValidationPipe 校验失败契约', () => {
  it('errors 为 { path, message } 数组', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(catchResponse(() => pipe.transform({ nickname: '' }))).toMatchObject({
      message: '参数校验失败',
      errors: [
        { path: 'nickname', message: expect.stringContaining('undefined') },
      ],
    });
  });
});

describe('分页默认值（findAll 不传条件）', () => {
  const pipe = new ZodValidationPipe(queryUsersSchema);

  it('空查询 → 第一页、每页 10 条、按修改时间倒序（AGENTS.md 第 7 节约定）', () => {
    expect(pipe.transform({})).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      order: 'desc',
    });
  });

  it('分页参数传空串 → 回落默认值', () => {
    expect(pipe.transform({ page: '', pageSize: '' })).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it('字符串数字自动转型（query 天然是字符串）', () => {
    expect(pipe.transform({ page: '2', pageSize: '5' })).toMatchObject({
      page: 2,
      pageSize: 5,
    });
  });

  it('只传 keyword 时其余条件走默认值', () => {
    expect(pipe.transform({ keyword: '明' })).toMatchObject({
      keyword: '明',
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      order: 'desc',
    });
  });
});

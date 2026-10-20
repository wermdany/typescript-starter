import type { ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { DEFAULT_VALIDATION_MESSAGE } from '@/common/api-response/api-response.js';
import { paginationSchema, trimmedShape } from '@/shared/validation.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';

/** Nest 传给管道的来源元数据（这里手工构造，等价于 @Query() / @Body() 的真实调用） */
const QUERY: ArgumentMetadata = { type: 'query' };
const BODY: ArgumentMetadata = { type: 'body' };
const PARAM: ArgumentMetadata = { type: 'param' };

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

describe('ZodValidationPipe：URL query 归一化（唯一的宽容通道）', () => {
  const pipe = new ZodValidationPipe(schema);

  it('空串视为未提供：必填字段报「received undefined」而非长度错误', () => {
    const res = catchResponse(() =>
      pipe.transform({ nickname: '', points: 5 }, QUERY),
    );
    expect(res.errors[0]).toMatchObject({
      path: 'nickname',
      message: expect.stringContaining('received undefined'),
    });
  });

  it('纯空白同样视为未提供（?keyword=%20%20 等价于没传）', () => {
    const res = catchResponse(() => pipe.transform({ nickname: '   ' }, QUERY));
    expect(res.errors[0]).toMatchObject({
      path: 'nickname',
      message: expect.stringContaining('received undefined'),
    });
  });

  it('可选字段传空串 → 视为未提供，走默认值', () => {
    expect(pipe.transform({ nickname: '小明', points: '' }, QUERY)).toEqual({
      nickname: '小明',
      points: 10,
    });
  });

  it('非空值原样保留（归一化只动空值）', () => {
    expect(pipe.transform({ nickname: ' 小明 ' }, QUERY)).toMatchObject({
      nickname: ' 小明 ', // trim 属 schema 层（trimmedShape）职责，不在管道代劳
    });
  });

  it('数组元素内的空串不被归一化（多为有意占位）', () => {
    const arrayPipe = new ZodValidationPipe(
      z.object({ tags: z.array(z.string()) }),
    );
    expect(arrayPipe.transform({ tags: ['', 'a'] }, QUERY)).toEqual({
      tags: ['', 'a'],
    });
  });

  it('非法值仍被拒绝（归一化不绕过校验）', () => {
    expect(() =>
      pipe.transform({ nickname: 'ok', points: 'abc' }, QUERY),
    ).toThrow();
  });
});

describe('ZodValidationPipe：body / param 严格（不做任何空值宽恕）', () => {
  const pipe = new ZodValidationPipe(schema);

  it('空串原样进 schema → 由 min(1) 拒绝，而非被吞成「未提供」', () => {
    const res = catchResponse(() => pipe.transform({ nickname: '' }, BODY));
    expect(res.errors[0]?.path).toBe('nickname');
    expect(res.errors[0]?.message).toContain('>=1');
    expect(res.errors[0]?.message).not.toContain('undefined');
  });

  it('显式 null 报类型错误（RFC 7396 里 null 是显式语义，不能被当成"没传"）', () => {
    const res = catchResponse(() => pipe.transform({ nickname: null }, BODY));
    expect(res.errors[0]?.path).toBe('nickname');
    expect(res.errors[0]?.message).toContain('received null');
  });

  it('可选字段传空串不再回落默认值', () => {
    const res = catchResponse(() =>
      pipe.transform({ nickname: '小明', points: '' }, BODY),
    );
    expect(res.errors[0]?.path).toBe('points');
  });

  it('纯空白字符串原样参与校验（该判定归 schema 层）', () => {
    expect(pipe.transform({ nickname: ' ' }, BODY)).toMatchObject({
      nickname: ' ',
    });
  });

  it('param 同样不归一化（顶层字符串，来源不是 query）', () => {
    const paramPipe = new ZodValidationPipe(z.string().min(1));
    const res = catchResponse(() => paramPipe.transform('', PARAM));
    expect(res.errors[0]?.message).toContain('>=1');
  });

  it('缺省 metadata 时按严格处理（直调管道的兜底语义）', () => {
    const res = catchResponse(() => pipe.transform({ nickname: '' }));
    expect(res.errors[0]?.message).toContain('>=1');
  });
});

describe('ZodValidationPipe：body + trimmedShape 组合（首尾空白去掉、空值不宽恕）', () => {
  const pipe = new ZodValidationPipe(
    z.object(
      trimmedShape({
        nickname: z.string().min(1).max(50),
        role: z.enum(['student', 'admin']).default('student'),
      }),
    ),
  );

  it('首尾空白被去掉（trim 仍是 DTO 的默认行为）', () => {
    expect(pipe.transform({ nickname: '  小明  ' }, BODY)).toEqual({
      nickname: '小明',
      role: 'student',
    });
  });

  it('纯空白 → trim 成空串 → 被 min(1) 拒绝（前端必须自己保证不传空）', () => {
    const res = catchResponse(() => pipe.transform({ nickname: '   ' }, BODY));
    expect(res.errors[0]).toMatchObject({
      path: 'nickname',
      message: expect.stringContaining('>=1'),
    });
  });

  it('枚举字段传空串 → 报非法枚举（不再静默回落默认值）', () => {
    const res = catchResponse(() =>
      pipe.transform({ nickname: '小明', role: '' }, BODY),
    );
    expect(res.errors[0]?.path).toBe('role');
  });
});

describe('ZodValidationPipe 校验失败契约', () => {
  it('errors 为 { path, message } 数组', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(
      catchResponse(() => pipe.transform({ nickname: '' }, BODY)),
    ).toMatchObject({
      message: '参数校验失败',
      errors: [{ path: 'nickname', message: expect.stringContaining('>=1') }],
    });
  });

  it('默认 message 取自 DEFAULT_VALIDATION_MESSAGE（改常量即全局生效）', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(
      catchResponse(() => pipe.transform({ nickname: '' }, BODY)).message,
    ).toBe(DEFAULT_VALIDATION_MESSAGE);
  });

  it('可按参数自定义校验失败文案（表单类接口常用）', () => {
    const pipe = new ZodValidationPipe(schema, {
      message: '注册信息有误，请检查后重试',
    });
    expect(
      catchResponse(() => pipe.transform({ nickname: '' }, BODY)).message,
    ).toBe('注册信息有误，请检查后重试');
  });

  it('自定义文案不影响字段级 errors（前端绑定表单仍靠 errors）', () => {
    const pipe = new ZodValidationPipe(schema, { message: '提交有误' });
    expect(
      catchResponse(() => pipe.transform({ nickname: '' }, BODY)).errors,
    ).toEqual([{ path: 'nickname', message: expect.stringContaining('>=1') }]);
  });
});
describe('分页基础 schema（paginationSchema + trimmedShape）', () => {
  const pipe = new ZodValidationPipe(
    paginationSchema.extend(
      trimmedShape({
        keyword: z.string().min(1).max(50).optional(),
        order: z.enum(['asc', 'desc']).default('desc'),
      }),
    ),
  );

  it('空查询 → 第一页、每页 10 条、order 默认 desc', () => {
    expect(pipe.transform({}, QUERY)).toEqual({
      page: 1,
      pageSize: 10,
      order: 'desc',
    });
  });

  it('分页参数传空串 → 回落默认值', () => {
    expect(pipe.transform({ page: '', pageSize: '' }, QUERY)).toMatchObject({
      page: 1,
      pageSize: 10,
    });
  });

  it('分页参数传纯空白 → 同样回落默认值', () => {
    expect(pipe.transform({ page: '   ' }, QUERY)).toMatchObject({ page: 1 });
  });

  it('字符串数字自动转型（query 天然是字符串）', () => {
    expect(pipe.transform({ page: '2', pageSize: '5' }, QUERY)).toMatchObject({
      page: 2,
      pageSize: 5,
    });
  });

  it('筛选条件传空串 → 视为未提供，走默认值', () => {
    const dto = pipe.transform({ keyword: '', order: '' }, QUERY);
    expect(dto.keyword).toBeUndefined();
    expect(dto.order).toBe('desc');
  });

  it('只传 keyword 时其余条件走默认值', () => {
    expect(pipe.transform({ keyword: '明' }, QUERY)).toMatchObject({
      keyword: '明',
      page: 1,
      pageSize: 10,
      order: 'desc',
    });
  });
});

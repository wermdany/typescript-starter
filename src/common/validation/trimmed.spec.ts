import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { trimmed, trimmedShape } from './trimmed.js';

/** 断言必填字段的报错形态（不用 JSON 快照——它会隐藏 undefined 键） */
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

describe('trimmed：首尾空白规范化', () => {
  const keyword = trimmed(z.string().min(1).max(50));

  it('去掉首尾空白', () => {
    expect(keyword.parse('  小明  ')).toBe('小明');
  });

  it('覆盖 Tab 与全角空格等空白变体', () => {
    expect(keyword.parse('\t小明\u3000')).toBe('小明');
  });

  it('trim 后为空串 → 视为未提供（报 received undefined 而非长度错误）', () => {
    const issues = expectIssues(z.object({ keyword }), { keyword: '   ' });
    expect(issues).toEqual([
      {
        path: 'keyword',
        message: expect.stringContaining('received undefined'),
      },
    ]);
  });

  it('长度校验按 trim 后的值计算（带空白不会误伤 max 限制）', () => {
    const short = trimmed(z.string().trim().max(3));
    expect(short.parse('  ab  ')).toBe('ab');

    const maxed = trimmed(z.string().max(3));
    expect(maxed.parse('  abc  ')).toBe('abc');
  });

  it('值内部的连续空白不压缩', () => {
    expect(keyword.parse('  小   明  ')).toBe('小   明');
  });

  it('非字符串输入原样透传给内层 schema', () => {
    const numberish = trimmed(z.number());
    expect(numberish.parse(42)).toBe(42);
    expect(expectIssues(numberish, true)[0]?.path).toBe('');
  });
});

describe('trimmed：与 .optional() / .default() 组合（修饰符必须在内层）', () => {
  it('内层 .optional()：纯空白 → undefined 通过', () => {
    const schema = trimmed(z.string().min(1).max(50).optional());
    expect(schema.parse('   ')).toBeUndefined();
    expect(schema.parse('  小明  ')).toBe('小明');
  });

  it('内层 .default()：纯空白 → 走默认值', () => {
    const schema = trimmed(z.enum(['asc', 'desc']).default('desc'));
    expect(schema.parse('   ')).toBe('desc');
    expect(schema.parse(' asc ')).toBe('asc');
  });

  it('对象内组合：错误 path 保持为字段名', () => {
    const schema = z.object({
      a: trimmed(z.string().min(1).max(10)),
      b: trimmed(z.string().min(1).max(10).optional()),
    });
    expect(expectIssues(schema, { a: '  ', b: '  ' })[0]?.path).toBe('a');
  });
});

describe('trimmedShape：shape 级自动包装', () => {
  const schema = z.object(
    trimmedShape({
      nickname: z.string().min(1).max(50),
      points: z.number().int().nonnegative().default(0),
      keyword: z.string().min(1).max(20).optional(),
      password: z.string().min(8).max(128).meta({ keepWhitespace: true }),
      role: z.enum(['student', 'admin']).default('student'),
    }),
  );

  const valid = { nickname: '小明', password: '12345678' };

  it('默认字段自动 trim', () => {
    const dto = schema.parse({ ...valid, nickname: '  小明  ' });
    expect(dto.nickname).toBe('小明');
  });

  it('.meta({ keepWhitespace: true }) 标注的字段保留空白', () => {
    expect(schema.parse({ ...valid, password: '  pass1234  ' }).password).toBe(
      '  pass1234  ',
    );
    // 8 个空格通过 min(8)：证明该字段既没被 trim 也没被归零
    expect(schema.parse({ ...valid, password: '        ' }).password).toBe(
      '        ',
    );
  });

  it('非字符串字段不受影响（包裹无副作用）', () => {
    expect(schema.parse({ ...valid, points: 5 }).points).toBe(5);
    expect(schema.parse(valid).points).toBe(0); // 默认值仍生效
  });

  it('枚举字段的空白被规范化后正常解析', () => {
    expect(schema.parse({ ...valid, role: ' admin ' }).role).toBe('admin');
  });

  it('纯空白必填字段 → 视为未提供（错误 path 仍为字段名）', () => {
    const issues = expectIssues(schema, { ...valid, nickname: '   ' });
    expect(issues[0]?.path).toBe('nickname');
    expect(issues[0]?.message).toContain('received undefined');
  });

  it('可选字段纯空白 → 视为未提供（不参与筛选）', () => {
    expect(schema.parse({ ...valid, keyword: '   ' }).keyword).toBeUndefined();
    expect(schema.parse({ ...valid, keyword: '  小明  ' }).keyword).toBe('小明');
  });

  it('可与 .extend() 组合（shape 复用不受影响）', () => {
    const base = z.object({ page: z.coerce.number().int().min(1).default(1) });
    const extended = base.extend(trimmedShape({ name: z.string().min(1) }));
    expect(extended.parse({ name: '  小明  ' })).toMatchObject({
      page: 1,
      name: '小明',
    });
  });

  it('链在其后的 .refine() 仍生效（对象由调用方创建，不重建）', () => {
    const refined = z
      .object(trimmedShape({ name: z.string().min(1).optional() }))
      .refine((v) => Object.values(v).some((x) => x !== undefined), {
        message: '至少提供一个字段',
      });
    expect(refined.safeParse({ name: '   ' }).success).toBe(false);
    expect(refined.parse({ name: '  x  ' })).toEqual({ name: 'x' });
  });

  it('只处理顶层字段：嵌套对象的字段不被自动 trim（已知边界）', () => {
    const nested = z.object(
      trimmedShape({
        outer: z.string(),
        inner: z.object({ value: z.string() }),
      }),
    );
    const dto = nested.parse({
      outer: '  a  ',
      inner: { value: '  b  ' },
    });
    expect(dto.outer).toBe('a');
    expect(dto.inner.value).toBe('  b  '); // 需在 inner 定义处自行包一层
  });
});

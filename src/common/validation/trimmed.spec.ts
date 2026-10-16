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

  it('trim 后为空串 → 保持空串，由内层约束拒绝（不再转成「未提供」）', () => {
    const issues = expectIssues(z.object({ keyword }), { keyword: '   ' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('keyword');
    expect(issues[0]?.message).toContain('>=1');
    expect(issues[0]?.message).not.toContain('undefined');
  });

  it('空串输入路径不变：只有 trim 被应用', () => {
    expect(expectIssues(keyword, '')[0]?.message).toContain('>=1');
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

  it('不产出 undefined：optional 字段拿到的是空串而非 undefined', () => {
    const optional = trimmed(z.string().optional());
    expect(optional.parse('')).toBe('');
    expect(optional.parse('   ')).toBe(''); // 只 trim，不归零
    expect(optional.parse(' x ')).toBe('x');
    expect(optional.parse(undefined)).toBeUndefined();
  });
});

describe('trimmed：修饰符位置（写法约定，不再承载语义）', () => {
  it('内层 .default()：只有 undefined 才回落默认值，空串如实失败', () => {
    const schema = trimmed(z.enum(['asc', 'desc']).default('desc'));
    expect(schema.parse(undefined)).toBe('desc');
    expect(schema.parse(' asc ')).toBe('asc');
    expect(expectIssues(schema, '   ')[0]?.message).toContain('Invalid');
  });

  it('外层 .default()：语义与内层一致（两种写法现在等价）', () => {
    const schema = trimmed(z.enum(['asc', 'desc'])).default('desc');
    expect(schema.parse(undefined)).toBe('desc');
    expect(schema.parse(' asc ')).toBe('asc');
    expect(expectIssues(schema, '   ')[0]?.message).toContain('Invalid');
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
    // 8 个空格通过 min(8)：证明该字段没被 trim
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

  it('纯空白必填字段 → trim 成空串后被 min(1) 拒绝（错误 path 仍为字段名）', () => {
    const issues = expectIssues(schema, { ...valid, nickname: '   ' });
    expect(issues[0]?.path).toBe('nickname');
    expect(issues[0]?.message).toContain('>=1');
  });

  it('枚举字段纯空白 → 报非法枚举（不回落默认值）', () => {
    expect(expectIssues(schema, { ...valid, role: '  ' })[0]?.path).toBe('role');
  });

  it('可选字段纯空白 → 同样被 min(1) 拒绝（query 侧的宽容由管道负责）', () => {
    expect(expectIssues(schema, { ...valid, keyword: '   ' })[0]?.path).toBe(
      'keyword',
    );
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

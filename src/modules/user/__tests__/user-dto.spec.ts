import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { createZodValidationPipe } from '@/common/validation/zod-validation.pipe.js';
import { changePasswordSchema } from '../dto/change-password.dto.js';
import { createUserSchema } from '../dto/create-user.dto.js';
import { idParamSchema, studentNoParamSchema } from '../dto/params.dto.js';
import { queryUsersSchema } from '../dto/query-users.dto.js';
import { updateUserSchema } from '../dto/update-user.dto.js';
import { userPublicColumns } from '../dto/user.dto.js';

/**
 * 来源元数据（等价于 @Query() / @Body() 的真实调用）。
 *
 * 请求体契约：body 不做任何空值宽恕，schema 层同样严格；
 * URL query 的宽容由管道按来源提供，因此"空白视为未提供"这类断言必须走 query 管道。
 */
const QUERY: ArgumentMetadata = { type: 'query' };

/** 断言校验失败并返回 errors（不用 JSON 快照——会隐藏 undefined 键） */
function expectFail(
  schema: { safeParse: (v: unknown) => unknown },
  input: unknown,
) {
  const result = schema.safeParse(input) as
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: { path: PropertyKey[]; message: string }[] };
      };
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
  // 满足 passwordSchema：长度 8、字符白名单、字母 + 数字两类
  password: 'pass1234',
};

describe('createUserSchema：文本字段规范化（无例外字段，password 同样处理）', () => {
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

  it('password 同样被 trim——首尾空白不再保留', () => {
    const dto = createUserSchema.parse({
      ...validCreate,
      password: '  pass1234  ',
    });
    expect(dto.password).toBe('pass1234');
  });

  it('password 全为空白 → trim 成空串后被长度下限拒绝（曾被长度校验放过）', () => {
    const issues = expectFail(createUserSchema, {
      ...validCreate,
      password: '        ',
    });
    expect(issues[0]?.path).toBe('password');
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
    const issues = expectFail(createUserSchema, {
      ...validCreate,
      studentNo: '',
    });
    expect(issues[0]?.path).toBe('studentNo');
    expect(issues[0]?.message).toContain('>=1');
  });

  it('roles 元素先 trim 再校验格式；格式非法仍报 roles.0', () => {
    // 数组元素包了 trimmed()：`trimmedShape()` 只处理顶层字段，包不到元素
    expect(
      createUserSchema.parse({ ...validCreate, roles: [' admin '] }).roles,
    ).toEqual(['admin']);
    expect(
      expectFail(createUserSchema, { ...validCreate, roles: ['Admin'] })[0]
        ?.path,
    ).toBe('roles.0');
  });

  it('roles 重复 → 报「角色不能重复」，不静默去重', () => {
    expect(
      expectFail(createUserSchema, {
        ...validCreate,
        roles: ['student', 'student'],
      })[0]?.message,
    ).toContain('角色不能重复');
  });

  it('roles 省略 → 默认学生；空数组 → 拒绝（不允许零角色用户）', () => {
    // 只有"不传"才走默认值
    expect(createUserSchema.parse(validCreate).roles).toEqual(['student']);
    expect(
      expectFail(createUserSchema, { ...validCreate, roles: [] })[0]?.path,
    ).toBe('roles');
  });

  it('null 报类型错误（RFC 7396 的 null 是显式语义，不能当成"没传"）', () => {
    expect(
      expectFail(createUserSchema, { ...validCreate, nickname: null })[0]
        ?.message,
    ).toContain('received null');
  });
});

describe('changePasswordSchema：旧密码必填 + 新密码走同一份规则', () => {
  /** 旧密码故意用**历史字符集**（纯数字），模拟规则收窄之前设定的密码 */
  const valid = { oldPassword: '12345678', password: 'pass_1234' };

  it('两个字段的首尾空白都被去掉', () => {
    expect(
      changePasswordSchema.parse({
        oldPassword: '  12345678  ',
        password: '  pass_1234  ',
      }),
    ).toEqual({ oldPassword: '12345678', password: 'pass_1234' });
  });

  it('旧密码不受新字符规则约束：纯数字 12345678 照常通过（否则老用户被锁死）', () => {
    expect(changePasswordSchema.parse(valid)).toEqual(valid);
  });

  it('省略旧密码 → 字段级 400 指向 oldPassword（不靠 message 分支）', () => {
    const issues = expectFail(changePasswordSchema, { password: 'pass_1234' });
    expect(issues.map((i) => i.path)).toContain('oldPassword');
  });

  it('旧密码为空串 / 纯空白 → 拒绝', () => {
    for (const oldPassword of ['', '   ']) {
      expect(
        expectFail(changePasswordSchema, { ...valid, oldPassword }).map(
          (i) => i.path,
        ),
      ).toContain('oldPassword');
    }
  });

  it('旧密码长度上限沿用历史值 128：19 位以上的历史密码仍可提交（否则老用户被锁死）', () => {
    const legacyOld = 'a'.repeat(24) + '1234'; // 28 位，新规则下是超长密码
    expect(
      changePasswordSchema.parse({ ...valid, oldPassword: legacyOld })
        .oldPassword,
    ).toBe(legacyOld);
    // 同一串放进 password（=设置新密码）就被规则拦下
    const issues = expectFail(changePasswordSchema, {
      ...valid,
      password: legacyOld,
    });
    expect(issues.map((i) => i.path)).toContain('password');
  });

  it('旧密码超过 128 位 → 拒绝，且不会送进 scrypt', () => {
    expect(
      expectFail(changePasswordSchema, {
        ...valid,
        oldPassword: 'a'.repeat(129),
      })[0]?.path,
    ).toBe('oldPassword');
  });

  it('新密码仍受规则约束：纯数字 → 400 且错误归属只在 password', () => {
    const issues = expectFail(changePasswordSchema, {
      ...valid,
      password: '12345678',
    });
    expect(issues.map((i) => i.path)).toEqual(['password']);
    expect(issues.map((i) => i.message)).toContain(
      '密码需至少包含字母、数字、下划线中的两种',
    );
  });

  it('新密码含白名单外字符 → 400（空格 / 连字符 / 中文都不放行）', () => {
    for (const password of ['pass 1234', 'pass-1234', '密码abcd1234']) {
      expect(
        expectFail(changePasswordSchema, { ...valid, password }).map(
          (i) => i.path,
        ),
      ).toContain('password');
    }
  });

  it('新密码全为空白 → trim 成空串后被长度下限拒绝', () => {
    expect(
      expectFail(changePasswordSchema, { ...valid, password: '        ' })[0]
        ?.path,
    ).toBe('password');
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
    // 角色码只校验形状（小写开头、2~32 字符），"未配置"由 service 查库后答 409
    ['非法角色码格式', { roles: ['Root'] }],
  ])('%s → 字段级 400（不再被静默吞掉后落到 refine）', (_label, input) => {
    const issues = expectFail(updateUserSchema, input);
    expect(issues.map((i) => i.path)).toContain(
      _label === '非法角色码格式' ? 'roles.0' : 'nickname',
    );
    expect(issues.map((i) => i.message)).not.toContain('至少提供一个更新字段');
  });

  it('显式 null → 类型错误（PATCH 里 null ≠ "没有值"，后端不代为解释）', () => {
    const issues = expectFail(updateUserSchema, { nickname: null });
    expect(issues[0]?.message).toContain('received null');
  });

  it('经管道后显式 null 仍是类型错误（body 不做空值归一化）', () => {
    const pipe = createZodValidationPipe(updateUserSchema);
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
    expect(updateUserSchema.parse({ nickname: '  小明  ', points: 5 })).toEqual(
      {
        nickname: '小明',
        points: 5,
      },
    );
  });
});

describe('queryUsersSchema：schema 自身严格，宽容由 query 管道提供', () => {
  const queryPipe = createZodValidationPipe(queryUsersSchema);

  it('空查询 → 第一页 / 10 条 / 修改时间倒序', () => {
    expect(queryPipe.transform({}, QUERY)).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: 'updatedAt',
      order: 'desc',
    });
  });

  it('sortBy 白名单包含 updatedAt 与 createdAt（后者仍可按需显式指定）', () => {
    expect(queryUsersSchema.parse({ sortBy: 'updatedAt' }).sortBy).toBe(
      'updatedAt',
    );
    expect(queryUsersSchema.parse({ sortBy: 'createdAt' }).sortBy).toBe(
      'createdAt',
    );
    // 未列入白名单的列（如 deletedAt）仍拒绝
    expect(expectFail(queryUsersSchema, { sortBy: 'deletedAt' })[0]?.path).toBe(
      'sortBy',
    );
  });

  it('keyword 空白 → 经 query 管道视为未提供（直接 parse schema 则被 min(1) 拒绝）', () => {
    expect(
      queryPipe.transform({ keyword: '   ' }, QUERY).keyword,
    ).toBeUndefined();
    expect(expectFail(queryUsersSchema, { keyword: '   ' })[0]?.path).toBe(
      'keyword',
    );
  });

  it('keyword 带空白 → 规范化', () => {
    expect(queryUsersSchema.parse({ keyword: '  小明  ' }).keyword).toBe(
      '小明',
    );
  });

  it('枚举字段带空白 → 规范化后正常解析', () => {
    const dto = queryUsersSchema.parse({
      role: ' student ',
      sortBy: ' points ',
      order: ' asc ',
    });
    expect(dto).toMatchObject({
      role: 'student',
      sortBy: 'points',
      order: 'asc',
    });
  });

  it('枚举值大小写敏感（trim 不做大小写折叠）', () => {
    expect(expectFail(queryUsersSchema, { order: ' ASC ' })[0]?.path).toBe(
      'order',
    );
  });

  it('角色码只校验形状，不校验是否为内置角色', () => {
    expect(queryUsersSchema.parse({ role: 'teacher' }).role).toBe('teacher');
    // 'root' 形状合法就通过：某个码是否已配置由 service 查库回答（409），
    // 这里报 400 会变成"数据没配好却责怪请求方"
    expect(queryUsersSchema.parse({ role: 'root' }).role).toBe('root');
    // 真正被拒的是形状：大写开头、含空格
    expect(expectFail(queryUsersSchema, { role: 'Root' })[0]?.path).toBe('role');
    expect(expectFail(queryUsersSchema, { role: 'a b' })[0]?.path).toBe('role');
  });
});

describe('studentNoParamSchema：路径参数校验', () => {
  it('首尾空白被规范化', () => {
    expect(studentNoParamSchema.parse('  20250001  ')).toBe('20250001');
  });

  it('纯空白 → trim 成空串后被 min(1) 拒绝', () => {
    expect(expectFail(studentNoParamSchema, '   ')[0]?.message).toContain(
      '>=1',
    );
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
    expect(expectFail(idParamSchema, input)[0]?.message).toBe(
      'ID 必须是正整数',
    );
  });

  it('0 / 000 → 非正整数', () => {
    expect(expectFail(idParamSchema, '0')[0]?.message).toContain('>0');
    expect(expectFail(idParamSchema, '000')[0]?.message).toContain('>0');
  });

  it('超出安全整数 → Too big（不把失真浮点数带进 DB）', () => {
    expect(
      expectFail(idParamSchema, '99999999999999999999')[0]?.message,
    ).toMatch(/Too big/i);
  });

  it('经管道后失败形态符合契约：message 固定 + errors 数组', () => {
    const pipe = createZodValidationPipe(idParamSchema);
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
      expect(response.errors).toEqual([
        { path: '', message: 'ID 必须是正整数' },
      ]);
    }
  });

  it('经管道后空白值同样被拒绝（param 不在 query 宽容范围内）', () => {
    const pipe = createZodValidationPipe(idParamSchema);
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

/**
 * 把「对外字段白名单」冻结成可回归的契约（`dto/user.dto.ts`）。
 *
 * 这里断言的是**当前认可的公开字段集**：往 `userPublicColumns` 里加列会让本文件失败，
 * 逼改动者显式确认「客户端真的需要这个字段吗」。
 *
 * `roles` 不在断言里：它来自 `user_roles` 关联表，是 `UserResponse` 上的派生字段，
 * 不是单表列（PostgreSQL 的 RETURNING 不允许子查询，所以它进不了这份投影）。
 */
describe('userPublicColumns（对外字段白名单）', () => {
  it('逻辑字段冻结为契约 —— 增删列必须同步改此断言', () => {
    expect(Object.keys(userPublicColumns).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'nickname',
      'points',
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

  it('不含 users.role —— 单值角色列已删除，角色只经 user_roles 暴露为 roles[]', () => {
    expect(userPublicColumns).not.toHaveProperty('role');
  });
});

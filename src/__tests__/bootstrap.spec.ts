import type { INestApplication, LoggerService } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/server.js';
import { hashToken } from '@/shared/auth/token.js';

/**
 * 用假 `DatabaseService` 替换真实实现（@Global 模块里的 provider），
 * 让整条 HTTP 链路（中间件 → 管道 → 控制器 → 服务 → 过滤器）不依赖真实库运行。
 *
 * drizzle 的查询构造器是链式的，mock 按「投影列里是否含 `id`/`studentNo`」区分场景：
 * - 认证中间件：查会话（含 `lastUsedAt`）→ 返回固定会话；再查用户（含 `nickname`）→ 返回固定用户
 * - 其余查询 → 空集（列表为空、详情 404），由各用例断言预期的状态码
 */
vi.mock('@/database/database.service.js', () => ({
  DatabaseService: class {
    db = {
      select: (projection: Record<string, unknown>) => {
        /**
         * 按投影列推断是哪条查询（drizzle 链式 API 的最小替身）。
         *
         * - 会话命中：投影含 `lastUsedAt`
         * - 用户命中：投影含 `nickname`
         * - 角色→权限码（PermissionService.load）：投影同时含 `role` 与 `code`
         * - 角色列表 / 用户角色集合：投影含 `code`
         * - 其余（列表、详情、重放检测）：空集 / 计数 0
         */
        const rows = (): unknown[] => {
          if ('lastUsedAt' in projection) {
            return [{ id: 7, userId: 1, lastUsedAt: new Date() }];
          }
          if ('role' in projection && 'code' in projection) {
            // admin 持通配码：超级管理员，短路所有权限点
            return [{ role: 'admin', code: '*' }];
          }
          if ('code' in projection) return [{ code: 'admin' }];
          if ('nickname' in projection) {
            return [
              {
                id: 1,
                studentNo: '2019010002',
                email: 'stu@example.edu.cn',
                nickname: '董婷',
                role: 'admin',
                points: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ];
          }
          return [];
        };

        // 允许任意次数的 join 链（`role_permissions ⋈ roles ⋈ permissions` 有两次）
        const chain: Record<string, unknown> = {};
        chain.innerJoin = () => chain;
        chain.where = () => chain;
        // `orderBy` 既要能被 await（角色查询），也要支持 `.limit().offset()`（分页列表）
        const ordered: Record<string, unknown> = {
          limit: () => ({ offset: async () => [] }),
          // oxlint-disable-next-line unicorn/no-thenable
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(rows()).then(resolve),
        };
        chain.orderBy = () => ordered;
        chain.limit = async () => rows();
        // oxlint-disable-next-line unicorn/no-thenable
        chain.then = (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows()).then(resolve);

        return {
          from: () => ({
            ...chain,
            // 计数查询（列表 total）走 thenable，与真实 paginate 的用法对齐
            // oxlint-disable-next-line unicorn/no-thenable
            then: (resolve: (value: unknown[]) => unknown) =>
              Promise.resolve([{ value: 0 }]).then(resolve),
            orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
            limit: async () => rows(),
          }),
        };
      },
      insert: () => ({
        values: () => ({ returning: async () => [], onConflictDoNothing: () => ({}) }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [] }) }),
      }),
    };

    /** 就绪检查探活：假库恒可用（真实失败分支由 health.service 的单测覆盖） */
    async ping(): Promise<void> {}
  },
}));

/** 静音 logger：测试不写日志文件，也不污染输出 */
const quietLogger: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
  fatal: () => undefined,
};

/** 认证中间件可识别的假 token（其 sha256 会命中上面 mock 的会话查询） */
const VALID_TOKEN = 'e2e-valid-access-token';
const AUTH_HEADER = { Authorization: `Bearer ${VALID_TOKEN}` };

let app: INestApplication;

beforeAll(async () => {
  app = await createApp(quietLogger);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('应用启动与全局 HTTP 生命周期', () => {
  it('公开路由：存活检查不需要登录', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'ok' });
  });

  // 假库的 `ping()` 恒成功，因此这里断言的是"路由通了且经过统一契约"；
  // 数据库不可达 → 503 的分支由 `health.service` 的单元测试覆盖
  it('公开路由：就绪检查挂在根上，探活成功返回 ok', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', database: 'ok' },
    });
  });

  it('受保护路由无 token → 401（守卫拦截，过滤器产出失败契约）', async () => {
    const res = await request(app.getHttpServer()).get('/users?pageSize=1');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, data: null });
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  // mock 对任何 token 摘要都返回同一会话，"乱码 token" 的 401 分支无法在此覆盖，
  // 真实行为由已运行服务上的 E2E（`Authorization: Bearer garbage-token` → 401）验证
  it('token 摘要进入会话查询（hashToken 稳定）', async () => {
    expect(hashToken('not-a-real-token')).toHaveLength(64);
    expect(hashToken('not-a-real-token')).toBe(hashToken('not-a-real-token'));
  });

  it('有效 token → 会话查询命中，正常返回（mock 下的用户列表）', async () => {
    // 中间件按 hashToken(VALID_TOKEN) 查会话，mock 对任何摘要都返回同一会话
    expect(hashToken(VALID_TOKEN)).toHaveLength(64);

    const res = await request(app.getHttpServer())
      .get('/users?pageSize=1')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'ok',
      data: { items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 },
    });
  });

  it('登录接口公开：body 校验失败走 400 + errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ studentNo: '', password: '' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, data: null });
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual([
      'studentNo',
      'password',
    ]);
  });

  it('参数校验失败：400 + success:false + errors[].path（受保护路由在管道之前先 401）', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set(AUTH_HEADER)
      .send({
        studentNo: '20250001',
        email: 'a@b.com',
        nickname: '',
        password: 'pass1234',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, data: null });
    expect(res.body.errors[0].path).toBe('nickname');
  });

  it('路径参数非法：400 且错误路径为空串（根级）', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/abc')
      .set(AUTH_HEADER);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: '', message: 'ID 必须是正整数' }]);
  });

  it('按 ID 详情：mock 下返回固定用户（200 + 白名单字段）', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/1')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { id: 1, studentNo: '2019010002', nickname: '董婷', role: 'admin' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|deletedAt|tokenHash/,
    );
  });

  it('未命中路由：404 也走失败契约，且带 x-trace-id', async () => {
    const res = await request(app.getHttpServer()).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  it('malformed JSON：body parser 的 400 同样带 x-trace-id（中间件早于 body parser）', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Content-Type', 'application/json')
      .send('{bad');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.headers['x-trace-id']).toBeTruthy();
  });

  it('入站 x-trace-id 透传到响应头', async () => {
    const res = await request(app.getHttpServer())
      .get('/users?pageSize=1')
      .set('x-trace-id', 'abc-123')
      .set(AUTH_HEADER);

    expect(res.headers['x-trace-id']).toBe('abc-123');
  });

  it('query 空值宽容：分页与筛选参数传空串仍正常返回', async () => {
    const res = await request(app.getHttpServer())
      .get('/users?page=&pageSize=&keyword=')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('响应体不包含白名单外的列', async () => {
    const res = await request(app.getHttpServer())
      .get('/users?pageSize=1')
      .set(AUTH_HEADER);

    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|deletedAt|tokenHash/,
    );
  });
});

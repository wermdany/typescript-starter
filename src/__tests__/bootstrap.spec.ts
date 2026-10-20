import type { INestApplication, LoggerService } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/server.js';

/**
 * 用假 `DatabaseService` 替换真实实现（@Global 模块里的 provider），
 * 让整条 HTTP 链路（中间件 → 管道 → 控制器 → 服务 → 过滤器）不依赖真实库运行。
 * `db` 返回可链式调用的查询构造器，各分支解析为固定数据。
 */
vi.mock('@/database/database.service.js', () => ({
  DatabaseService: class {
    db = {
      // 列表：select → from → where → orderBy → limit → offset
      // 计数：select → from → where（带 then）；详情：select → from → where → limit
      select: () => ({
        from: () => ({
          where: () => ({
            // drizzle 的查询构造器本身是 thenable，等待时才执行（此处直接解析为空集）
            // oxlint-disable-next-line unicorn/no-thenable
            then: (resolve: (rows: unknown[]) => unknown) =>
              Promise.resolve([]).then(resolve),
            limit: async () => [],
            orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({ returning: async () => [] }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [] }) }),
      }),
    };
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

let app: INestApplication;

beforeAll(async () => {
  app = await createApp(quietLogger);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('应用启动与全局 HTTP 生命周期', () => {
  it('成功响应走统一契约：success / message / data', async () => {
    const res = await request(app.getHttpServer()).get('/users?pageSize=1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'ok',
      data: { items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 },
    });
  });

  it('参数校验失败：400 + success:false + errors[].path', async () => {
    const res = await request(app.getHttpServer()).post('/users').send({
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
    const res = await request(app.getHttpServer()).get('/users/abc');

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: '', message: 'ID 必须是正整数' }]);
  });

  it('资源不存在：404 + 短原因，不泄漏内部细节', async () => {
    const res = await request(app.getHttpServer()).get('/users/1');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: '用户不存在',
      data: null,
    });
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
      .set('x-trace-id', 'abc-123');

    expect(res.headers['x-trace-id']).toBe('abc-123');
  });

  it('query 空值宽容：分页与筛选参数传空串仍正常返回', async () => {
    const res = await request(app.getHttpServer()).get(
      '/users?page=&pageSize=&keyword=',
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('响应体不包含白名单外的列', async () => {
    const res = await request(app.getHttpServer()).get('/users?pageSize=1');

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|deletedAt/);
  });
});

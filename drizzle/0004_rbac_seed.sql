/*
 * 自定义迁移（custom migration）：RBAC 种子数据（roles / permissions / role_permissions）
 *
 * 由 `pnpm db:generate --custom --name=rbac_seed` 生成，`pnpm db:migrate` 执行，
 * 记录于 drizzle.__drizzle_migrations，遵循 drizzle 正规迁移流程。
 *
 * 数据形态（对齐 docs/rbac-plan.md §4.3）：
 *   - roles            student(学生, level 0) / teacher(教师, 10) / admin(超级管理员, 100)
 *   - permissions      10 行：通配 `*` + 9 个业务码（user / session / login-log 三组）
 *   - role_permissions admin 长期持有 `*`；student / teacher 不预置授权
 *                      （自助路由靠 @Authenticated() + Ownership，需要差异化时 INSERT 即可）
 *
 * 幂等性：三条 INSERT 全部带 ON CONFLICT，重复执行只刷新字典字段，不产生重复行。
 *   - roles            冲突目标是**部分唯一索引** roles_code_alive_idx，ON CONFLICT 必须带同样的 WHERE 谓词
 *   - permissions      code 是列级 unique
 *   - role_permissions (role_id, permission_id) 复合唯一索引
 */

-- ─── 角色字典 ────────────────────────────────────────────────
INSERT INTO "roles" ("code", "name", "description", "level")
VALUES
  ('student', '学生', '默认角色：仅可操作本人资源', 0),
  ('teacher', '教师', '教师：需要差异化授权时按需写入 role_permissions', 10),
  ('admin', '超级管理员', '超级管理员：长期持有通配权限 *，仅用于运维', 100)
ON CONFLICT ("code") WHERE "deleted_at" IS NULL
DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "level" = EXCLUDED."level",
  "updated_at" = now();
--> statement-breakpoint

-- ─── 权限点字典 ──────────────────────────────────────────────
INSERT INTO "permissions" ("code", "name", "description", "group")
VALUES
  ('*', '全部权限', '通配：持有即拥有全部权限，仅授予超级管理员', 'system'),
  ('user:create', '创建用户', 'POST /users', 'user'),
  ('user:read', '查看用户', 'GET /users 与 GET /users/:id', 'user'),
  ('user:update', '修改用户', 'PATCH /users/:id（非本人时要求）', 'user'),
  ('user:delete', '删除用户', 'DELETE /users/:id', 'user'),
  ('user:restore', '恢复用户', 'POST /users/restore/:id', 'user'),
  ('user:reset-password', '重置密码', 'PATCH /users/password/:id', 'user'),
  ('session:read', '查看会话', 'GET /users/:id/sessions', 'session'),
  ('session:revoke', '吊销会话', 'DELETE /users/:id/sessions/:sessionId', 'session'),
  ('login-log:read', '查看登录日志', 'GET /users/:id/login-logs', 'login-log')
ON CONFLICT ("code")
DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "group" = EXCLUDED."group",
  "updated_at" = now();
--> statement-breakpoint

-- ─── 角色授权：admin 持有通配权限 ────────────────────────────
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = '*'
WHERE r."code" = 'admin' AND r."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

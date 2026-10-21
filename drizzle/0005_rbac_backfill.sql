-- 0005_rbac_backfill
--
-- 目的：把单值列 `users.role`（pgEnum user_role）回填到多角色关联表 `user_roles`。
-- 幂等：重复执行不会产生重复绑定（ON CONFLICT DO NOTHING，命中 (user_id, role_id) WHERE deleted_at IS NULL 部分唯一索引）。
-- 安全：回填后立即做两道差异校验；任一不通过即 RAISE EXCEPTION，
--       迁移整体回滚、后续语句（含删列）绝不会被执行。
-- 口径：**软删用户同样回填** —— 恢复账号时必须还有角色，否则会出现"无角色用户"这种无人能解释的状态。

-- 1) 回填：users.role → user_roles
--    pgEnum → varchar 需要显式 ::text 转换；只绑定未软删的角色行。
INSERT INTO "user_roles" ("user_id", "role_id", "granted_by")
SELECT u."id", r."id", 'migration:0005'
FROM "users" u
JOIN "roles" r ON r."code" = u."role"::text
WHERE r."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2) 校验 A：不允许存在"没有任何角色"的用户
DO $$
DECLARE
  missing BIGINT;
BEGIN
  SELECT count(*) INTO missing
  FROM "users" u
  WHERE NOT EXISTS (
    SELECT 1 FROM "user_roles" ur
    WHERE ur."user_id" = u."id" AND ur."deleted_at" IS NULL
  );

  IF missing > 0 THEN
    RAISE EXCEPTION 'RBAC backfill 校验 A 失败：% 个用户没有有效角色绑定，禁止继续', missing;
  END IF;
END $$;
--> statement-breakpoint

-- 3) 校验 B：对账（user_roles 行数 ≥ users 行数）+ 不允许绑定到已软删角色
DO $$
DECLARE
  user_total BIGINT;
  link_total BIGINT;
  dead_role_links BIGINT;
BEGIN
  SELECT count(*) INTO user_total FROM "users";
  SELECT count(*) INTO link_total FROM "user_roles" WHERE "deleted_at" IS NULL;
  SELECT count(*) INTO dead_role_links
  FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."role_id"
  WHERE r."deleted_at" IS NOT NULL;

  RAISE NOTICE 'RBAC backfill 对账：users=%, user_roles=%', user_total, link_total;

  IF link_total < user_total THEN
    RAISE EXCEPTION 'RBAC backfill 校验 B 失败：绑定数 % 少于用户数 %，禁止继续', link_total, user_total;
  END IF;

  IF dead_role_links > 0 THEN
    RAISE EXCEPTION 'RBAC backfill 校验 B 失败：% 条绑定指向已软删角色，禁止继续', dead_role_links;
  END IF;
END $$;

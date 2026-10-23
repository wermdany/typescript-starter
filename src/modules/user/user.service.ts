import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';

import {
  hashPassword,
  paginate,
  type PageResponse,
  verifyPassword,
} from '@/shared/common.js';
import {
  FORBIDDEN_MESSAGE,
  PERMISSION_CHECKER,
  WILDCARD_PERMISSION,
  assertOwnership,
  isSystemActor,
  type Actor,
  type PermissionChecker,
  type PermissionCode,
  type RoleCode,
} from '@/shared/auth.js';
import { filterUpdatable, policyKeyFor } from './update-policy.js';
import { DatabaseService, type Db } from '@/database/database.service.js';
import { users } from '@/database/schema/users.schema.js';
import { roles, userRoles } from '@/database/schema/rbac.schema.js';
import { SessionService } from '@/modules/auth/session/session.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import {
  toUserResponse,
  userPublicColumns,
  type UserResponse,
  type UserScalars,
} from './dto/user.dto.js';

/**
 * 用户管理服务：全部业务逻辑（Drizzle 查询、密码哈希、越权判定）。
 *
 * 唯一约束冲突（23505）**不在这里转 409**：全局错误映射链
 * （`common/api-response/error-mapping.ts`）统一负责，因此本文件没有一处
 * `catch (err)` 只为改状态码。
 */
@Injectable()
export class UserService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: SessionService,
    @Inject(PERMISSION_CHECKER)
    private readonly permissions: PermissionChecker,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * 跨用户操作的前置判定：**只看权限码，不看角色**。
   *
   * 判据必须是权限码（`user:delete` / `user:restore` / `user:reset-password`），
   * 不能是角色：把"能不能动别人的资源"绑死在 admin 上，将来要加一个"能删用户但不能
   * 重置密码"的角色就只能改业务代码。角色只是权限码的载体 —— 授权关系在数据库里改，
   * 业务代码不动。
   *
   * 系统身份（`systemActor`）直接放行：它不持有任何角色，按 §17 的约定 `ownsResource` 恒为真。
   * 通配码 `*` 与其它码同等处理，与路由守卫的判定保持一致。
   */
  private async mayActOnOthers(
    actor: Actor,
    code: PermissionCode,
  ): Promise<boolean> {
    if (isSystemActor(actor)) return true;
    const granted = await this.permissions.resolveCodes(actor);
    return granted.has(WILDCARD_PERMISSION) || granted.has(code);
  }

  /** 创建用户（哈希在 DB 操作之前计算，不占用连接） */
  async create(dto: CreateUserDto): Promise<UserResponse> {
    const passwordHash = await hashPassword(dto.password);
    // 建用户 + 建角色绑定：同一事务。分开写会出现"用户已存在但没有任何角色"
    // 的窗口，而这种用户在认证侧的角色集合为空 —— 等于建了一个不能登录的账号
    const user = await this.database.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          studentNo: dto.studentNo,
          email: dto.email,
          nickname: dto.nickname,
          passwordHash,
          points: dto.points,
        })
        .returning(userPublicColumns);

      await this.grantRoles(tx, created.id, dto.roles, 'user:create');
      return created;
    });
    // 回读一次而不是直接拼 dto.roles：响应里的角色顺序必须与后续 GET 完全一致
    // （`level` 降序、`code` 升序），拼出来的数组做不到这一点。
    // 唯一约束冲突（23505）由 `common/api-response/error-mapping.ts` 的映射链转 409，
    // service 不 catch
    return this.withRoles(user);
  }

  /** 分页查询（软删除用户不可见），默认按修改时间降序 */
  async findAll(query: QueryUsersDto): Promise<PageResponse<UserResponse>> {
    const conditions: SQL[] = [isNull(users.deletedAt)];
    if (query.keyword) {
      const pattern = `%${escapeLike(query.keyword)}%`;
      conditions.push(
        or(
          ilike(users.nickname, pattern),
          ilike(users.studentNo, pattern),
          ilike(users.email, pattern),
        ) as SQL,
      );
    }
    if (query.role) {
      // 角色已不在 users 表上，筛选必须下推到关联表。用 EXISTS 而不是 JOIN：
      // 一个用户可有多个角色，JOIN 会让行数与 total 一起膨胀
      conditions.push(
        exists(
          this.db
            .select({ one: userRoles.id })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(
                eq(userRoles.userId, users.id),
                isNull(userRoles.deletedAt),
                isNull(roles.deletedAt),
                eq(roles.code, query.role),
              ),
            ),
        ),
      );
    }
    const where = and(...conditions);

    // 映射表必须覆盖 DTO 的 sortBy 枚举全集（缺项时 TS 在索引处报错）
    const sortColumn = {
      nickname: users.nickname,
      studentNo: users.studentNo,
      email: users.email,
      points: users.points,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }[query.sortBy];
    const orderBy = query.order === 'desc' ? desc(sortColumn) : asc(sortColumn);

    return paginate(
      (limit, offset) => ({
        rows: this.db
          .select(userPublicColumns)
          .from(users)
          .where(where)
          .orderBy(orderBy)
          .limit(limit)
          .offset(offset)
          // 角色用一次批量查询补齐整页，避免每行一次查询（N+1）
          .then(async (rows) => {
            const byUser = await this.rolesOf(rows.map((row) => row.id));
            return rows.map((row) =>
              toUserResponse(row, byUser.get(row.id) ?? []),
            );
          }),
        total: this.db
          .select({ value: count() })
          .from(users)
          .where(where)
          .then((rows) => rows[0]?.value ?? 0),
      }),
      query.page,
      query.pageSize,
    );
  }

  /** 当前用户资料（会话里的身份 → 库里的记录） */
  findMe(userId: number): Promise<UserResponse> {
    return this.findOne(userId);
  }

  /** 按 ID 查询详情（软删除用户不可见） */
  async findOne(id: number): Promise<UserResponse> {
    const [user] = await this.db
      .select(userPublicColumns)
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.withRoles(user);
  }

  /** 按学号查询详情（软删除用户不可见） */
  async findByStudentNo(studentNo: string): Promise<UserResponse> {
    const [user] = await this.db
      .select(userPublicColumns)
      .from(users)
      .where(and(eq(users.studentNo, studentNo), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.withRoles(user);
  }

  /**
   * 更新用户资料（密码不在此修改）。
   *
   * 两道防线：
   * 1. **归属**：`policyKeyFor` 先分出 `system / admin / self / none`，
   *    `none` 直接 403 —— 不能靠"字段白名单恰好是空集"兜底，否则将来往
   *    `self` 里加一个字段，就等于把该字段的写权限发给了所有登录用户
   * 2. **字段级**：白名单（`update-policy.ts`）。本人只能改 `email` / `nickname`，
   *    管理员可改全部字段；越权字段 → 403 且错误信息直接列出字段名
   *
   * 首参是 `Actor` 而不是 `AuthenticatedUser`：内部调用必须显式传
   * `systemActor('via ...')`，无法靠"漏传参数"绕过归属判定。
   */
  async update(
    actor: Actor,
    id: number,
    dto: UpdateUserDto,
  ): Promise<UserResponse> {
    if (policyKeyFor(actor, id) === 'none') {
      // 非本人且非管理员：不查库、不区分用户是否存在，避免把 id 空间当探测面
      throw new ForbiddenException('只能修改自己的资料');
    }
    const { allowed, denied } = filterUpdatable(actor, id, dto);
    if (denied.length > 0) {
      throw new ForbiddenException(`无权修改字段：${denied.join('、')}`);
    }
    if (Object.keys(allowed).length === 0) {
      // DTO refine 保证非空，这里兜住"字段全被过滤"的边界
      throw new ForbiddenException('无权修改任何字段');
    }

    // roles 不是 users 表的列，剥出来单独走关联表；其余字段照常进 set()
    const { roles: nextRoles, ...scalarPatch } = allowed;

    const user = await this.database.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ ...scalarPatch, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning(userPublicColumns);
      if (!updated) {
        throw new NotFoundException('用户不存在');
      }
      if (nextRoles) {
        // 角色集合是整体替换：先软删旧绑定再插新的，留痕可查
        await this.replaceRoles(tx, id, nextRoles as RoleCode[]);
      }
      return updated;
    });
    // 同 create：角色集合回读，响应顺序与 GET 一致。
    // 事务内抛的 NotFoundException 原样上抛，由过滤器转 404
    return this.withRoles(user);
  }

  /**
   * 软删除（where 同时要求未删除，防重复删除）。
   *
   * 删除成功后吊销该用户全部会话：账号没了，登录态不能继续生效。
   *
   * 准入 = 权限码（路由上的 `@RequirePermission('user:delete')`）**且**
   * 归属（此处第二道防线）：管理员可删任何人，其它身份只能删自己。
   * 只做前者的话，"持有权限码"等于"可以删所有人的账号"，一个误授权就是批量事故；
   * 只做后者的话，管理员反而删不了别人 —— 两道一起才闭合。
   */
  async softDelete(actor: Actor, id: number): Promise<UserResponse> {
    if (!(await this.mayActOnOthers(actor, 'user:delete'))) {
      assertOwnership(actor, id, '只能删除自己的账号');
    }
    // 软删 + 吊销全部会话：同一事务。非原子时存在"用户已删但 token 仍有效"的窗口，
    // 被删用户在窗口内还能继续操作 —— 恰是删除要阻止的事
    const user = await this.database.transaction(async (tx) => {
      const now = new Date();
      const [deleted] = await tx
        .update(users)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning(userPublicColumns);
      if (!deleted) {
        throw new NotFoundException('用户不存在');
      }
      await this.sessions.revokeAllForUser(id, 'account_deleted', {
        executor: tx,
      });
      return deleted;
    });
    return this.withRoles(user);
  }

  /** 恢复软删除用户（email 可能与现存用户冲突，由全局映射链转 409）；归属规则同 `softDelete` */
  async restore(actor: Actor, id: number): Promise<UserResponse> {
    if (!(await this.mayActOnOthers(actor, 'user:restore'))) {
      assertOwnership(actor, id, '只能恢复自己的账号');
    }
    const now = new Date();
    const [user] = await this.db
      .update(users)
      .set({ deletedAt: null, updatedAt: now })
      // isNotNull 保证只恢复已删除的用户
      .where(and(eq(users.id, id), isNotNull(users.deletedAt)))
      .returning(userPublicColumns);
    if (!user) {
      throw new NotFoundException('用户不存在或未删除');
    }
    return this.withRoles(user);
  }

  /**
   * 修改密码：先验旧密码，通过后才写新哈希。
   *
   * 1. 权限：本人的密码可以凭旧密码修改；持有 `user:reset-password`（或系统身份）重置他人密码
   *    **不需要**旧密码（`oldPassword` 传什么都会被忽略，避免重置者拿到用户历史密码）
   * 2. 显式 select `passwordHash`（该列不在公开白名单里）
   * 3. 先判存在再比对 —— scrypt 慢，不存在就没必要派生
   * 4. 旧密码不符返回 401：参数合法，失败点在凭据，客户端要能把两者区分开
   * 5. 新哈希在校验通过之后才计算
   * 6. 写库成功后吊销该用户的全部会话（`keepSessionId` 可保留当前设备，
   *    用于本人改密后"这台继续用"）：改密意味着"其它地方的登录都不可信了"
   */
  async changePassword(
    actor: Actor,
    id: number,
    dto: ChangePasswordDto,
    keepSessionId?: number,
  ): Promise<void> {
    const privileged = await this.mayActOnOthers(actor, 'user:reset-password');
    if (!privileged) {
      // 第二道防线：路由上只要求"登录"，能不能改这个 id 由这里回答。
      // 用 assertOwnership 而不是手写 `actor.id !== id`：归属语义只有一处定义
      assertOwnership(actor, id, FORBIDDEN_MESSAGE);
    }

    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 持有 user:reset-password 的身份重置他人密码不走旧密码校验；本人改自己的必须验旧密码
    if (!privileged) {
      const matched = await verifyPassword(dto.oldPassword, user.passwordHash);
      if (!matched) {
        throw new UnauthorizedException('旧密码不正确');
      }
    }

    const passwordHash = await hashPassword(dto.password);

    // 写新哈希 + 吊销会话：同一事务。非原子时存在"密码已改但旧会话仍有效"的窗口，
    // 正是改密要终止的风险
    await this.database.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });
      // 读与写之间用户被软删的竞态
      if (updated.length === 0) {
        throw new NotFoundException('用户不存在');
      }

      await this.sessions.revokeAllForUser(id, 'password_changed', {
        exceptSessionId: keepSessionId,
        executor: tx,
      });
    });
  }

  /** 单条记录补角色（读路径的唯一合并出口） */
  private async withRoles(user: UserScalars): Promise<UserResponse> {
    const byUser = await this.rolesOf([user.id]);
    return toUserResponse(user, byUser.get(user.id) ?? []);
  }

  /**
   * 批量取用户角色集合并成 `userId → RoleCode[]`。
   *
   * 一次 `IN` 查询解决整页，不做 N+1。只认**存活**绑定与**存活**角色：
   * 软删一个角色等于回收它带来的全部权限，读路径不能装作它还生效。
   * 排序与认证侧（`AccountService.findRoleCodes`）一致 —— `level` 降序、`code` 升序，
   * 保证同一用户在 `/auth/me` 与 `/users/:id` 拿到的顺序相同。
   */
  private async rolesOf(
    userIds: readonly number[],
  ): Promise<Map<number, RoleCode[]>> {
    const byUser = new Map<number, RoleCode[]>();
    if (userIds.length === 0) {
      return byUser;
    }
    const rows = await this.db
      .select({ userId: userRoles.userId, code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(userRoles.userId, [...userIds]),
          isNull(userRoles.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .orderBy(desc(roles.level), asc(roles.code));
    for (const row of rows) {
      const list = byUser.get(row.userId);
      if (list) {
        list.push(row.code as RoleCode);
      } else {
        byUser.set(row.userId, [row.code as RoleCode]);
      }
    }
    return byUser;
  }

  /**
   * 给用户绑定角色集合（`user_roles` 的**唯一写入口**）。
   *
   * 幂等：重复绑定同一角色不报错（命中部分唯一索引时跳过）。
   * 角色码在 `roles` 表里不存在属于数据配置问题 —— 抛 409 而不是静默跳过，
   * 否则用户会变成"零角色"，表现为登录后处处 403，排查成本极高。
   */
  private async grantRoles(
    tx: Db,
    userId: number,
    codes: readonly RoleCode[],
    grantedBy: string,
  ): Promise<void> {
    const found = await tx
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(and(inArray(roles.code, [...codes]), isNull(roles.deletedAt)));
    const idByCode = new Map(found.map((role) => [role.code, role.id]));
    const missing = codes.filter((code) => !idByCode.has(code));
    if (missing.length > 0) {
      throw new ConflictException(`角色未配置：${missing.join('、')}`);
    }
    await tx
      .insert(userRoles)
      .values(
        codes.map((code) => ({
          userId,
          roleId: idByCode.get(code) as number,
          grantedBy,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * 把用户的角色集合**整体替换**为给定集合。
   *
   * 先软删现有存活绑定再插新的：留痕比物理删除更适合权限数据
   * （谁在什么时候被收走过权限，事后能查）。
   *
   * 不按差集增删：差集要读一遍现状再算，两次读之间可能有并发写；
   * 整体替换的语义更简单，客户端看到的结果也可预测。
   */
  private async replaceRoles(
    tx: Db,
    userId: number,
    codes: readonly RoleCode[],
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(userRoles)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.deletedAt)));
    await this.grantRoles(tx, userId, codes, 'user:update');
  }
}

/** 转义 LIKE 通配符（默认转义符为反斜杠） */
function escapeLike(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (c) => '\\' + c);
}

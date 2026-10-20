import {
  ConflictException,
  ForbiddenException,
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
  ilike,
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
  isAdmin,
  type AuthenticatedUser,
} from '@/shared/auth.js';
import { filterUpdatable } from './update-policy.js';
import { DatabaseService } from '@/database/database.service.js';
import { users } from '@/database/schema/users.schema.js';
import { SessionService } from '@/modules/auth/session/session.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import { userPublicColumns, type UserResponse } from './user.projection.js';

/** 用户管理服务：全部业务逻辑（Drizzle 查询、密码哈希、越权判定、错误转换） */
@Injectable()
export class UserService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: SessionService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** 创建用户（哈希在 DB 操作之前计算，不占用连接） */
  async create(dto: CreateUserDto): Promise<UserResponse> {
    const passwordHash = await hashPassword(dto.password);
    try {
      const [user] = await this.db
        .insert(users)
        .values({
          studentNo: dto.studentNo,
          email: dto.email,
          nickname: dto.nickname,
          passwordHash,
          role: dto.role,
          points: dto.points,
        })
        .returning(userPublicColumns);
      return user;
    } catch (err) {
      this.handlePgError(err);
    }
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
      conditions.push(eq(users.role, query.role));
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
          .offset(offset),
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
    return user;
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
    return user;
  }

  /**
   * 更新用户资料（密码不在此修改）。
   *
   * 字段级权限走**白名单**（`update-policy.ts`）：本人只能改 `email` / `nickname`，
   * 管理员可改全部字段；越权字段 → 403，且错误信息直接列出字段名。
   */
  async update(
    actor: AuthenticatedUser,
    id: number,
    dto: UpdateUserDto,
  ): Promise<UserResponse> {
    const { allowed, denied } = filterUpdatable(actor, id, dto);
    if (denied.length > 0) {
      // 本人改自己之外的资料 / 本人试图改受控字段，文案区分这两种越权
      const outside = actor.id !== id && !isAdmin(actor);
      throw new ForbiddenException(
        outside ? '只能修改自己的资料' : `无权修改字段：${denied.join('、')}`,
      );
    }
    if (Object.keys(allowed).length === 0) {
      // DTO refine 保证非空，这里兜住"字段全被过滤"的边界
      throw new ForbiddenException('无权修改任何字段');
    }

    try {
      const [user] = await this.db
        .update(users)
        .set({ ...allowed, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning(userPublicColumns);
      if (!user) {
        throw new NotFoundException('用户不存在');
      }
      return user;
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * 软删除（where 同时要求未删除，防重复删除）。
   *
   * 删除成功后吊销该用户全部会话：账号没了，登录态不能继续生效。
   */
  async softDelete(id: number): Promise<UserResponse> {
    // 软删 + 吊销全部会话：同一事务。非原子时存在"用户已删但 token 仍有效"的窗口，
    // 被删用户在窗口内还能继续操作 —— 恰是删除要阻止的事
    return this.database.transaction(async (tx) => {
      const now = new Date();
      const [user] = await tx
        .update(users)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning(userPublicColumns);
      if (!user) {
        throw new NotFoundException('用户不存在');
      }
      await this.sessions.revokeAllForUser(id, 'account_deleted', {
        executor: tx,
      });
      return user;
    });
  }

  /** 恢复软删除用户（email 可能与现存用户冲突而 409） */
  async restore(id: number): Promise<UserResponse> {
    try {
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
      return user;
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /**
   * 修改密码：先验旧密码，通过后才写新哈希。
   *
   * 1. 权限：本人的密码可以凭旧密码修改；管理员重置他人密码**不需要**旧密码
   *    （`oldPassword` 传什么都会被忽略，避免管理员拿到用户历史密码）
   * 2. 显式 select `passwordHash`（该列不在公开白名单里）
   * 3. 先判存在再比对 —— scrypt 慢，不存在就没必要派生
   * 4. 旧密码不符返回 401：参数合法，失败点在凭据，客户端要能把两者区分开
   * 5. 新哈希在校验通过之后才计算
   * 6. 写库成功后吊销该用户的全部会话（`keepSessionId` 可保留当前设备，
   *    用于本人改密后"这台继续用"）：改密意味着"其它地方的登录都不可信了"
   */
  async changePassword(
    actor: AuthenticatedUser,
    id: number,
    dto: ChangePasswordDto,
    keepSessionId?: number,
  ): Promise<void> {
    const isSelf = actor.id === id;
    if (!isSelf && !isAdmin(actor)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 管理员重置他人密码不走旧密码校验；本人的密码必须验旧密码
    if (isSelf) {
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

  /**
   * 把 PG 唯一约束冲突（23505）转换为中文 409。
   *
   * drizzle 会把 pg 驱动错误包装为 DrizzleQueryError，原始错误在 `cause` 上，
   * 必须先解包再读 code / constraint。
   */
  private handlePgError(err: unknown): never {
    const cause = (err as { cause?: unknown })?.cause ?? err;
    const { code, constraint } = cause as {
      code?: string;
      constraint?: string;
    };
    if (code === '23505') {
      if (constraint?.includes('student_no')) {
        throw new ConflictException('学号已存在');
      }
      if (constraint?.includes('email_alive_idx')) {
        throw new ConflictException('邮箱已被使用');
      }
      throw new ConflictException('数据唯一性冲突');
    }
    throw err;
  }
}

/** 转义 LIKE 通配符（默认转义符为反斜杠） */
function escapeLike(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (c) => '\\' + c);
}

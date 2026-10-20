import {
  ConflictException,
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
import { DatabaseService } from '@/database/database.service.js';
import { users } from '@/database/schema/users.schema.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import { userPublicColumns, type UserResponse } from './user.projection.js';

/** 用户管理服务：全部业务逻辑（Drizzle 查询、密码哈希、错误转换） */
@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

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

  /** 更新用户资料（密码不在此修改） */
  async update(id: number, dto: UpdateUserDto): Promise<UserResponse> {
    try {
      const [user] = await this.db
        .update(users)
        .set({ ...dto, updatedAt: new Date() })
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

  /** 软删除（where 同时要求未删除，防重复删除） */
  async softDelete(id: number): Promise<UserResponse> {
    const now = new Date();
    const [user] = await this.db
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning(userPublicColumns);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
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
   * 1. 显式 select `passwordHash`（该列不在公开白名单里）
   * 2. 先判存在再比对 —— scrypt 慢，不存在就没必要派生
   * 3. 旧密码不符返回 401：参数合法，失败点在凭据，客户端要能把两者区分开
   * 4. 新哈希在校验通过之后才计算
   */
  async changePassword(id: number, dto: ChangePasswordDto): Promise<void> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const matched = await verifyPassword(dto.oldPassword, user.passwordHash);
    if (!matched) {
      throw new UnauthorizedException('旧密码不正确');
    }

    const passwordHash = await hashPassword(dto.password);
    const updated = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning({ id: users.id });
    // 读与写之间用户被软删的竞态
    if (updated.length === 0) {
      throw new NotFoundException('用户不存在');
    }
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

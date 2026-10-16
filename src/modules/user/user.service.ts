import {
  ConflictException,
  Injectable,
  NotFoundException,
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

import { hashPassword } from '../../common/crypto/password.scrypt.js';
import { paginate, type PageResponse } from '../../common/pagination/paginate.js';
import { DrizzleService } from '../../db/drizzle/drizzle.service.js';
import { users } from '../../db/schema/users.schema.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import { toUserResponse, type UserResponse } from './user.mapper.js';

/** 用户管理服务：全部业务逻辑（Drizzle 查询、密码哈希、错误转换） */
@Injectable()
export class UserService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /** 创建用户（密码 scrypt 哈希在 DB 操作之前执行，不占连接） */
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
        .returning();
      return toUserResponse(user);
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /** 分页查询（软删除用户不可见） */
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

    // 排序字段映射表必须覆盖 DTO 的 sortBy 枚举全集（缺项时 TS 会在索引处报错）
    // 默认排序为「修改时间降序」——见 AGENTS.md 第 7 节
    const sortColumn = {
      nickname: users.nickname,
      studentNo: users.studentNo,
      email: users.email,
      points: users.points,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }[query.sortBy];
    const orderBy = query.order === 'desc' ? desc(sortColumn) : asc(sortColumn);

    const result = await paginate(
      (limit, offset) => ({
        rows: this.db
          .select()
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
    return { ...result, items: result.items.map(toUserResponse) };
  }

  /** 按 ID 查询详情（软删除用户不可见） */
  async findOne(id: number): Promise<UserResponse> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return toUserResponse(user);
  }

  /** 按学号查询详情（软删除用户不可见） */
  async findByStudentNo(studentNo: string): Promise<UserResponse> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.studentNo, studentNo), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return toUserResponse(user);
  }

  /** 更新用户资料（密码不在此修改） */
  async update(id: number, dto: UpdateUserDto): Promise<UserResponse> {
    try {
      // columns.ts 约定：updatedAt 不会自动更新，需应用层手动 set
      const [user] = await this.db
        .update(users)
        .set({ ...dto, updatedAt: new Date() })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();
      if (!user) {
        throw new NotFoundException('用户不存在');
      }
      return toUserResponse(user);
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /** 软删除（防重复删除：where 同时要求未删除），返回删除后的快照 */
  async softDelete(id: number): Promise<UserResponse> {
    const now = new Date();
    const [user] = await this.db
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return toUserResponse(user);
  }

  /** 恢复软删除用户（可能因 email 与现存用户冲突而 409——部分唯一索引仅覆盖未删除行） */
  async restore(id: number): Promise<UserResponse> {
    try {
      const now = new Date();
      const [user] = await this.db
        .update(users)
        .set({ deletedAt: null, updatedAt: now })
        // 不带 isNull 过滤（否则已删用户永远查不到）；isNotNull 保证"恢复已删用户"语义
        .where(and(eq(users.id, id), isNotNull(users.deletedAt)))
        .returning();
      if (!user) {
        throw new NotFoundException('用户不存在或未删除');
      }
      return toUserResponse(user);
    } catch (err) {
      this.handlePgError(err);
    }
  }

  /** 重置密码 */
  async resetPassword(id: number, dto: ResetPasswordDto): Promise<void> {
    const passwordHash = await hashPassword(dto.password);
    const [user] = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
  }

  /**
   * 把 PG 唯一约束冲突（23505）转换为中文 409。
   *
   * 注意：drizzle-orm 会把 pg 驱动错误包装为 DrizzleQueryError，
   * 原始错误在 `cause` 上，需先解包再读 code/constraint。
   *
   * 约束名来源：student_no 是列级 unique（约束名由 drizzle/PG 生成），
   * email 唯一性由部分唯一索引 `users_email_alive_idx` 保证。
   *
   * 后续多表操作场景请使用 `this.drizzle.transaction()` 保证一致性。
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

/** 转义 LIKE 通配符（默认转义符为反斜杠），避免用户输入意外成为通配符 */
function escapeLike(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (c) => '\\' + c);
}

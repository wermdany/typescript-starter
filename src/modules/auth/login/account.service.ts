import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { RoleCode } from '@/common/auth/auth.contract.js';
import { DatabaseService } from '@/database/database.service.js';
import { roles, userRoles } from '@/database/schema/rbac.schema.js';
import { users } from '@/database/schema/users.schema.js';
import { authUserColumns, type AuthUser } from './dto/user.dto.js';

/** 登录校验所需的账号记录（含密码哈希，仅在登录流程内使用） */
export interface LoginAccount {
  user: AuthUser;
  passwordHash: string;
}

/** 会话管理侧的账号摘要（判断"这个人是谁、还在不在"） */
export interface AccountSummary {
  id: number;
  studentNo: string;
  nickname: string;
  roles: readonly RoleCode[];
}

/**
 * 账号查询（**只读 users 表，不写任何东西**）。
 *
 * auth 模块内唯一的账号读取口：登录（查学号 + 密码哈希）、当前身份与续期（查 ID）、
 * 会话管理（确认目标账号存在）都从这里走，避免各用例自带一份 users 查询。
 */
@Injectable()
export class AccountService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * 按学号取可用于登录的账号。
   *
   * 显式 select `passwordHash`（它不在任何投影白名单里）；`isNull(deletedAt)`
   * 让软删除账号无法登录。
   */
  async findLoginAccount(studentNo: string): Promise<LoginAccount | undefined> {
    const [row] = await this.database.db
      .select({ ...authUserColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.studentNo, studentNo), isNull(users.deletedAt)))
      .limit(1);
    if (!row) return undefined;
    const { passwordHash, ...user } = row;
    return { user, passwordHash };
  }

  /** 按 ID 取账号（会话续期、当前用户查询用） */
  async findById(id: number): Promise<AuthUser | undefined> {
    const [row] = await this.database.db
      .select(authUserColumns)
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  /** 按取会话管理的最小摘要；不存在（或已删除）返回 `undefined` */
  async findSummary(id: number): Promise<AccountSummary | undefined> {
    const user = await this.findById(id);
    if (!user) return undefined;
    return {
      id: user.id,
      studentNo: user.studentNo,
      nickname: user.nickname,
      roles: await this.findRoleCodes(id),
    };
  }

  /**
   * 取用户的角色码集合（多角色）。
   *
   * 排序规则：`level` 降序（高权限在前）→ `code` 升序兜底，保证同一次登录
   * 返回的 `roles` 顺序稳定，前端不必自己排序。
   * 只统计未软删的绑定与角色行：角色被下线后，持有者下一次请求即失去该角色。
   */
  async findRoleCodes(userId: number): Promise<RoleCode[]> {
    const rows = await this.database.db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          isNull(userRoles.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .orderBy(desc(roles.level), asc(roles.code));
    return rows.map((row) => row.code as RoleCode);
  }
}

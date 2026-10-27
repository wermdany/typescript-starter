import { Injectable, NotFoundException } from '@nestjs/common';

import type { PageResponse } from '@/shared/common.js';
import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import { SessionService } from './session.service.js';
import type { RevokeAllResult } from './dto/revoke-all.dto.js';
import type { SessionResponse, SessionWithCurrent } from './dto/session.dto.js';

/** 列表 query 的最小形状（与 zod DTO 解耦，用例层不依赖 DTO 类型） */
export interface SessionListQuery {
  page: number;
  pageSize: number;
}

/**
 * 会话用例：**身份相关的越权判定都在这一层**，仓储只管 SQL。
 *
 * - 本人接口一律以 `user.id` 为过滤条件，忽略任何路径参数
 * - 管理员接口先确认目标账号存在（404），再按目标操作；会话 ID 与目标用户不匹配时
 *   同样 404 —— 不能让管理员借接口探测别人的会话 ID
 */
@Injectable()
export class SessionManagerService {
  constructor(private readonly sessions: SessionService) {}

  /** 我的登录设备 */
  async listMine(
    user: AuthenticatedUser,
    query: SessionListQuery,
  ): Promise<PageResponse<SessionWithCurrent>> {
    const result = await this.sessions.listForUser(
      user.id,
      query.page,
      query.pageSize,
    );
    return withCurrentFlag(result, user.sessionId);
  }

  /**
   * 退出当前设备。
   *
   * 幂等：会话已失效也返回成功 —— 客户端重试或 token 过期后再登出不该报错。
   */
  async logout(user: AuthenticatedUser): Promise<void> {
    await this.sessions.revoke(user.sessionId, 'logout');
  }

  /**
   * 退出全部设备。
   *
   * 默认**包含当前设备**（"退出所有设备"的直觉语义）；`keepCurrent` 保留本机，
   * 用于"其它设备都踢掉，我这台继续用"。
   */
  async revokeAllMine(
    user: AuthenticatedUser,
    options: { keepCurrent: boolean },
  ): Promise<RevokeAllResult> {
    const revoked = await this.sessions.revokeAllForUser(
      user.id,
      'user_revoke_all',
      { exceptSessionId: options.keepCurrent ? user.sessionId : undefined },
    );
    return { revoked, currentRevoked: !options.keepCurrent };
  }

  /** 踢掉自己的某台设备；不属于自己或不存在统一 404（不泄漏他人会话是否存在） */
  async revokeMine(user: AuthenticatedUser, sessionId: number): Promise<void> {
    const revoked = await this.sessions.revokeForUser(
      user.id,
      sessionId,
      'logout',
    );
    if (!revoked) throw new NotFoundException('登录设备不存在或已下线');
  }

  /** 管理员：查看某用户的登录设备 */
  async listForUser(
    userId: number,
    currentSessionId: number,
    query: SessionListQuery,
  ): Promise<PageResponse<SessionWithCurrent>> {
    await this.requireAccount(userId);
    const result = await this.sessions.listForUser(
      userId,
      query.page,
      query.pageSize,
    );
    return withCurrentFlag(result, currentSessionId);
  }

  /** 管理员：踢出某用户的全部登录态 */
  async revokeUserSessions(userId: number): Promise<{ revoked: number }> {
    await this.requireAccount(userId);
    const revoked = await this.sessions.revokeAllForUser(
      userId,
      'admin_revoke',
    );
    return { revoked };
  }

  /** 管理员：踢出某用户的单个会话 */
  async revokeUserSession(userId: number, sessionId: number): Promise<void> {
    await this.requireAccount(userId);
    const session = await this.sessions.findById(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('登录设备不存在或已下线');
    }
    await this.sessions.revoke(sessionId, 'admin_revoke');
  }

  /** 管理员操作的前置校验：目标账号必须存在且未删除 */
  private async requireAccount(userId: number) {
    if (!(await this.sessions.userExists(userId))) {
      throw new NotFoundException('用户不存在');
    }
  }
}

/** 给会话列表打上 `current` 标记（纯函数，便于单测） */
export function withCurrentFlag(
  page: PageResponse<SessionResponse>,
  currentSessionId: number,
): PageResponse<SessionWithCurrent> {
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      current: item.id === currentSessionId,
    })),
  };
}

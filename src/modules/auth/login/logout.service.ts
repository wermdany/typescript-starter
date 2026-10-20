import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common/auth/auth.contract.js';
import { SessionService } from '@/modules/auth/session/session.service.js';

/**
 * 退出当前设备。
 *
 * 幂等：会话已失效（重复登出、管理员刚踢过）也返回成功 —— 客户端重试不该报错。
 * 「退出所有设备」不在这里，见 `SessionUseCase.revokeAllMine`。
 */
@Injectable()
export class LogoutService {
  constructor(private readonly sessions: SessionService) {}

  async execute(user: AuthenticatedUser): Promise<void> {
    await this.sessions.revoke(user.sessionId, 'logout');
  }
}

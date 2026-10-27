import { Injectable, UnauthorizedException } from '@nestjs/common';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import type { MeResult } from './dto/user.dto.js';
import { AccountService } from './account.service.js';

/**
 * 当前身份用例。
 *
 * 身份只来自会话（中间件注入），路径与请求体都不参与"我是谁"的判断。
 * 这里再查一次用户是为了拿到 `email` / `points` 这类会话里没有的资料字段；
 * 校验通过但用户随后被删除时按 401 处理，与中间件口径一致。
 */
@Injectable()
export class MeService {
  constructor(private readonly accounts: AccountService) {}

  async execute(user: AuthenticatedUser): Promise<MeResult> {
    const account = await this.accounts.findById(user.id);
    if (!account) {
      throw new UnauthorizedException(UNAUTHENTICATED_MESSAGE);
    }
    return {
      user: {
        id: account.id,
        studentNo: account.studentNo,
        email: account.email,
        nickname: account.nickname,
        // 响应类型由 schema 推导（数组是可变的），会话里的 roles 是只读视图，
        // 这里复制一份再交出去，避免两处 readonly 语义互相将就
        roles: [...user.roles],
        points: account.points,
      },
      sessionId: user.sessionId,
    };
  }
}

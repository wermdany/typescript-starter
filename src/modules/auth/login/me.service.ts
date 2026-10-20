import { Injectable, UnauthorizedException } from '@nestjs/common';

import {
  UNAUTHENTICATED_MESSAGE,
  type AuthenticatedUser,
} from '@/common/auth/auth.contract.js';
import { AccountService } from './account.service.js';

/** 当前身份响应（前端刷新页面后据此重建本地登录态） */
export interface MeResult {
  user: {
    id: number;
    studentNo: string;
    email: string;
    nickname: string;
    role: AuthenticatedUser['role'];
    points: number;
  };
  /** 本次请求所用会话，前端可用于在设备列表里高亮"本机" */
  sessionId: number;
}

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
        role: account.role,
        points: account.points,
      },
      sessionId: user.sessionId,
    };
  }
}

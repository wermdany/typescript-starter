import { createHash, randomBytes } from 'node:crypto';

/**
 * 不透明 token 工具。token 本身**不携带任何声明**（不是 JWT）：
 * 身份、角色、过期时间一律以服务端会话为准，因此角色调整、吊销都即时生效。
 *
 * 库中只存 `sha256(token)`：数据库泄露拿不到可用的 token；令牌空间为 256 bit 随机，
 * 摘要不可逆，也不需要加盐。
 */

/** 生成新的 token：32 字节随机数 → base64url（43 字符，无填充） */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** token → 入库用的 sha256 十六进制摘要 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 账号不存在时用来"陪跑"一次 scrypt 的固定哈希。
 *
 * 登录失败的两条路径（账号不存在 / 密码错误）耗时必须接近，否则响应时间会成为
 * 账号是否存在的探测器。该串与任何真实密码都不匹配，校验结果恒为 false。
 */
export const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

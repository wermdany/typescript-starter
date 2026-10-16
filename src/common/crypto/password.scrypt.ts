import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

/** promisify(scrypt) 会丢失带 options 的重载签名，手写 Promise 包装保留完整参数 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/** scrypt 计算参数（N / r / p），仅在代码变更时调整；如未来需按环境配置，再同步进 envSchema */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** 派生密钥长度（字节） */
const KEY_LENGTH = 64;

/** 盐长度（字节） */
const SALT_LENGTH = 16;

/**
 * 对明文密码做 scrypt 哈希。
 *
 * 存储格式（自描述，参数可平滑演进）：`scrypt$N$r$p$saltHex$hashHex`
 *
 * @example
 * const passwordHash = await hashPassword('12345678');
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain, salt, KEY_LENGTH, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    'scrypt',
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/**
 * 校验明文密码是否与存储的哈希匹配。
 *
 * 从存储串中解析参数（而非使用当前常量），因此历史哈希在参数升级后仍可校验。
 * 使用 `timingSafeEqual` 恒定时间比对，防止时序侧信道攻击。
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, N, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(plain, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

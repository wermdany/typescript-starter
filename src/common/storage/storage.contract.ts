import type { Readable } from 'node:stream';

/**
 * 文件存储的**端口契约**：业务代码只认这个接口，不认磁盘、不认 SDK。
 *
 * ## 为什么要有这一层
 *
 * 文件最终存在哪儿，是**部署形态**的选择（单机磁盘 / 对象存储 / CDN），不是业务语义。
 * 把 `fs.writeFile` 散在 service 里，换 OSS 等于重写上传、下载、删除三条路径。
 * 所以这里只声明"存一个对象 / 读一个对象 / 删一个对象"三件事，
 * 由 `storage.module.ts` 的一行 `useClass` 决定用哪个实现。
 *
 * ## 接入 OSS 时要改什么（总共两处）
 *
 * 1. 新增 `oss-storage.ts`：`implements StoragePort`，`driver = 'oss'`
 *    - `put` → `PutObjectCommand`
 *    - `read` → 返回 `{ kind: 'redirect', url: <预签名 URL> }`，让客户端直连对象存储
 *      （也可以返回 `{ kind: 'stream' }` 走后端中转，取决于是否允许暴露桶）
 *    - `remove` → `DeleteObjectCommand`
 * 2. `storage.module.ts` 里把 `useClass: LocalStorage` 换成 `useClass: OssStorage`
 *
 * 业务代码（`modules/file`）一行都不用改 —— 这正是 `StorageReadResult` 用判别联合
 * 而不是"直接给 stream"的原因：**本地能流式返回，对象存储通常只能重定向**，
 * 两者在控制器侧的写法不同，把差异收在实现里比收在调用点便宜。
 *
 * ## 分层不变式
 *
 * 本文件与实现都在 `common/` 下，因此**禁止** import `@/modules/*`、`@/shared/*`、
 * `@/database/*`、`@/logger/*`（见 `common/http-stages.ts` 头注释）。
 */

/** `StoragePort` 的 DI token（`@Inject(STORAGE)`） */
export const STORAGE = Symbol('STORAGE');

/**
 * 存储驱动标识。
 *
 * 写进 `files.storage_driver` 列：换实现之后，老文件仍指向老的驱动，
 * 迁移脚本可以按它分批搬运，而不是"切换那一刻全部失效"。
 */
export type StorageDriver = 'local' | 'oss';

/** 写入一个对象的入参 */
export interface PutObjectInput {
  /** 对象键（相对路径），由服务端生成，**不含**根目录 / 桶名 */
  readonly key: string;
  /** 对象内容 */
  readonly body: Buffer;
  /** MIME 类型；本地实现不落盘它，对象存储需要它作为对象元数据 */
  readonly contentType: string;
}

/** 写入结果 */
export interface StoredObject {
  readonly key: string;
  /** 实际写入的字节数（用于校验客户端声明的大小） */
  readonly size: number;
}

/** 读取对象时已知的元数据（来自数据库，省掉一次 HEAD 请求） */
export interface ReadObjectInput {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
}

/**
 * 读取结果。
 *
 * - `stream`：由本服务把字节吐给客户端（本地磁盘、或不允许暴露桶的对象存储）
 * - `redirect`：给客户端一个临时地址，让它自己去取（对象存储预签名 URL）
 *
 * 控制器对两者分别处理，业务语义（谁有权读）已在 service 判过，与返回形态无关。
 */
export type StorageReadResult =
  | {
      readonly kind: 'stream';
      readonly stream: Readable;
      readonly size: number;
      readonly contentType: string;
    }
  | {
      readonly kind: 'redirect';
      /** 预签名地址或 CDN 地址，有效期由实现决定 */
      readonly url: string;
    };

/**
 * 存储端口。
 *
 * 刻意**没有** `list` / `stat` / `copy` / `move`：业务只需要这三个动作，
 * 多一个方法就意味着每个实现都要多兜一种语义差异（对象存储的 list 是分页且最终一致的）。
 * 需要更多能力时先问"是不是业务真的需要"，再扩接口 —— 接口越小，换实现的成本越低。
 */
export interface StoragePort {
  /** 当前实现，写进 `files.storage_driver` */
  readonly driver: StorageDriver;

  /**
   * 写入对象。同 key 重复写入视为覆盖（key 由 uuid 生成，正常不会重复）。
   *
   * 实现必须保证**读端不会看到写了一半的对象**：本地用「临时文件 + rename」，
   * 对象存储天然原子。
   */
  put(input: PutObjectInput): Promise<StoredObject>;

  /** 读取对象；对象不存在时抛 {@link StorageObjectMissingError} */
  read(input: ReadObjectInput): Promise<StorageReadResult>;

  /** 删除对象；对象本来就不存在时**不报错**（删除的语义是"让它不存在"） */
  remove(key: string): Promise<void>;
}

/**
 * 对象在存储里丢失（数据库有记录、存储没有内容）。
 *
 * 属于**数据不一致**而非调用方错误：service 据此回 404「文件内容已丢失」，
 * 而不是把 `ENOENT` 冒泡成 500 让人误以为代码有 bug。
 */
export class StorageObjectMissingError extends Error {
  constructor(readonly key: string) {
    super(`存储对象不存在：${key}`);
    this.name = 'StorageObjectMissingError';
  }
}

/**
 * 合法的对象键。
 *
 * 只允许 `年/月/uuid.ext` 这种形态（见 `modules/file/upload-policy.ts` 的 `buildStorageKey`）。
 * 收紧到"没有 `.` `..` 段、没有反斜杠、没有绝对路径起点"，是从源头掐掉目录穿越 ——
 * 实现里的 `resolve` 校验是第二道防线，不是唯一防线。
 */
const STORAGE_KEY_PATTERN = /^[0-9A-Za-z][0-9A-Za-z/_.-]*$/;

/**
 * 断言对象键合法。
 *
 * 抛的是普通 `Error` 而不是 `HttpException`：key 由服务端生成，
 * 走到这里说明代码有 bug（而不是调用方传了坏参数），应当按 500 暴露并进日志。
 */
export function assertStorageKey(key: string): void {
  const normalized = key.trim();
  if (
    normalized !== key ||
    key.length === 0 ||
    key.length > 255 ||
    !STORAGE_KEY_PATTERN.test(key) ||
    key.includes('..') ||
    key.includes('//') ||
    key.endsWith('/')
  ) {
    throw new Error(`非法的存储 key：${JSON.stringify(key)}`);
  }
}

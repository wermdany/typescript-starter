import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { UploadedFileLike } from './dto/upload-file.dto.js';

/**
 * 上传策略：**允许什么、多大、落到哪个 key**。
 *
 * 放在 file 模块内部而不是配置层，理由与 `user/update-policy.ts` 相同：
 * 这是业务规则（表驱动常量 + 纯函数），不随部署环境变化，也不需要运维改。
 * 唯一随环境变化的是落盘目录（`FILE_STORAGE_DIR`，见 `config/env.ts`）。
 *
 * ## 三条不信任客户端
 *
 * 1. **MIME 由白名单裁决**，不信任 `file.mimetype` 本身 —— 它只是客户端填的表单字段
 * 2. **扩展名由服务端决定**（`rule.extension`），不用原始文件名的后缀：
 *    否则 `shell.php.png` 这类名字会把后缀带进存储路径
 * 3. **内容签名（魔数）校验**：MIME 说 image/png 但内容是 `<?php` 时拒收，
 *    防止"类型声明"与"真实内容"脱钩
 */

/** 单文件大小上限（字节）。同时用于 multer 的 limits 与 service 内的二次校验 */
export const UPLOAD_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** multipart 字段名（客户端上传时表单里的 key） */
export const UPLOAD_FIELD_NAME = 'file';

/** 原始文件名落库上限，与 `files.original_name` 的 `varchar(255)` 对齐 */
export const UPLOAD_MAX_ORIGINAL_NAME_LENGTH = 255;

/** 内容签名：`offset` 处连续 `bytes` 字节 */
interface Signature {
  readonly offset: number;
  readonly bytes: readonly number[];
}

/** 一条允许上传的类型 */
export interface UploadRule {
  /** 服务端认可的 MIME 类型 */
  readonly mimeType: string;
  /** 落盘后缀（**由这里决定**，不取客户端文件名） */
  readonly extension: string;
  /**
   * 签名组：**组内全部命中 = 该组匹配，组间任一匹配即通过**。
   * 未声明表示该类型没有稳定魔数（纯文本），跳过内容校验。
   */
  readonly signatureGroups?: readonly (readonly Signature[])[];
}

/**
 * 常见容器格式的签名（同一签名同时覆盖 zip 与 docx/xlsx/pptx）。
 *
 * 两个签名是**互斥的两种开头**（普通档案 `PK\x03\x04` / 空档案 `PK\x05\x06`），
 * 因此必须是**两个组**（组间 OR），不能放进同一组（组内 AND 要求两者同时命中，
 * 而 offset 0 处不可能同时是 03 和 05 —— 那会让所有 zip 家族的上传都 415）。
 */
const ZIP_SIGNATURE_GROUPS: readonly (readonly Signature[])[] = [
  [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
];

/**
 * 允许上传的类型清单。
 *
 * 刻意**不收**以下类型（都是"上传即等于给自己开 XSS / 开脚本"）：
 * - `image/svg+xml`：SVG 里可以带 `<script>`，浏览器以同源文档渲染时可执行
 * - `text/html` / `application/xhtml+xml`：同上，且没有合理业务场景
 * - 可执行文件与脚本：`application/x-*`、`text/x-*`
 */
export const UPLOAD_RULES: readonly UploadRule[] = [
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    signatureGroups: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  },
  {
    mimeType: 'image/png',
    extension: 'png',
    signatureGroups: [
      [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    ],
  },
  {
    mimeType: 'image/gif',
    extension: 'gif',
    signatureGroups: [[{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }]],
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    // RIFF 容器 + 第 8 字节起的 'WEBP'，两个条件都要满足才不会把任意 RIFF 当图片
    signatureGroups: [
      [
        { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
        { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
      ],
    ],
  },
  {
    mimeType: 'application/pdf',
    extension: 'pdf',
    signatureGroups: [[{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }]],
  },
  { mimeType: 'text/plain', extension: 'txt' },
  { mimeType: 'text/csv', extension: 'csv' },
  {
    mimeType: 'application/zip',
    extension: 'zip',
    signatureGroups: ZIP_SIGNATURE_GROUPS,
  },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    signatureGroups: ZIP_SIGNATURE_GROUPS,
  },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
    signatureGroups: ZIP_SIGNATURE_GROUPS,
  },
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
    signatureGroups: ZIP_SIGNATURE_GROUPS,
  },
];

const RULE_BY_MIME = new Map(
  UPLOAD_RULES.map((rule) => [rule.mimeType, rule] as const),
);

/** 允许的扩展名（用于把 415 的文案说清楚）：列举扩展名比一长串 MIME 好读 */
export const ALLOWED_EXTENSIONS: readonly string[] = UPLOAD_RULES.map(
  (rule) => rule.extension,
);

/** 大小上限的展示文案（MB，保留一位小数） */
export const UPLOAD_MAX_FILE_SIZE_LABEL = `${Math.round(
  (UPLOAD_MAX_FILE_SIZE_BYTES / (1024 * 1024)) * 10,
) / 10} MB`;

/**
 * 校验上传并返回命中的规则。
 *
 * 同时服务于 HTTP 入口（controller 传进来的 multer 文件对象）与内部调用
 * （service 的 `upload()`）—— 所以校验写在 service 侧而不是只靠 multer 的 limits：
 * multer 只拦得住"走 HTTP 的那条路"。
 *
 * @throws BadRequestException 空文件
 * @throws PayloadTooLargeException 超过上限（413）
 * @throws UnsupportedMediaTypeException 类型不在白名单 / 内容与声明不符（415）
 */
export function assertUploadable(file: UploadedFileLike): UploadRule {
  if (file.size <= 0 || file.buffer.byteLength === 0) {
    throw new BadRequestException('不能上传空文件');
  }
  if (file.size > UPLOAD_MAX_FILE_SIZE_BYTES) {
    throw new PayloadTooLargeException(
      `文件超过 ${UPLOAD_MAX_FILE_SIZE_LABEL} 上限`,
    );
  }

  const rule = RULE_BY_MIME.get(file.mimetype.toLowerCase());
  if (!rule) {
    throw new UnsupportedMediaTypeException(
      `不支持的文件类型：${file.mimetype || '未知'}（允许：${ALLOWED_EXTENSIONS.join('、')}）`,
    );
  }

  if (!matchesSignature(file.buffer, rule)) {
    throw new UnsupportedMediaTypeException(
      `文件内容与声明的类型 ${rule.mimeType} 不符`,
    );
  }

  return rule;
}

/**
 * 生成存储 key：`<年>/<月>/<uuid>.<扩展名>`。
 *
 * - 用 UTC 年月：同一份文件在哪个时区的实例上传，落点都一样
 * - 按年月分目录：单目录文件数不至于无界增长（本地实现的 `readdir` 与备份都会变慢）
 * - 用 uuid 而不是原始文件名：去重、避免同名覆盖、不给文件名任何进入路径的机会
 */
export function buildStorageKey(rule: UploadRule, at = new Date()): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${randomUUID()}.${rule.extension}`;
}

/**
 * 规范化原始文件名：只用于展示与 `Content-Disposition`，不参与任何路径拼接。
 *
 * 两件事：
 * 1. **修正编码**：multer（busboy）按 latin1 解码 multipart 的文件名，
 *    中文名会变成 `ä¸­æ–‡.png` 这种乱码。用 latin1 → utf8 还原一次；
 *    还原出替换字符说明原文本就不是 UTF-8（真 latin1），保持原样
 * 2. **去掉路径与控制字符**：某些客户端会带上 `C:\path\a.png`，反斜杠与斜杠替换成下划线
 */
export function normalizeOriginalName(raw: string): string {
  const decoded = decodeLatin1AsUtf8(raw);
  const cleaned = Array.from(decoded, (char) => {
    const code = char.codePointAt(0) ?? 0;
    // 路径分隔符与控制字符（0x00-0x1f、0x7f）一律替换：
    // 文件名不参与任何路径拼接，但这类字符进响应头或日志没有任何好处
    return char === '\\' || char === '/' || code < 0x20 || code === 0x7f
      ? '_'
      : char;
  })
    .join('')
    .trim();
  // 按码点截断：`String#slice` 会切断 emoji 这类代理对，留下半个字符
  const chars = Array.from(cleaned.length > 0 ? cleaned : '未命名文件');
  return chars.slice(0, UPLOAD_MAX_ORIGINAL_NAME_LENGTH).join('');
}

/** 内容是否命中所声明的类型（无签名定义的类型直接通过） */
function matchesSignature(buffer: Buffer, rule: UploadRule): boolean {
  const groups = rule.signatureGroups;
  if (!groups) {
    return true;
  }
  return groups.some((group) =>
    group.every(({ offset, bytes }) => {
      if (buffer.byteLength < offset + bytes.length) {
        return false;
      }
      return bytes.every((byte, index) => buffer[offset + index] === byte);
    }),
  );
}

/** latin1 → utf8 还原；结果含替换字符时认为原文不是被误解码的 UTF-8 */
function decodeLatin1AsUtf8(raw: string): string {
  if (!/[\u0080-\u00ff]/.test(raw)) {
    return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? raw : decoded;
}

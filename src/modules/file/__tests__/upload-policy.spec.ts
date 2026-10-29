import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { UploadedFileLike } from '@/modules/file/dto/upload-file.dto.js';
import {
  ALLOWED_EXTENSIONS,
  UPLOAD_MAX_FILE_SIZE_BYTES,
  UPLOAD_MAX_ORIGINAL_NAME_LENGTH,
  assertUploadable,
  buildStorageKey,
  normalizeOriginalName,
} from '@/modules/file/upload-policy.js';

/** 造一个"客户端送来的文件对象"：size 默认按 buffer 实际长度 */
function uploaded(
  mimetype: string,
  buffer: Buffer,
  originalname = 'x',
): UploadedFileLike {
  return {
    fieldname: 'file',
    originalname,
    mimetype,
    size: buffer.byteLength,
    buffer,
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest-of-png'),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('rest-of-jpeg'),
]);
const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('rest-of-zip'),
]);

describe('assertUploadable（白名单 + 大小 + 内容签名）', () => {
  it('空文件 → 400，不进入类型判定', () => {
    expect(() => assertUploadable(uploaded('image/png', Buffer.alloc(0)))).toThrow(
      BadRequestException,
    );
  });

  it('size 声明为 0 但 buffer 有内容 → 仍按空文件拒绝（size 才是 multer 的权威）', () => {
    const file = { ...uploaded('image/png', PNG), size: 0 };
    expect(() => assertUploadable(file)).toThrow(BadRequestException);
  });

  it('超过 10 MB → 413', () => {
    const file = {
      ...uploaded('image/png', PNG),
      size: UPLOAD_MAX_FILE_SIZE_BYTES + 1,
    };
    expect(() => assertUploadable(file)).toThrow(PayloadTooLargeException);
  });

  it('SVG 不在白名单 → 415（它能带 <script>，是"上传即开 XSS"）', () => {
    expect(() =>
      assertUploadable(uploaded('image/svg+xml', Buffer.from('<svg/>'))),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('扩展名白名单里不含 svg / html（守住"不收可执行文档"这条决定）', () => {
    expect(ALLOWED_EXTENSIONS).not.toContain('svg');
    expect(ALLOWED_EXTENSIONS).not.toContain('html');
  });

  it('声明 image/png 但内容是 JPEG → 415（类型声明与真实内容脱钩）', () => {
    expect(() => assertUploadable(uploaded('image/png', JPEG))).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => assertUploadable(uploaded('image/png', JPEG))).toThrow(
      /内容与声明的类型/,
    );
  });

  it('MIME 大小写不敏感：IMAGE/PNG 等价于 image/png', () => {
    expect(assertUploadable(uploaded('IMAGE/PNG', PNG)).extension).toBe('png');
  });

  it('webp 的签名是两组条件：只有 RIFF 头不足以通过', () => {
    const riffOnly = Buffer.from('RIFF____XXXX', 'latin1');
    expect(() => assertUploadable(uploaded('image/webp', riffOnly))).toThrow(
      UnsupportedMediaTypeException,
    );

    const webp = Buffer.from('RIFF____WEBP', 'latin1');
    expect(assertUploadable(uploaded('image/webp', webp)).extension).toBe('webp');
  });

  it('zip 与 docx/xlsx/pptx 共用签名：同内容按各自 MIME 落到不同扩展名', () => {
    expect(assertUploadable(uploaded('application/zip', ZIP)).extension).toBe(
      'zip',
    );
    expect(
      assertUploadable(
        uploaded(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ZIP,
        ),
      ).extension,
    ).toBe('docx');
  });

  it('zip 家族的两种开头都通过：PK\\x03\\x04（普通档案）与 PK\\x05\\x06（空档案）是"或"关系', () => {
    // 写成同一组会让组内 AND 要求 offset 0 同时是 03 和 05 —— 所有 zip 都会 415
    const emptyArchive = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    expect(assertUploadable(uploaded('application/zip', emptyArchive)).extension).toBe(
      'zip',
    );
  });

  it('无签名的类型（text/plain）跳过内容校验，任意内容都放行', () => {
    expect(
      assertUploadable(uploaded('text/plain', Buffer.from('<?php echo 1;'))).extension,
    ).toBe('txt');
  });
});

describe('buildStorageKey（服务端决定路径）', () => {
  const rule = { mimeType: 'image/png', extension: 'png' } as const;

  it('形如 <UTC 年>/<月>/<uuid>.<扩展名>，月份补零', () => {
    const key = buildStorageKey(rule, new Date('2026-03-05T12:00:00Z'));
    expect(key).toMatch(/^2026\/03\/[0-9a-f-]{36}\.png$/);
  });

  it('用 UTC 年月：同一份文件在任何时区实例上传都落在同一目录', () => {
    const at = new Date('2026-01-01T00:30:00+08:00'); // UTC 仍是 2025-12
    expect(buildStorageKey(rule, at).startsWith('2025/12/')).toBe(true);
  });

  it('两次生成不同 key（用 uuid，不取原始文件名）', () => {
    const at = new Date('2026-03-05T12:00:00Z');
    expect(buildStorageKey(rule, at)).not.toBe(buildStorageKey(rule, at));
  });
});

describe('normalizeOriginalName（只用于展示，不参与路径拼接）', () => {
  it('剥离路径分隔符：C:\\path\\a.png 不携带任何目录信息', () => {
    expect(normalizeOriginalName('C:\\path\\a.png')).toBe('C:_path_a.png');
    expect(normalizeOriginalName('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('控制字符替换为下划线', () => {
    expect(normalizeOriginalName('a\u0000b\u001fc\u007fd.png')).toBe(
      'a_b_c_d.png',
    );
  });

  it('还原 multer 的 latin1 误解码（UTF-8 字节被当作 latin1 读出来）', () => {
    // 直接构造真实形态：'中文.png' 的 UTF-8 字节按 latin1 解码得到的那串字符
    const mojibake = Buffer.from('中文.png', 'utf8').toString('latin1');
    expect(normalizeOriginalName(mojibake)).toBe('中文.png');
  });

  it('不是误解码的原文保持不动（还原出替换字符就放弃）', () => {
    expect(normalizeOriginalName('café.png')).toBe('café.png');
  });

  it('空名兜底为「未命名文件」', () => {
    expect(normalizeOriginalName('   ')).toBe('未命名文件');
  });

  it('按码点截断到 255，不切断代理对', () => {
    const long = normalizeOriginalName('文'.repeat(300));
    expect(Array.from(long)).toHaveLength(UPLOAD_MAX_ORIGINAL_NAME_LENGTH);
  });
});

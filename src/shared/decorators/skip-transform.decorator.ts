import { SetMetadata } from '@nestjs/common';

/** TransformInterceptor 命中该 metadata 时跳过响应包装 */
export const SKIP_TRANSFORM_KEY = 'skipTransform';

/**
 * 跳过统一响应契约包装，直接返回 handler 原始结果。
 * 适用于健康检查、文件下载等响应体不是契约 JSON 的特殊端点。
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

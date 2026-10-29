import { z } from 'zod';

/**
 * 角色码的**格式规则**（请求侧唯一出处）。
 *
 * 角色是**可运营数据**：`roles.code` 是 `varchar(32)`，管理端可以运行时新增角色，
 * 因此请求侧只校验"形状"，不校验"是否等于内置的三个" —— 某个码是否已配置由
 * service 查库回答（`UserService.grantRoles` 对未配置的角色抛 409）。
 * 这与"用 `z.enum(ROLE_CODES)` 把角色钉死在编译期"是两种语义，后者会让
 * 管理端新建的角色永远分配不出去。
 *
 * 限定字符集的理由：角色码会出现在日志、前端常量与 URL 片段里，
 * 允许大小写混用等于制造"看起来一样却不相等"的两个值；空格与冒号留给权限码。
 */
export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/** 单条角色码（数组元素、路径参数、query 筛选共用；不含首尾空白处理） */
export const roleCodeSchema = z
  .string()
  .regex(ROLE_CODE_PATTERN, {
    error:
      '角色码必须以小写字母开头，只含小写字母、数字、下划线或连字符，长度 2~32',
  })
  .describe(
    '角色码：小写字母开头，可含小写字母、数字、下划线、连字符，长度 2~32',
  );

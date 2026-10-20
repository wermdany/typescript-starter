/** 分页响应契约 */
export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 分页助手：收口「offset 计算 + 并行查询 + totalPages 换算」。
 *
 * 回调式设计：ORM 查询仍由 Service 显式构建，助手只负责分页数学与并发编排。
 *
 * @param build 接收 limit/offset，返回「当前页数据」与「总数」两个查询
 * @param page 页码（从 1 开始）
 * @param pageSize 每页条数
 *
 * @example
 * const result = await paginate(
 *   (limit, offset) => ({
 *     rows: db.select(userPublicColumns).from(users).where(where).limit(limit).offset(offset),
 *     total: db
 *       .select({ value: count() })
 *       .from(users)
 *       .where(where)
 *       .then((r) => r[0]?.value ?? 0),
 *   }),
 *   query.page,
 *   query.pageSize,
 * );
 */
export async function paginate<T>(
  build: (
    limit: number,
    offset: number,
  ) => {
    rows: Promise<T[]>;
    total: Promise<number>;
  },
  page: number,
  pageSize: number,
): Promise<PageResponse<T>> {
  const offset = (page - 1) * pageSize;
  const { rows, total } = build(pageSize, offset);
  const [items, count] = await Promise.all([rows, total]);
  return {
    items,
    total: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}

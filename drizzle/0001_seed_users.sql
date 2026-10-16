/*
 * 自定义迁移（custom migration）：向 users 表灌入 100,000 条拟真数据
 *
 * 由 `pnpm db:generate --custom --name=seed_users` 生成，`pnpm db:migrate` 执行，
 * 记录于 drizzle.__drizzle_migrations，遵循 drizzle 正规迁移流程。
 *
 * 数据形态：
 *   - student_no  入学年(4) + 院系代码(2) + 届内序号(4)，共 100 个「届」（13 院系 × 8 年），每届 1000 人
 *   - nickname    中文姓名（姓 40 × 名首字 40 / 名次字 26），约 55% 双字名
 *   - email       姓名拼音 + 学号，学生 @stu.example.edu.cn / 管理员 @example.edu.cn
 *   - created_at  入学年 8/20 起 45 天内抖动，落在真实入学季
 *   - updated_at  created_at 与 now() 之间，幂律偏斜（多数记录改动很少）
 *   - points      幂律分布（多数低分、少数高分），0 ~ 15000
 *   - role        约 3% admin
 *   - deleted_at  约 3.5% 软删除，删除时间晚于注册时间
 *
 * 幂等性：student_no 冲突时 DO NOTHING，重复执行不会产生重复数据。
 * 随机种子固定，从零重建库时数据分布可复现。
 */

SELECT setseed(0.20261015);
--> statement-breakpoint
INSERT INTO "users" (
  "student_no",
  "email",
  "nickname",
  "password_hash",
  "role",
  "points",
  "created_at",
  "updated_at",
  "deleted_at"
)
WITH pools AS (
  SELECT
    -- 姓氏（中文 / 拼音一一对应，共 40 个）
    ARRAY['王','李','张','刘','陈','杨','黄','赵','吴','周','徐','孙','马','朱','胡','郭','何','高','林','罗','郑','梁','谢','宋','唐','许','韩','冯','邓','曹','彭','曾','萧','田','董','袁','潘','于','蒋','蔡']::text[] AS sur_cn,
    ARRAY['wang','li','zhang','liu','chen','yang','huang','zhao','wu','zhou','xu','sun','ma','zhu','hu','guo','he','gao','lin','luo','zheng','liang','xie','song','tang','xu','han','feng','deng','cao','peng','zeng','xiao','tian','dong','yuan','pan','yu','jiang','cai']::text[] AS sur_py,
    -- 名首字（40 个）
    ARRAY['伟','芳','娜','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','霞','平','刚','文','辉','立','俊','斌','宁','鑫','浩','宇','晨','雪','悦','睿','婷','琳','昊','博','然','涵','阳']::text[] AS g1_cn,
    ARRAY['wei','fang','na','min','jing','li','qiang','lei','jun','yang','yong','yan','jie','juan','tao','ming','chao','xia','ping','gang','wen','hui','li','jun','bin','ning','xin','hao','yu','chen','xue','yue','rui','ting','lin','hao','bo','ran','han','yang']::text[] AS g1_py,
    -- 名次字（双字名用，26 个）
    ARRAY['轩','涵','然','宇','泽','博','睿','辰','毅','凯','铭','航','翔','悦','彤','妍','欣','瑶','琳','琪','楠','阳','成','峰','涛','磊']::text[] AS g2_cn,
    ARRAY['xuan','han','ran','yu','ze','bo','rui','chen','yi','kai','ming','hang','xiang','yue','tong','yan','xin','yao','lin','qi','nan','yang','cheng','feng','tao','lei']::text[] AS g2_py
),
-- 第一层：只抽随机数（每列一次调用，保证同一行内的关联选择一致）
raw AS (
  SELECT
    gs,
    ((gs - 1) / 1000)::int AS cohort,           -- 0..99   届
    ((gs - 1) % 1000 + 1)::int AS serial,       -- 1..1000 届内序号
    random() AS r_sur,
    random() AS r_g1,
    random() AS r_g2,
    random() AS r_has2,
    random() AS r_role,
    random() AS r_points,
    random() AS r_del,
    random() AS r_ts1,
    random() AS r_ts2,
    random() AS r_upd,
    random() AS r_delat
  FROM generate_series(1, 100000) AS gs
),
-- 第二层：随机数 → 维度（入学年 / 院系 / 姓名下标 / 角色 / 积分 / 删除标记）
dims AS (
  SELECT
    r.gs,
    r.serial,
    2019 + (r.cohort % 8)::int AS enroll_year,  -- 2019..2026
    (r.cohort / 8 + 1)::int AS dept_code,       -- 01..13
    LEAST(40, 1 + floor(r.r_sur * 40))::int AS i_sur,
    LEAST(40, 1 + floor(r.r_g1 * 40))::int AS i_g1,
    LEAST(26, 1 + floor(r.r_g2 * 26))::int AS i_g2,
    r.r_has2 < 0.55 AS has_two,
    (CASE WHEN r.r_role < 0.03 THEN 'admin' ELSE 'student' END)::"user_role" AS role,
    (power(r.r_points, 2.5) * 15000)::int AS points,
    r.r_del < 0.035 AS is_deleted,
    r.r_ts1,
    r.r_ts2,
    r.r_upd,
    r.r_delat
  FROM raw r
),
-- 第三层：注册时间落在入学年 8/20 起的 45 天内
stamped AS (
  SELECT
    d.*,
    make_timestamptz(d.enroll_year, 8, 20, 0, 0, 0)
      + interval '45 days' * d.r_ts1
      + interval '8 hours' * d.r_ts2 AS created_at
  FROM dims d
),
-- 第四层：派生列（学号 / 更新时间 / 删除时间）
shaped AS (
  SELECT
    s.*,
    lpad(s.enroll_year::text, 4, '0')
      || lpad(s.dept_code::text, 2, '0')
      || lpad(s.serial::text, 4, '0') AS student_no,
    s.created_at + (now() - s.created_at) * power(s.r_upd, 4) AS updated_at,
    CASE
      WHEN s.is_deleted THEN s.created_at + (now() - s.created_at) * s.r_delat
      ELSE NULL
    END AS deleted_at
  FROM stamped s
)
SELECT
  s.student_no,
  p.sur_py[s.i_sur] || p.g1_py[s.i_g1]
    || CASE WHEN s.has_two THEN p.g2_py[s.i_g2] ELSE '' END
    || s.student_no
    || CASE WHEN s.role = 'admin' THEN '@example.edu.cn' ELSE '@stu.example.edu.cn' END AS email,
  p.sur_cn[s.i_sur] || p.g1_cn[s.i_g1]
    || CASE WHEN s.has_two THEN p.g2_cn[s.i_g2] ELSE '' END AS nickname,
  CASE
    -- 前 3 条为可真实登录的演示账号（学号 2019010001 ~ 2019010003，密码 12345678）
    WHEN s.gs <= 3 THEN 'scrypt$16384$8$1$ec1aaa872e3a039b4b27e9e67b348908$271bb6977f5ca2a0f66f05a51bc8b338ebff1c62549f857e50fc082ac037e1e59fc2dde3f30bd66d216be1aba9225a714febf44d3481323942ca3bec0e42cf35'
    -- 其余为 scrypt 存储格式（scrypt$N$r$p$saltHex$hashHex）的合成哈希：盐 16 字节、派生键 64 字节
    ELSE 'scrypt$16384$8$1$' || md5(random()::text)
      || '$' || md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text)
  END AS password_hash,
  s.role,
  s.points,
  s.created_at,
  GREATEST(s.updated_at, s.deleted_at) AS updated_at,
  s.deleted_at
FROM shaped s
CROSS JOIN pools p
ON CONFLICT ("student_no") DO NOTHING;

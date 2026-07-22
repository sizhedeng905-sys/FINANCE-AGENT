# R6.2 项目模板生命周期并发验收报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

起始 HEAD：`fb69befb626754d025e83e8e1c66d86e2c7e0f9e`

状态：`passed`

## 失败复现

修改前，测试事务持有 `pg_advisory_xact_lock(hashtextextended(projectId, 22))` 时，`PATCH /api/project-templates/:id/disable` 仍在 200 ms 内完成。红测得到 `expected waiting / received settled`，证明项目模板停用没有参与记录、Excel、OCR 和工单正式写入已经使用的项目级串行化协议。

进一步调用链审计发现，Excel 确认调度会检查活动模板，但后台确认批次真正创建 `BusinessRecord` 时没有重新获取项目锁。模板可能在调度成功后、批次写入前被停用。

## 实现

- 新增唯一的 `acquireProjectWriteLock()`，统一使用 PostgreSQL 事务级 advisory lock namespace `22`；不使用进程内 mutex，因此 API 与 Worker 跨进程共享同一边界。
- 项目更新/归档、模板启用/修改/停用、手工记录、Excel 创建/确认/字段切换、OCR 创建/确认、工单提交/终审记录和项目文件绑定全部复用该函数。
- 模板修改和停用先只读取不可变 `projectId`，获取项目锁后重新读取完整关系和项目状态；锁前快照不参与写入判断。
- Excel 后台确认每个写入批次在任务锁之后获取项目锁，并在锁内重新校验项目模板仍活动且冻结版本一致；调度后停用模板会使任务明确进入 `confirmation_failed`，不会继续写业务记录。
- 获取项目锁期间临时设置 PostgreSQL `lock_timeout=2s`，成功后恢复事务原设置，避免影响同事务后续用户、容量或实体锁。
- PostgreSQL `55P03`、`40P01`、`40001` 和 Prisma `P2034` 统一转换为 HTTP 409，返回 `data.reason=PROJECT_WRITE_LOCK_RETRY` 与 `retryable=true`。超时请求不修改模板，也不写成功审计。
- 架构测试扫描六类正式写服务，要求使用公共 helper，并禁止重新散落字面量 key `22` SQL。

## 并发矩阵

| 顺序 | 实际结果 | 不变量 |
| --- | --- | --- |
| 模板启用先排队，手工记录后排队 | 启用 201，记录 201 | 记录只在活动模板下创建 |
| Excel 确认调度先排队，模板停用后排队 | 调度 201，停用 200，Worker `confirmation_failed` | 停用后正式记录 0 |
| 模板停用先排队，OCR 确认后排队 | 停用 200，OCR 400 | OCR 保持 `pending_confirm`，正式记录 0 |
| 老板终审先排队，模板停用后排队 | 终审 201，停用 200 | 先提交的历史记录保留且只生成 1 条 |
| 外部事务持续持有项目锁 | 约 2 秒后 409 | 模板状态不变，成功审计 0，可安全重试 |

所有矩阵用例都运行在真实 PostgreSQL，先由第三个事务持有同一项目锁，再按顺序放入两个真实 HTTP 请求；不是 Promise 时序模拟或进程内锁测试。

## 数据库与迁移

本阶段不修改 Prisma schema，不新增 migration。锁是 PostgreSQL 事务级运行时协议；现有 25 条 migration 的空库安装和 24→25 升级继续通过，结构仍为 41 张业务表、27 个 enum、173 个 index 和 77 个 foreign key。

## 测试证据

| 命令/场景 | 结果 |
| --- | --- |
| 修改前模板停用锁红测 | `failed`，持锁时请求提前完成 |
| 公共锁、超时恢复、错误归一化和架构守卫 | 6/6 `passed` |
| 独立 PostgreSQL 项目模板竞争矩阵 | 4/4 `passed` |
| 生命周期等待、超时、状态/审计不变 | 3/3 `passed` |
| `npm test -- --runInBand`（backend） | 32/32 suites，292/292 tests，18.264 s |
| `npm run test:integration -- --runInBand` | 3/3 suites，68/68 tests，264.943 s |
| `npm run test:e2e` | 17/17，50.7 s；清理后文件残留 0 |
| 前后端 build | 均 `passed`；前端 3,144 modules |
| `npm run db:migration-paths`（backend） | 25 条空库、24→25 升级通过 |
| repository hygiene | 588 个 tracked/candidate 文件通过 |
| 根目录与后端 `npm audit --omit=dev` | 均为 0 vulnerabilities |

全量单测第一次运行暴露 3 个旧 Prisma 测试替身缺少真实 `TransactionClient` 必有的 `$queryRaw`。补齐测试替身后，失败套件定向 24/24 及全量 292/292 通过；没有在生产 helper 中增加 mock 旁路，也没有降低断言。

## 未完成项

R6.2 只关闭项目模板生命周期与正式业务写入的 TOCTOU。R6.3 重复候选时间窗、R6.4 Decimal 阈值、R6.5 幂等入口清单和 R6.6 H01/H02/H07 行为矩阵仍未完成；R9 多实例登录/上传/模型闸门仍为条件 P1。H01/H07 继续决定正式业务口径，但不再阻塞本工程锁协议的自动化结论。

# P0 Excel 暂存隔离与发布完整性收口报告

> 日期：2026-07-21
> 范围：CR-002 至 CR-005
> 状态：`engineering_verified_locally`
> 非范围：生产授权、目标主机容量、正式职责分离和真实财务 UAT

## 1. 为什么重新打开 P0

M5.2 和 R9.3B 已证明按明细行校验、第二财务批准、Worker 分批写入和大表恢复，但后续攻击性复核发现它们没有证明以下不变量：

1. 财务批准前的暂存 `BusinessRecord` 对所有通用读取和写入 API 都不可见。
2. 暂存记录、动态字段值或封存来源证据变化后，旧批准不能继续发布。
3. 最终事务实际少更新一条记录、来源行或 ledger 时，任务不能结束为 `confirmed`。
4. checkpoint 压力造成单批事务超过 Prisma 默认 5 秒时，合法任务不应被误判失败并消耗恢复次数。

CR-002 先加入失败测试，真实复现了提前读取/修改和内容篡改旁路；因此旧“P0 已完全关闭”声明被撤回。

## 2. 最小修复链

### CR-003：发布隔离

- 为 `BusinessRecord` 增加 `unpublished|published` 状态。
- Excel Worker 创建的记录始终为 `unpublished`；最终事务才原子切换为 `published`。
- 通用 records、项目结构、统计、报表和 AI 数据源默认只读取 `published`。
- 通用 PATCH、confirm、void/delete 拒绝未发布记录，客户端不能提交 publication status。
- migration 将既有记录安全回填为 `published`，并用约束限制状态组合。

### CR-004：内容完整性围栏

- 为每条暂存记录保存 canonical 内容 SHA-256 和批准哈希。
- `ImportRow` 镜像生成记录哈希与动态值数量；批次 manifest 按 ID 分页重算。
- PostgreSQL 触发器在暂存记录、动态值或封存来源证据变化时使完整性封存失效。
- 最终事务逐项重验记录/值/来源/ledger 数量与哈希，并精确断言三组 UPDATE affected rows。
- 任一不一致完整回滚；重试先清理全部未发布记录、值、镜像和 staged ledger，再确定性重建。

### CR-005：慢批次和声明收口

- `processConfirmationBatch` 显式使用 `maxWait=10s`、`timeout=30s`，覆盖受控 checkpoint/WAL 抖动，同时保持最终 180 秒产品容量断言不变。
- 6 秒数据库触发器故障注入证明一个合法批次在一次 confirmation attempt 内完成；修复前会触发 Prisma 默认超时并进入第二次 attempt。
- 大表 Jest 外层仅从 240 秒调整为 360 秒，以容纳夹具创建、确认和闭环断言；确认 `<180s`、校验 `<180s`、API `<2s`、RSS `<1GiB` 的产品断言没有放宽。
- README、进度、阻塞矩阵、PR 清单和历史报告明确区分旧阶段证据与当前 P0 结论。

## 3. 攻击与边界证据

自动化覆盖：

- 列表、详情、项目结构、统计和报告无法看到未发布记录；
- 通用 PATCH、confirm、void/delete 无法修改未发布记录；
- 直接篡改暂存记录状态/金额/版本或 `RecordValue` 后失败关闭；
- 完整性预检后篡改封存 `ImportRow`，最终事务失败且正式记录为 0；
- 测试触发器吞掉一条发布 UPDATE 时，记录、来源行、ledger 和任务状态全部回滚；
- 失败重试清理受污染 staging，只生成一份正式记录、audit 和 ledger；
- P1001/P2028/P2034、旧 lease、最终化超时、取消/确认竞争和数据库短断保持有界恢复；
- 5,001、30,196、49,999 行确认和 50,000 行预览边界通过，50,001 行拒绝。

## 4. 当前测试证据

| 门禁 | 结果 |
| --- | --- |
| 后端 unit | 47/47 suites，428/428 tests，23.675 s |
| PostgreSQL/Redis integration | 强制 Redis，13/13 suites，119/119 tests，408.027 s |
| Playwright | 17/17，真实 API 与显式 Mock 均通过，清理后零测试文件 |
| 前端 build | passed，Vite 3,147 modules |
| 后端 build | passed，Prisma generate 与 TypeScript 均退出 0 |
| Migration | 空库 43 条与 42→43 升级通过；224 indexes、89 foreign keys |
| CR-004 remote CI | commit `22da7ca` 的 Build/CodeQL 通过；CR-005 live checks 以 Draft PR #4 为准 |

强制 Redis 全量容量样本：

| 行数 | 重新校验 | 确认 API | Worker 确认 | 峰值 RSS 增量 | 峰值连接 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30,196 | 3.463 s | 33 ms | 60.627 s | 55.29 MiB | 11 |
| 49,999 | 5.777 s | 30 ms | 151.716 s | 482.29 MiB | 13 |

这些是本机隔离测试数据，不是目标环境 p95/p99，也不是生产容量承诺。

## 5. 数据库与部署边界

新增 migration：

- `20260721080000_business_record_publication_isolation`
- `20260721090000_excel_staging_integrity_fence`

升级时应暂停 Excel confirmation Worker，先部署两条 migration，再同时升级 API/Worker。回滚应用前同样先停 Worker；数据库采用受控前向修复，不直接破坏性回退。数据库超级用户禁用触发器、目标磁盘/WAL 行为和跨版本真实 rollback 仍属于环境与运维门禁。

## 6. 结论与剩余门禁

本地自动化已经证明：财务批准前暂存记录不进入正式读取/写入边界；已批准内容发生变化、最终更新数量不一致或事务失败时整批不发布；重试不会重复生成正式记录。该 P0 可标记为 `engineering_verified_locally`。

以下事项没有因此关闭：

- H10：正式职责分离、MFA、自审批例外和人员矩阵；
- H13：目标 Linux/PostgreSQL/Redis 的磁盘、WAL、checkpoint、并发和 p95/p99；
- H15/H16：独立代码/安全审查、真实 UAT 和 Go Live；
- 真实财务数据、OCR/AI 准确率和生产恢复授权。

Draft PR 必须保持 Draft；本报告不构成发布批准。

# CR-005：Excel 暂存回归与声明收口

## 1. 提交目的

完成 CR-004 后的 P0 全量回归，修复完整性围栏在 PostgreSQL checkpoint/WAL 压力下触发 Prisma 默认 5 秒批次事务超时、导致合法确认被重复执行的问题，并纠正历史文档对 M5.2/R9.3B 证明范围的过度声明。

## 2. 范围与非范围

本提交只调整 Excel Worker 单批事务预算、增加慢批次故障注入回归、恢复 49,999 行完整套件的稳定执行时间，并统一公开状态文档。

本提交不改业务金额/汇总口径，不新增 API 或 migration，不修改 AI/OCR/报告实现，不证明目标环境容量、正式职责分离、真实准确率或生产可用性。

## 3. 修改文件

- `backend/src/import-tasks/import-tasks.service.ts`：为分批 staging 事务设置 10 秒等待和 30 秒执行预算。
- `backend/test/integration/postgres.integration-spec.ts`：增加 6 秒数据库延迟攻击；将大表测试外层 Jest 时限调整为 360 秒，保留全部产品预算断言。
- `README.md`、`docs/IMPLEMENTATION_PROGRESS.md`、`docs/B8_BLOCKER_MATRIX.md`、`docs/PR_PREPARATION.md`、`docs/API_MIGRATION_MATRIX.md`：同步当前证据和边界。
- `docs/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md`、`docs/R9_3B_IMPORT_PUBLICATION_TRANSACTION_HARDENING_REPORT_2026-07-21.md`：增加历史范围声明，不改写旧测试事实。
- `docs/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md`：汇总 CR-002 至 CR-005 的现行结论。
- `docs/commit-reviews/README.md` 与本文：登记逐提交审查。

## 4. 数据与状态机影响

没有 schema 或状态枚举变化。单批 staging 仍在同一数据库事务内创建未发布记录、动态值、来源镜像、staged ledger 并推进 lease-fenced progress。

事务预算从 Prisma 默认约 5 秒显式调整为 `maxWait=10s`、`timeout=30s`。超出该有界预算仍按现有 P2028 恢复逻辑释放租约；最终任务最多尝试次数、180 秒确认预算和失败关闭状态没有变化。

## 5. API 与权限影响

没有路由、DTO、响应或权限变化。批准仍要求当前有效的第二财务、expected version/hash、完整 warning acknowledgement 和幂等键；客户端不能提交角色、批准人、publication status 或目标状态。

## 6. 安全与隐私影响

测试只在隔离 `_test` PostgreSQL 中创建临时延迟表、sequence、function 和 trigger，并在 `finally` 清理。没有记录真实行内容、Token、secret 或预签名 URL；没有读取/修改用户未跟踪资产、模型、真实数据、`.env`、上传物或备份。

延长的是服务端受控数据库事务预算，不是 HTTP/AI 任意执行窗口；项目锁、lease、内容哈希、数据库触发器、affected-row 断言和重试上限保持生效。

## 7. 测试证据

- 新慢批次测试在修复前：EXPECTED_FAIL，1 failed / 76 skipped，17.113 s；101 条记录最终确认，但 `confirmationAttempts=2`。
- 同一测试修复后：PASS，1 passed / 76 skipped，13.820 s；101 条记录一次 attempt 确认。
- 提交前同一定向复验：PASS，1 passed / 76 skipped，Jest 11.654 s；故障注入场景 6.404 s，一次 attempt 确认。
- 强制 Redis 全量 integration：PASS，13 suites / 119 tests，408.027 s。
- 容量样本：30,196 行校验 3.463 s、确认 60.627 s、RSS 增量 55.29 MiB、连接峰值 11；49,999 行校验 5.777 s、确认 151.716 s、RSS 增量 482.29 MiB、连接峰值 13。
- `npm test -- --runInBand`：PASS，47 suites / 428 tests，23.675 s。
- `npm run test:e2e`（强制 Redis）：PASS，17/17，真实 API 与显式 Mock，清理后零文件残留。
- 根前端 runtime：PASS，4/4。
- 前端 production build：PASS，3,147 modules。
- 后端 build：PASS，Prisma generate 和 TypeScript 均退出 0。
- `npm run db:migration-paths`：PASS，空库 43 条及 42→43 升级，224 indexes、89 foreign keys，11.3 s；本提交没有 migration 变更。

## 8. 新增边界与攻击用例

- 第一个匹配任务的 staging INSERT 被数据库触发器延迟 6 秒；确认必须在一次 attempt 内完成。
- 延迟超过旧默认事务时间，确保测试能够复现历史重试，而不是仅覆盖快速路径。
- 49,999 行用例外层允许夹具、确认和闭环断言完成，但继续断言 API `<2s`、校验 `<180s`、确认 `<180s`、RSS 增量 `<1GiB`。
- 全量 Redis 套件同时覆盖登录、上传、模型门、Worker lease、最终发布、篡改、恢复和报告可见性。

## 9. 迁移、部署与回滚

无 migration。应用部署应与 CR-003/CR-004 的 schema 同步，API 和 Worker 使用同一镜像版本。若需应用回滚，先停止 Worker，确认没有 `confirming` 任务，再回到 CR-004；不要回滚到缺少 publication isolation/integrity fence 的版本。

目标环境应监控事务耗时、锁等待、WAL/checkpoint、恢复 attempt 和 49,999 行余量。若 30 秒单批预算在目标环境仍不足，应重新设计批量写入或数据库配置，不继续无证据放宽。

## 10. 已知限制与剩余任务

- 49,999 行本地确认 151.716 秒，距 180 秒仅约 28.3 秒；H13 目标容量仍开放。
- H10 正式职责分离、H15 独立审查和 H16 最终签字未完成。
- 远端 live checks 只能在提交推送后确认，以 Draft PR #4 为准。
- P1 Prompt/bootstrap、Excel AI、OCR/报告财务复核和目标 Staging 仍按任务书顺序推进。

## 11. 审查者检查清单

- [ ] 只调整单批事务预算，没有放宽产品容量断言
- [ ] 故障注入在修复前真实失败、修复后一次 attempt 通过
- [ ] 未发布隔离、内容哈希和 affected-row 围栏仍生效
- [ ] 历史报告只增加范围说明，没有改写旧证据
- [ ] 文档没有将本地工程验收写成生产验收
- [ ] 未提交 secret、真实数据、模型权重或用户未跟踪文件

## 12. 状态

PASS

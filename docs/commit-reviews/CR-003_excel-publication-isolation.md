# CR-003：隔离未发布 Excel 业务记录

## 1. 提交目的

修复 Excel 后台确认在最终原子发布前提前暴露 `BusinessRecord` 的 P0 问题。旧实现只使用业务状态 `pending_confirm`，与合法手工待确认记录无法区分，导致通用记录、项目结构、报表和风险查询均可能触达导入暂存数据。

本提交引入独立发布状态，使“业务生命周期”和“是否已正式发布”成为两个不同维度。

## 2. 范围与非范围

本提交增加向后兼容的 Prisma enum/字段/migration，Excel Worker 显式创建 `unpublished` 记录，通用读取与写入只接受 `published`，最终发布事务负责切换可见性。

本提交不实现暂存内容哈希、版本集合校验、精确 affected row count 或失败清理；CR-002 的数据库篡改测试因此仍预期失败，并由下一提交处理。未修改前端、Prompt、OCR、报告复核状态机或部署配置。

## 3. 修改文件

- `backend/prisma/schema.prisma`：新增 `BusinessRecordPublicationStatus` 和 `BusinessRecord.publicationStatus`，增加复合查询索引。
- `backend/prisma/migrations/20260721080000_business_record_publication_isolation/migration.sql`：创建 enum、字段、来源约束和索引；既有记录回填为默认 `published`。
- `backend/src/import-tasks/import-tasks.service.ts`：Excel 暂存记录写为 `unpublished`；最终事务切换为 `published`。
- `backend/src/records/records.service.ts`：列表、详情及 PATCH/confirm/void 的读取与条件更新只接受已发布记录。
- `backend/src/projects/projects.service.ts`：项目结构只加载已发布记录。
- `backend/src/reports/reports.service.ts`：财务、老板、项目统计和记录计数只读取已发布记录。
- `backend/src/reports/report-snapshots.service.ts`：canonical ReportSnapshot 只读取已发布记录。
- `backend/src/risk-rules/risk-rules.service.ts`：历史经营记录规则只读取已发布记录。
- `docs/commit-reviews/README.md` 与本文：登记本提交审查证据。

## 4. 数据与状态机影响

新增状态维度：

```text
Excel staging: publicationStatus=unpublished, status=pending_confirm
Excel commit:  publicationStatus=published,   status=confirmed
其他来源:      publicationStatus=published（数据库安全默认）
```

迁移把既有记录统一视为已发布，保持现有手工、工单和 OCR 数据可见。数据库约束规定 `unpublished` 只能关联 Excel 导入任务。发布状态索引覆盖项目结构和报表常用条件。

任务 lease、审批快照、幂等键和项目级锁不变。最终发布的行数与内容完整性仍待 CR-004 收紧。

## 5. API 与权限影响

路由、DTO、统一响应格式和角色矩阵不变。行为变化如下：

- `GET /api/records`、`GET /api/projects/:projectId/records` 不返回未发布行；
- `GET /api/records/:id` 对未发布行返回统一 404；
- `GET /api/projects/:id/structure` 不包含未发布行；
- 通用 PATCH、confirm、DELETE 对未发布行返回统一 404；
- 财务/老板报表、ReportSnapshot 和风险历史查询排除未发布行；
- 合法手工 `pending_confirm` 记录仍是 `published`，保留原有可见和可确认行为。

不同财务二次批准仍由现有 import confirm 权限检查执行；上传者自审批测试继续返回 `403/IMPORT_SELF_APPROVAL_FORBIDDEN`。

## 6. 安全与隐私影响

隔离状态存储在数据库，而不是依赖前端、URL 参数或某一个 controller。`importTaskId` 即使被猜中，也不能扩大通用查询范围。写接口在读取和条件更新两处都要求 `published`，减少并发状态变化产生的旁路。

未读取或修改 `.env`、真实业务文件、上传/隔离目录、备份、模型权重或用户未跟踪资产。migration 不包含真实数据或外网调用。

## 7. 测试证据

实际执行：

- `npx prisma format`：PASS。
- `npx prisma validate`：PASS。
- `npm run prisma:generate`：PASS。
- `npm run build`：PASS，Prisma generate 与两个 TypeScript build 均退出 0。
- `npm test -- --runTestsByPath test/app.spec.ts test/reports-record-generation.spec.ts --runInBand`：PASS，2 suites / 20 tests，8.434 秒。
- `npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern "keeps unpublished staging unreachable through generic record APIs"`：PASS，1 suite / 1 passed / 73 skipped，7.175 秒。
- `npm run db:migration-paths`：PASS，空库安装 42 个 migration；41 个基线 migration 升级到本 migration 也通过；schema status、表、enum、索引和外键核验通过。
- `npm run check:hygiene`：PASS，共检查 726 个 tracked/candidate 文件。
- `git diff --check`：PASS。
- `npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern "fails publication closed after staged record and value tampering"`：EXPECTED_FAIL，1 failed / 73 skipped，5.071 秒；任务仍错误进入 `confirmed` 且有 1 条已发布可见记录，证明 CR-004 仍为 P0 阻塞项。

## 8. 新增边界与攻击用例

- 上传者自审批失败且不会生成暂存记录；
- 第二财务批准后，Worker 暂停在最终事务前；
- finance Token 对 list/detail/project list/project structure 的未发布读取攻击；
- finance Token 对 PATCH/generic confirm/void 的未发布写攻击；
- 手工 `pending_confirm` 与 Excel `unpublished` 的语义分离；
- 直接篡改状态、金额、动态字段和版本后的剩余发布完整性红灯；
- 空库和既有库升级两条 migration 路径。

## 9. 迁移、部署与回滚

部署顺序为先执行 additive migration，再发布同时识别新字段的 API/Worker。默认 `published` 保证迁移期间旧写路径不会意外隐藏正式数据，但新 Worker 不应在旧 API 尚未升级时开始产生 `unpublished` 数据。

应用回滚应先停止 Worker，再回滚 API/Worker 代码。已应用 enum/字段不应直接破坏性删除；如确需数据库回退，必须先确认不存在 `unpublished` 行，再通过新的 forward migration 删除索引、约束、字段和 enum。禁止在生产环境手工执行未经验证的 down SQL。

## 10. 已知限制与剩余任务

- 最终事务尚未验证暂存记录/值的内容哈希、版本、状态集合和批准快照；
- SQL UPDATE 尚未断言 BusinessRecord、ImportRow 和 ledger affected row count；
- 被直接篡改的暂存数据仍可能造成部分发布并错误把任务标为 `confirmed`；
- 失败、重试、取消、恢复后的 cleanup 仍需按发布状态而非业务状态收口；
- P0 全量门禁和文档声明纠正尚未执行。

下一提交为 `P0: fence Excel publication integrity`。

## 11. 审查者检查清单

- [ ] 实现与提交目的相符
- [ ] 没有扩大权限或数据可见性
- [ ] 失败路径保持关闭
- [ ] 测试能够复现旧问题并证明修复
- [ ] 文档没有夸大完成度
- [ ] 未提交秘密、真实数据、模型权重或本地文件

## 12. 状态

PARTIAL

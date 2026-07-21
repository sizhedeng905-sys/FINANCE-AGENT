# CR-004：封闭 Excel 最终发布完整性

## 1. 提交目的

修复 Excel 后台确认只验证 `ImportRow` 批准摘要、却未逐条核对暂存 `BusinessRecord`、`RecordValue` 和封存来源证据的 P0 问题。旧路径还没有断言最终 SQL 的实际更新行数，因此直接篡改、并发变化或数据库少更新一行时，可能错误地把任务标记为 `confirmed`。

本提交在 CR-003 的 `unpublished` 隔离基础上增加内容寻址、数据库失效触发器、最终事务栅栏、精确 affected-row 断言和可重试清理。

## 2. 范围与非范围

本提交只处理 Excel 暂存记录从创建、封存、发布失败到重试的完整性。它覆盖暂存记录/值/来源行的内容、数量、状态、版本、批准快照、ledger 数量和最终更新行数。

本提交不改变前端交互、Prompt、OCR、报告复核、业务口径或部署拓扑；不宣称 P0 全量门禁完成。Redis、Playwright、全仓回归和历史文档声明纠正属于下一提交。

## 3. 修改文件

- `backend/prisma/schema.prisma`：为 `BusinessRecord` 增加暂存内容/批准哈希，为 `ImportRow` 增加生成记录哈希和值数量镜像。
- `backend/prisma/migrations/20260721090000_excel_staging_integrity_fence/migration.sql`：增加字段、格式约束，以及 `BusinessRecord`、`RecordValue`、封存 `ImportRow` 的完整性失效触发器。
- `backend/src/import-tasks/import-tasks.service.ts`：计算并封存逐记录 canonical SHA-256，流式重算 manifest；最终事务核对数据库事实并精确断言三组 UPDATE；失败重试清理全部未发布记录和镜像字段。
- `backend/test/integration/postgres.integration-spec.ts`：增加直接内容篡改、预检后来源证据篡改、数据库少更新一行、失败清理和成功重试攻击测试。
- `docs/commit-reviews/README.md` 与本文：登记本提交范围和实测证据。

## 4. 数据与状态机影响

新增持久化字段：

```text
business_records.staging_content_hash
business_records.staging_approval_hash
import_rows.generated_record_hash
import_rows.generated_record_value_count
```

每条 Excel 暂存记录的哈希覆盖记录 ID、项目/模板及版本、模板/来源/确认快照、业务字段、Decimal 金额、附件、创建人和排序后的动态字段值。批次完成前按 ID 分页重算全部哈希，并生成批次 manifest hash 与总 value count。

未发布 `BusinessRecord` 或其 `RecordValue` 被修改时，数据库触发器清空封存哈希并递增记录版本。已经封存且仍为 `mapped` 的 `ImportRow` 证据被修改时，触发器同时清空来源行镜像与父记录封存哈希，并递增父记录版本，使后续误写回来源镜像也不能恢复可发布状态。最终事务只发布版本 1、状态正确、批准哈希一致且来源行/值数量逐条吻合的记录。

最终事务精确断言 `BusinessRecord` 发布、`ImportRow` 确认和 staged ledger 转换的实际行数均等于批准记录数。任一断言失败会回滚整笔事务，任务进入 `confirmation_failed`；下一次合法批准先删除全部 `unpublished` 暂存记录、值和 staged ledger，再重新生成，不复用被污染内容。

现有 lease、heartbeat、项目级锁、批准幂等键和不同财务二次批准规则保持不变。

## 5. API 与权限影响

没有新增路由或 DTO。成功响应仍保持现有异步确认契约；完整性失败由后台任务记录为 `confirmation_failed`，不产生正式记录或成功事件。

最终事务继续重新读取当前批准人，要求账号启用、具备 finance 权限且不是原上传者。通用 records API 仍由 CR-003 的 `published` 条件隔离暂存记录。客户端不能提交发布状态、哈希、批准人或目标状态。

## 6. 安全与隐私影响

哈希和数量均由服务端生成，数据库格式约束只接受小写 64 位 SHA-256。封存内容变化由数据库触发器失效，不依赖前端行为。预检后的来源行竞态还由最终关联 UPDATE 再次核对，避免 time-of-check/time-of-use 窗口。

攻击测试只使用合成 PostgreSQL 数据和测试专用触发器。未读取或修改 `.env`、真实业务文件、上传/隔离目录、备份、模型权重和用户未跟踪资产；日志与审查文档不包含凭据或原始业务内容。

## 7. 测试证据

实际执行：

- 新增来源证据竞态测试在修复前：EXPECTED_FAIL，1 failed / 75 skipped；任务错误进入 `confirmed` 并发布 2 条记录，6.390 秒。
- 同一测试修复后：PASS，1 passed / 75 skipped，7.320 秒。
- `npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern "B8-03 background Excel confirmation"`：PASS，1 suite / 18 passed / 58 skipped，374.612 秒。
- 最终父记录失效改动后，定向执行“记录/值篡改、来源证据篡改、末批失败并重试”三项：PASS，1 suite / 3 passed / 73 skipped，9.993 秒。
- 上述 30,196 行 profile：87,071 ms、峰值 RSS 增量 99.91 MB、峰值连接 7。
- 上述 49,999 行 profile：166,950 ms、峰值 RSS 增量 443.39 MB、峰值连接 9。
- `npm run build`：PASS，Prisma generate 和两个 TypeScript build 均退出 0，9.4 秒。
- `npm run db:migration-paths`：最终 migration 内容下 PASS，空库安装 43 个 migration，42 个基线 migration 升级到本 migration；schema/table/enum/index/foreign-key 校验通过，11.9 秒。
- `npm test -- --runInBand`：PASS，47 suites / 428 tests，24.078 秒。
- `git diff --check` 与仓库 hygiene/staged hygiene：在提交前执行，结果记录于 Git 提交输出；未通过则不得提交。

本提交未运行 Redis 集成和 Playwright，状态为 NOT_RUN；它们属于 P0-2 阶段全量门禁，不能由本提交的 PostgreSQL 结果替代。

## 8. 新增边界与攻击用例

- 暂存 `BusinessRecord` 状态、金额和版本被直接修改后失败关闭；
- 暂存 `RecordValue` 金额被直接修改后失败关闭；
- 完整性预检完成后、最终事务开始前篡改封存 `ImportRow` 证据，发布失败且零正式记录；
- PostgreSQL 测试触发器故意吞掉一条发布 UPDATE 时，全部记录/来源行/ledger 变更回滚；
- 失败后保留的数据均为不可见 `unpublished`，没有成功 audit/ledger；
- 再次批准先清理污染 staging，并且只发布一份记录和一份批次成功事件；
- 5,001、30,196、49,999 行成功路径；50,000 行深分页；
- 账号停用、旧 worker lease、最后一批失败、数据库短断、事务超时/冲突、并发确认和最终化超时恢复。

## 9. 迁移、部署与回滚

本 migration 为 additive，既有正式记录的新增字段保持 `NULL`，不会重新解释其业务状态。部署应先暂停 Excel confirmation Worker，执行 CR-003 与本 migration，再同时升级 API/Worker，最后恢复 Worker；不得让新代码连接缺少字段/触发器的数据库。

应用回滚应先停止 Worker，再回滚 API/Worker。数据库不做直接破坏性 down migration；如必须移除，应先证明没有 `unpublished` 记录和在途确认任务，再通过新的 forward migration 按“触发器、函数、约束、字段”顺序删除。触发器增加写放大，目标 staging/production-like 环境仍需观测锁等待和 5 万行容量。

## 10. 已知限制与剩余任务

- P0-2 的 Redis 集成、Playwright、全仓安全/卫生门禁和文档过度声明纠正尚未完成；
- 49,999 行测试峰值 RSS 增量 443.39 MB，虽通过当前自动预算，仍需在目标容器限制下复测；
- 数据库超级用户可以禁用触发器或直接篡改已发布记录，这属于数据库访问控制、审计和目标环境运维边界；
- 本提交不替代 H10 正式职责分离签署，也不证明生产部署、真实备份恢复或真实业务准确率。

下一提交处理 `P0: close Excel staging regressions and claims`。

## 11. 审查者检查清单

- [ ] 实现与提交目的相符
- [ ] 没有扩大权限或数据可见性
- [ ] 失败路径保持关闭
- [ ] 测试能够复现旧问题并证明修复
- [ ] 文档没有夸大完成度
- [ ] 未提交秘密、真实数据、模型权重或本地文件

## 12. 状态

PASS

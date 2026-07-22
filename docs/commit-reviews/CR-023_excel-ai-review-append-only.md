# CR-023: Excel AI Review Append-Only Guard

提交：`503eac0 fix: make Excel AI review evidence append-only`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 目标与红灯复现

- 目标：让 `ImportAiReviewDecision` 成为数据库层 append-only 审核证据，普通 runtime Prisma/SQL 不能 UPDATE、DELETE，也不能通过删除父任务触发级联来绕过门禁。
- 修复前红灯：直接 `prisma.importAiReviewDecision.update()` 成功，把审核理由改成“普通运行时不应修改不可变审核证据”；定向 PostgreSQL 用例因此 1 FAIL。
- 根因：应用服务只调用 INSERT/SELECT，但数据库没有不可变触发器，且任务与来源列外键使用 `ON DELETE CASCADE`。

## 修改范围

- migration `20260722120000_excel_ai_review_append_only` 增加 `BEFORE UPDATE OR DELETE` 触发器；普通 UPDATE/DELETE 统一抛出不可变错误。
- 审核行到 `import_tasks`、`import_columns` 的外键从 Cascade 改为 Restrict，父对象删除不能静默销毁审核证据。
- maintenance 仅允许事务内设置 `app.allow_import_ai_review_purge=on` 后执行 DELETE；即使设置 maintenance，UPDATE 仍然被拒绝。
- E2E 清理在同一事务内显式启用维护开关、先删除审核行，再删除任务；开关使用 transaction-local 配置，不跨事务泄漏。
- digest 攻击夹具不再原位 UPDATE。它通过受控 DELETE+按原 ID 重建模拟审计存储被替换，继续验证重新校验后和 Worker 发布前的 digest 失效防线。

## 攻击断言

- 普通 runtime UPDATE：拒绝。
- 普通 runtime DELETE：拒绝。
- maintenance 事务内 UPDATE：拒绝。
- 直接删除含审核证据的父 ImportTask：Restrict 拒绝。
- maintenance DELETE+重建：仅测试维护夹具允许，用于验证 digest 可检测替换。
- maintenance 事务结束后的普通 DELETE：再次拒绝，证明开关未泄漏。
- 审核替换后直接批准：`409 / IMPORT_AI_REVIEW_DIGEST_STALE`，正式记录 0。
- 批准调度后替换再恢复 Worker：任务 `confirmation_failed`，正式记录 0。

## 测试证据

- 红灯定向 PostgreSQL：1 FAIL；普通 UPDATE 意外 resolve，稳定复现缺陷。
- 修复后定向 PostgreSQL：1/1 PASS，5 项按测试名筛选 SKIPPED。
- `npm run test:integration -- ai-ingestion.integration-spec.ts`：6/6 PASS。
- `npm run test:e2e -- e2e/excel-ai-advisory.spec.ts`：3/3 PASS，28.2s；受控清理无孤儿审核行。
- `npx prisma validate`：PASS。`npm run prisma:validate` 因仓库没有该 script 而失败，未伪装成 schema 失败或通过。
- 后端 `npm run build`：PASS，包含 Prisma generate 与 TypeScript build。
- 后端单元：50 suites / 464 tests PASS，22.862s。
- 全量 PostgreSQL：11 suites / 111 tests PASS；3 suites / 14 tests 受环境门禁 SKIPPED；48 migrations 从空库重放成功，总耗时 409.343s。
- 大文件边界实际执行：30,196 行约 84.371s、RSS 增量 83.61MB；49,999 行约 156.915s、RSS 增量 116.21MB。
- `npm run test:e2e -- e2e/friday-demo.spec.ts`：1/1 PASS，21.9s；正式记录与 grounded snapshot 演示链保持可用。
- staged diff check 与 repository hygiene：PASS。

## Schema 与迁移影响

- migration 数量从 47 增至 48。
- 迁移只替换两个外键删除动作并增加函数/触发器，不重写或删除现有审核行。
- Prisma schema 与数据库均声明 `onDelete: Restrict`，避免后续自动迁移把约束改回 Cascade。
- 空库安装已实际验证；本轮未在真实业务库执行升级，目标环境迁移仍受 H13/H16 与备份/回滚门禁约束。

## 限制与回退

- transaction-local GUC 是仓库现有 audit maintenance 模式，用于防普通 runtime ORM 误写并支持测试清理；拥有任意 SQL 能力和同一数据库凭据的完全失陷进程仍可主动设置该开关。生产应由迁移/维护角色与应用 runtime 角色分离，属于 H13/H16 部署门禁。
- maintenance 永远不能 UPDATE，只能先删除再按审计流程重建；生产数据不应使用测试夹具的替换方式。
- 回退触发器或把外键改回 Cascade 会重新开放证据销毁路径，不是安全回退。兼容问题应前滚修复清理/归档工具。
- 本轮没有真实模型、真实公司数据、目标环境或人工 UAT 证据，不声明生产通过。

## 下一步

- P1-C：审计现有 OCR revision、evidence、Provider、approval snapshot 和 Worker，绘制复用链并先写攻击测试。
- 只使用 Mock Provider 与合成 PDF，补齐 evidence-bound AI/人工审核框架；AI 仍不能批准或写正式记录。
- 保持周五 Demo 作为每个 OCR 小步后的独立回归门禁。

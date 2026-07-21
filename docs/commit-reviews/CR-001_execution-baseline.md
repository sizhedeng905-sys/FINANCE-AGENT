# CR-001：逐提交审查执行基线

## 1. 提交目的

从当前候选分支开始建立可追溯的逐提交审查制度，并冻结本轮修复起点。只读审计确认 Excel 后台确认会提前创建 `BusinessRecord(status=pending_confirm)`，而通用记录查询、详情、修改、确认、作废和项目结构查询没有统一排除这些未发布导入记录，因此必须先按 P0 处理数据可见性与审批旁路。

## 2. 范围与非范围

本提交仅新增 commit-review 索引、当前基线和历史证据索引。

本提交不修改数据库、API、权限、Excel Worker、前端、模型配置或部署配置，也不声称已经修复 P0。

## 3. 修改文件

- `docs/commit-reviews/README.md`：定义新提交的审查索引、追溯方式和分组。
- `docs/commit-reviews/CR-001_execution-baseline.md`：记录当前 HEAD、工作区保护边界、已确认风险和本轮执行起点。
- `docs/commit-reviews/LEGACY_BASELINE_INDEX.md`：只读索引已有阶段证据，不改写历史。

## 4. 数据与状态机影响

无数据库或状态机变化。

当前待修不变量：`ImportTask(confirming)` 期间创建的记录仍使用通用 `BusinessRecord.pending_confirm` 状态；该状态同时用于合法手工待确认记录，不能用“隐藏全部 pending_confirm”作为修复。

## 5. API 与权限影响

无 API 或权限变化。

已确认待测试入口包括：`GET /api/records`、`GET /api/records/:id`、项目 records/structure、`PATCH /api/records/:id`、通用 confirm 和 void/delete。上传者与第二财务批准边界仍需真实 Token 攻击测试。

## 6. 安全与隐私影响

本提交不读取或提交 `.env`、真实业务文件、上传/隔离文件、备份、模型权重、本地证据目录或用户未跟踪资料。既有未跟踪资产保持未暂存、未修改。

已确认风险为未发布财务记录可能被通用业务入口观察或修改，后续修复必须失败关闭并保持手工待确认记录的既有行为。

## 7. 测试证据

实际执行：

- `git status --short --branch`：当前分支 `agent/b8-stable-hardening`，起始 HEAD 与远端均为 `3c6991b8c4c25c6f6ebc873ea47df98906e03396`；无已跟踪改动。
- `gh pr view 4 --repo sizhedeng905-sys/FINANCE-AGENT ...`：PR #4 为 OPEN Draft；起始 HEAD 的 Build/acceptance 与 CodeQL 全部 SUCCESS。
- `rg`/只读源码检查：确认 staging 创建、通用 records 入口、项目结构查询和最终发布 UPDATE 的当前调用链。
- `npm run check:hygiene`：PASS；检查 723 个 tracked/candidate 文件。
- `git diff --check`：PASS。
- 业务单元、PostgreSQL、Playwright：`NOT_RUN`，本提交仅建立治理基线。

## 8. 新增边界与攻击用例

本提交未新增测试。已排入下一提交的攻击矩阵：

- 未发布记录 list/detail/project structure 可见性；
- 通用 PATCH/confirm/void 写入旁路；
- 上传财务自审批；
- staged record/value 直接篡改；
- 发布 affected row count 不一致；
- 失败、恢复、取消和并发后的孤儿污染。

## 9. 迁移、部署与回滚

无 migration、配置或部署变化。回滚方式为普通 revert 本文档提交；不得改写此前公共历史。

## 10. 已知限制与剩余任务

- P0 尚未修复，下一提交必须先增加真实 PostgreSQL/API 失败测试。
- 正式 Prompt Catalog 当前为空，P1 Prompt 目录逐字核验保持 `HUMAN_REQUIRED`。
- 目标服务器、真实恢复、独立审查和最终 UAT 继续保持 `BLOCKED_EXTERNAL`/`HUMAN_REQUIRED`。

## 11. 审查者检查清单

- [ ] 实现与提交目的相符
- [ ] 没有扩大权限或数据可见性
- [ ] 失败路径保持关闭
- [ ] 测试能够复现旧问题并证明修复
- [ ] 文档没有夸大完成度
- [ ] 未提交秘密、真实数据、模型权重或本地文件

## 12. 状态

PARTIAL

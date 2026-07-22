# CR-021: Excel AI Review Digest Binding

提交：`6e3b98b fix: bind Excel approvals to AI review digest`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 目标与失败复现

- 目标：让第二财务读取的全部服务器审核事实，与重新校验、批准快照、后台 Worker 和最终记录来源快照绑定到同一个 canonical digest。
- 红灯夹具完成 10 条 AI 审核决定后重新校验；修复前 `validation.snapshot.aiReview` 为 `undefined`，定向 PostgreSQL 测试稳定失败。
- 根因：既有 validation/approval snapshot 只冻结 mapping、row set 和 normalized output；`ImportAiReviewDecision` 在重新校验后变化不会改变 task version，也不会阻止批准。

## 修改范围

- 服务端按固定顺序读取任务全部 AI 审核行，规范化决定、理由、来源、证据、最终字段、actor、时间和关联 AI task 后计算 `excel-ai-review-digest/1.0`。
- digest 同时验证 succeeded AI task、output hash、version vector hash、review basis hash，以及 Provider/Prompt/Schema 冻结事实；非法 provenance 失败关闭。
- 分页读取接口返回基于完整任务事实的 digest 和批次 provenance，不使用当前页或客户端统计计算。
- 重新校验在最终 task lock 事务中计算 digest，并冻结到 `excel-validation/1.1`；audit/ledger 保存 digest hash。
- 批准事务重新计算 digest，只有与 validation snapshot 完全一致才生成 `excel-approval/1.1`；approval snapshot、记录 confirmation snapshot 与审计链继续携带 digest hash。
- 每个后台 staging 批次、完整性准备和最终发布事务均重新计算 digest；批准调度后发生变化时任务进入 `confirmation_failed`，正式记录保持 0。
- 无 AI 审核行时生成显式 `manual` 空摘要，纯人工导入流程不依赖伪造 AI 决定。
- 前端类型与显式 Mock 同步 1.1 契约。本提交没有增加批准按钮或 AI 自动动作。

## 财务与安全影响

- UI 不能再展示一份审核证据、同时让后端批准另一份旧快照。
- 审核理由、证据、actor 或 provenance 在重新校验后变化会返回 `409 / IMPORT_AI_REVIEW_DIGEST_STALE`。
- 已经调度的 Worker 也不能绕过该检查；异常只会留下失败任务，不会发布 staging 记录。
- `excel-validation/1.0` 和 `excel-approval/1.0` 不含该摘要。升级后旧待批准任务必须重新校验，不能被当作 1.1 继续批准。
- 该摘要不代表 AI 正确，也不允许 AI 直接创建 BusinessRecord；它只证明人工看到、校验和批准的是同一组服务器事实。

## 测试证据

- 红灯：AI 审核重新校验后缺少 `validation.snapshot.aiReview`，1 test FAIL。
- 定向 PostgreSQL 攻击：1/1 PASS；覆盖摘要冻结、分页摘要一致、重新校验后修改理由返回 409、批准调度后修改理由使 Worker 失败且正式记录为 0。
- Excel/OCR AI suggestion PostgreSQL 文件：6/6 PASS。
- Excel 批准状态机定向 PostgreSQL：2/2 PASS；同文件其余 75 项按 `-t` 条件 SKIPPED，不计为通过。
- 后端单元：50 suites / 464 tests PASS。
- 后端 build：PASS。
- 前端 production build：PASS，3,150 modules。
- staged repository hygiene 与 `git diff --cached --check`：PASS。
- PostgreSQL 全量、完整 Playwright、周五 Demo、远端 CI：本提交时 `NOT_RUN`，将在确认页 UI 同步后统一回归。

## Schema、API 与 UI 行为

- API：`GET /api/import-tasks/:id/ai-review-decisions` 新增 `digest`，包含模式、完整统计、AI task 批次 provenance 和 digest hash。
- Snapshot：validation/approval JSON schema 从 `1.0` 升到 `1.1`；数据库列未变化，无 migration。
- UI：仅同步 TypeScript/Mock 契约；Provider、Prompt、Schema 和摘要的可视化留给下一独立提交。

## 限制与回退

- `ImportAiReviewDecision` 本提交仍可被普通 runtime SQL UPDATE/DELETE；digest 能检测批准前后变化，但数据库 append-only 门禁属于后续 P1-B。
- digest 对最多 200 条 AI 映射建议做一次有界读取；没有把 5 万行导入数据装入摘要。
- 回退应用会重新允许 1.0 快照缺少 AI 摘要，不能作为安全回退。应以前滚方式修复兼容问题；已生成的 1.1 快照继续保留审计。
- 只使用 Mock/合成数据与一次性 PostgreSQL 测试库，不代表真实模型准确率、真实财务口径、目标环境或人工 UAT 通过。

## 下一步

- P1-A：确认页展示 Provider、模型、Prompt/Schema、生成时间、完整统计、warning/evidence 与 digest，并在浏览器端对当前 validation digest 失败关闭。
- P1-A：补第二财务真实 API E2E，从服务器证据、重新校验走到精确入账。
- P1-B：增加审核表 append-only 数据库门禁和 maintenance 路径攻击测试。
- GitHub 网络此前连续两次失败，继续标记 `blocked_external`；不 force push，不借用旧 SHA 的远端绿色状态。

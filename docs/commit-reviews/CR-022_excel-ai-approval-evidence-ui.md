# CR-022: Excel AI Approval Evidence UI

提交：`b908793 feat: expose digest-bound Excel approval evidence`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 目标与边界

- 目标：让重新登录的第二位财务在批准前看到服务端冻结的 Provider、模型、Prompt、Schema、生成时间、完整决定统计和审核摘要，并确保页面显示的摘要与当前 validation snapshot 一致。
- 该页面只显示和校验人工审核证据，不授予 AI 批准权，也不把 Mock 结果冒充真实模型结果。
- 本提交没有修改数据库、后端批准事务或正式财务口径；这些约束由 CR-021 的后端 digest 绑定继续承担。

## 修改范围

- 确认页显示审核模式、采纳/修改/拒绝/忽略/待处理统计、完整摘要哈希，以及每个 AI 批次的 Provider class、模型、Prompt、Schema、时间和 provenance 哈希。
- Mock Provider 以显式警示标签展示；纯人工任务返回可重复计算的 `manual` 空摘要，不伪造 AI 决定。
- 确认页将任务 revision、validation snapshot 和审核摘要同时纳入读取状态；证据加载失败、存在 pending 决定或摘要不一致时，批准按钮失败关闭并提示重新校验。
- 批准完成页显示最终 approval snapshot 中的 AI 审核摘要，方便从正式记录回溯批准依据。
- 证据卡为 390px 移动视口增加局部换行和宽度约束；宽表仍在自身容器内滚动，不把整页撑宽。
- 真实 API E2E 扩展为第二财务重新登录、读取相同摘要、重新校验、故障关闭、恢复、幂等重放、后台完成和精确一条正式记录的闭环。

## 财务与安全影响

- 财务不能在证据 API 不可用时仅凭旧页面继续批准。
- 浏览器只把服务端摘要与 validation snapshot 做相等性门禁；最终可信判断仍由服务端批准事务和 Worker 重算，不信任前端。
- 第二财务看到的是服务端记录的实际 Provider class。Mock、Local、External 不会被合并成同一种展示。
- 确认重放沿用 HttpOnly 会话 Cookie、CSRF token 与同一 Idempotency-Key，验证网络重试不重复入账。

## 测试证据

- `npm run test:e2e -- e2e/excel-ai-advisory.spec.ts` 第一次：2/3 PASS；唯一失败为 Playwright strict locator 同时命中标签和警示文本。
- 同命令第二次：2/3 PASS；收紧 locator 后暴露真实 390px 页面级横向溢出，测试保留并修复 UI。
- 同命令最终：3/3 PASS，27.3s；包括移动端宽度、跨会话证据、证据故障关闭、摘要绑定、幂等重放及单记录断言。
- `npm run build`：PASS，3,150 modules，8.4s。
- `npm run test:e2e -- e2e/friday-demo.spec.ts`：1/1 PASS，22.0s；导入、正式记录和 grounded report snapshot 演示链保持可用。
- `git diff --cached --check` 与 staged repository hygiene：PASS。
- 后端单元、PostgreSQL 全量、完整 Playwright、远端 CI：本 UI 小步 `NOT_RUN`；CR-021 已记录后端 digest 的定向与单元证据，后续收口阶段执行全量门禁。

## Schema、API 与迁移

- 无数据库 migration。
- API 仍使用 CR-021 的 `excel-ai-review-digest/1.0`、`excel-validation/1.1` 和 `excel-approval/1.1` 契约。
- Mock API 现在按当前任务 revision 生成与校验快照一致的显式 manual digest，不再返回固定零哈希占位。

## 限制与回退

- 测试 Provider 为显式 Mock，数据为合成 E2E fixture；不代表真实模型准确率、真实业务 UAT、目标环境或生产授权。
- 浏览器只分页显示决定行，但摘要和统计由服务端基于完整批次计算；不能用当前页数据重算 digest。
- 回退前端会失去可见性和浏览器门禁，但后端 CR-021 仍会拒绝 stale digest。安全修复应优先前滚，不应回退后端 1.1 契约。
- GitHub 推送此前连续两次受网络阻塞，本提交仍标记 `REMOTE_PUSH_BLOCKED_EXTERNAL`，未借用旧远端状态作为通过证据。

## 下一步

- P1-B：为 `ImportAiReviewDecision` 增加数据库 append-only 门禁及受控 maintenance 路径。
- 增加普通 runtime 直连 UPDATE/DELETE 拒绝、非授权伪 maintenance 拒绝和测试维护路径可清理的 PostgreSQL 攻击断言。
- P1-B 关闭后再进入 OCR 审核证据链，避免重复实现并保持周五 Demo 回归。

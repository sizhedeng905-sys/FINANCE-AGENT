# 后续 2-4 周推进计划

计划只按可验证结果关闭，不以“写完页面”或“模型能返回内容”作为完成。

## 第 1 周：演示候选与 Excel AI 建议闭环

预期结果：

- 当前 CR-011/CR-012 提交获得同 SHA Build 与 CodeQL 证据；外部网络阻塞按 URL 和日志如实登记。
- 按 Runbook 连续完成三次人工演练，逐次记录耗时、金额、偏差和清理结果。
- 前端接入真实 `POST/GET /api/import-tasks/:id/ai-suggestions`，明确显示候选模板、逐列建议、warning、evidence、Prompt/模型/Mock provenance。
- 采纳 AI 建议只修改当前页面草稿；保存前不发 PUT、不自动重校验、不切换冻结模板、不创建 BusinessRecord。

验收：Playwright 覆盖真实 endpoint、逐列采纳/编辑/拒绝、跨模板失败关闭、Provider 不可用回到完整手工路径，以及采纳前正式记录为 0。

## 第 2 周：服务端 AI 审核决策与第二财务证据

预期结果：

- 保存映射时携带 expectedVersion/reviewRevision，旧页面和旧 AI 输出返回可理解的 409。
- 服务端保存 accept/edit/reject 决策及 `aiTaskId`、output/version-vector hash、sourceRef、建议值、最终值、actor、time、reason；禁止跨任务、跨项目和跨模板篡改。
- 第二财务确认页能查看 AI 建议、人工修改、确定性校验与最终批准快照的审计摘要。

验收：PostgreSQL 集成覆盖并发编辑、账号停用、角色撤销、过期输出、越权 ID、幂等重放和事务回滚；AI 模块仍不能直接调用正式记录写服务。

## 第 3 周：真实样本校准与报告人工复核

依赖：项目负责人提供已授权、脱敏、带真值的最小 Excel/OCR 样本和 H06/H08 报表口径。

预期结果：

- 建立不进入 Git 的真值清单，分开测量解析、OCR、字段映射和人工修正，不把总体成功率混成单一数字。
- 报告 Narrative 增加草稿/接受/退回状态和来源展开；所有数字继续由 Snapshot/Decimal 提供。
- 对不确定日期、金额、多候选、混合币种和缺证据值保持失败关闭。

验收：盲测结果、误差分类、逐分对账和人工签收均有可复核证据；未达门槛时继续标记 `REAL_SAMPLE_NEEDED`。

## 第 4 周：受控 Staging 与发布准备

依赖：H13-H16 的目标服务器、域名/TLS、对象存储、Redis、ClamAV、监控告警、备份恢复和独立审查资源。

预期结果：

- 在受控 Staging 完成 migration、不可变镜像、SBOM/CVE、非 root、健康检查、权限、上传、队列、回滚和备份恢复 smoke。
- 用同一合成周五故事线做 Staging E2E；不上传真实数据，不静默切换 Mock/Provider。
- 形成 owner UAT 与 Go-Live 的逐项证据包；未完成项保留明确 H 编号和保守行为。

验收：新 SHA 全部门禁绿色、恢复目标有真实演练、外部 Provider 数据政策获批、owner UAT 签收。未满足时保持 Draft 与 `NOT_PRODUCTION_READY`。

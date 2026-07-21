# CR-015: Excel AI Review Confirmation UI

预计提交标题：`feat: show Excel AI review evidence before approval`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING`

## 变更边界

- 复用 CR-014 的分页只读接口，不新增 AI、审批或业务记录写服务。
- 在第二财务确认页展示服务端审核决定和 provenance。
- 扩展 E2E fixture、清理器和真实 API 场景，不提交生成文件。

## 关键不变量

- 页面不信任本地缓存的 AI 建议，只显示服务端已经核验并持久化的决定。
- 任务、账号或分页变化后的晚到响应不能覆盖当前页面。
- 证据读取失败时最终批准禁用；纯人工任务的空证据集合不是错误。
- 展示 AI 证据、重新校验和最终批准是三个独立步骤，AI 不直接写入正式记录。
- 表格在 390px 视口保持页面无持续横向溢出。

## 验证

- 单场景 E2E：1/1 PASS。
- Excel AI 专项：3/3 PASS。
- 完整 Playwright：21/21 PASS。
- 前端 production build：PASS，3,149 modules。
- 每轮 E2E teardown 均确认磁盘文件残留为 0。

## 剩余风险

- 本提交后的 Build/CodeQL 需要新 SHA 远端证明。
- 三次现场人工演练、真实模型/业务真值、目标 Staging 和 owner UAT 未完成。
- 最终批准快照仍由后端审计链承担；后续 UI 增量可以在提交完成页增加只读批准快照/BusinessRecord 跳转，但不得复制另一套事实源。

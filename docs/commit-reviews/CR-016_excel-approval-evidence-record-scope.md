# CR-016: Excel Approval Evidence and Record Scope

预计提交标题：`feat: link Excel approval evidence to scoped records`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 范围

- 复用现有批准快照和记录查询 API，补齐任务级导航与只读证据 UI。
- 修复 Store 丢弃 `importTaskId`、`dataLayer` 查询参数的问题。
- 对齐 API 与显式 Mock 的 `excel-approval/1.0` 前端契约。
- 不修改后端批准事务、幂等、BusinessRecord、audit、ledger 或 outbox。

## 关键不变量

- 列表提示“本批记录”时，网络请求必须真实携带同一个 `importTaskId`。
- 批准快照只读，哈希可复制但不由浏览器重新生成或覆盖。
- 老板只读记录页不能进入财务确认动作。
- 过滤、清除定位和分页不能改变后端权限边界。

## 验证

- 失败复现：周五故事线收到未过滤 `/data/records`，预期红灯成立。
- 修复后周五故事线：1/1 PASS。
- Excel 导入专项：4/4 PASS。
- 完整 Playwright：21/21 PASS。
- 前端 runtime：4/4 PASS。
- 前端 production build：PASS，3,150 modules。
- E2E teardown：磁盘残留 0。

## 风险与回退

- 无 migration、无后端写契约变化；回退 UI 不影响已冻结批准事实，但会重新失去任务级可见性，因此不建议作为业务回退方案。
- GitHub 推送因外部网络阻断尚未完成；本地提交后不得借用 CR-014 的绿色状态。

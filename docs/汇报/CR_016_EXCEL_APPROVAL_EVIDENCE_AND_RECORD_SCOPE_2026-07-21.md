# CR-016 Excel 批准快照与正式记录定位报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 红灯

周五真实 API E2E 先证明：Excel 批准完成后前端跳转到未过滤的 `/data/records`，用户无法确认本批生成了哪些正式记录，也没有入口回看后端已冻结的 `excel-approval/1.0` 快照。测试期望任务级 URL 时稳定失败，实际收到全局记录页。

## 实现

- 批准完成和幂等重放统一跳转到 `/data/records?importTaskId=:taskId`。
- 记录页从 URL 读取任务 ID，并把 `importTaskId` 保留在初始加载、筛选和分页查询中；显示明确定位条，可清除定位。
- 财务可从定位条返回原确认页查看批准证据；老板只读页面不暴露财务确认入口。
- 确认页复用现有 `ImportTask.approval`，只读展示批准人、时间、记录数、review revision、快照/验证/输出/请求键哈希，并返回同一批正式记录。
- 前端为 `excel-approval/1.0` 建立受约束类型；显式 Mock 也生成同结构的合成快照，不再维护三字段平行契约。
- 审查发现 `dataCenterStore.fetchRecords` 还会丢弃既有 `dataLayer` 参数；与 `importTaskId` 一起修复，确保提示与真实后端过滤一致。

## 测试证据

| 门禁 | 结果 |
| --- | --- |
| 预期红灯 | 周五 E2E 1/1 按预期失败：实际 `/data/records`，缺任务级定位 |
| 周五故事线 | 1/1 PASS，15.7 秒；3 条记录、批准快照双向跳转、ReportSnapshot 全链路通过 |
| Excel 导入专项 | 4/4 PASS；阻断错误、分页、公式缓存双财务批准、旧 XLS 均通过 |
| 完整 Playwright | 21/21 PASS，约 1.2 分钟 |
| 前端 runtime | 4/4 PASS |
| 前端 production build | 3,150 modules，PASS |
| 完整 teardown | 1 工单、8 ImportTask、1 OCR、6 BusinessRecord、5 Profile、4 AI Task、3 Snapshot、9 文件引用；磁盘残留 0 |

## 边界

- 页面展示既有数据库事实，不重新计算批准哈希，不修改批准快照，也不允许 AI 直接写正式记录。
- `importTaskId` 仍由后端鉴权和查询 DTO 约束；前端参数不能扩大角色或项目权限。
- 本提交不证明真实模型准确率、真实财务真值、目标 Staging 或 owner UAT。
- CR-015 本地提交 `2a59509` 连续三次因无法连接 `github.com:443` 未推送；CR-016 完成本地提交后与其一起等待网络恢复，禁止 force push。

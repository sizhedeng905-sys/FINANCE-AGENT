# B8-09 小范围试运行日检表

日期：`YYYY-MM-DD`  班次：`____`  检查人：`____`  Release ID：`____`

> 只记录匿名编号、数量、比例和逐分差异。项目名、客户名、人员信息、原文件名、OCR 原文和 Token 不进入本表。

| 检查项 | 口径 | 结果 | 证据/Issue |
| --- | --- | --- | --- |
| 授权范围 | 试运行用户、项目是否仍在批准清单 | `pass/fail` | |
| 导入量 | Excel/OCR/手工/工单各任务数与成功记录数 | 数量 | |
| 导入失败率 | failed / completed；逐类列出 | 百分比 | |
| 重复候选 | 当日 warning、阻断、人工放行数量 | 数量 | |
| 金额差异 | 系统 confirmed 合计与财务人工合计逐分比较 | 分；必须 0 或 Issue | |
| OCR 自动入账 | 人工确认前 BusinessRecord 增量 | 必须 0 | |
| OCR 复核 | 低置信、缺失、修正和确认数量 | 数量 | |
| 队列 | import_parse/import_confirm/OCR/AI 深度与最老等待时间 | 数量/分钟 | |
| Worker | heartbeat、重启、lease recovery 和 exhausted 数 | `pass/fail` | |
| API | 5xx、P95 延迟、限流 429 | 数量/毫秒 | |
| 模型/GPU | 常驻模型、显存、切换、OOM、fallback | 数值 | |
| 文件安全 | ClamAV 状态、拒绝/超限/隔离数量 | 数量 | |
| 对象存储 | referenced bytes、bucket versioning、签名 URL 异常 | 数值 | |
| 数据库 | 连接数、锁等待、磁盘、水位、迁移状态 | 数值 | |
| Audit/Ledger | runtime UPDATE/DELETE 权限检查；关键动作差异 | 必须 0 | |
| 备份 | 最近成功时间、dump/object count、WAL archive | 时间/数量 | |
| 恢复演练 | 最近一次 RPO/RTO 和是否在政策周期内 | 秒 | |
| 告警 | firing/pending、送达和关闭情况 | 数量 | |
| 未关闭 Issue | P0/P1/P2/P3 数量与 owner | 数量 | |

## 当日结论

- 结论：`继续 / 限制范围 / 暂停试运行`
- 必须暂停条件：金额差异非 0 且无已批准解释、OCR 未确认入账、audit/ledger 被修改、备份过期、ClamAV fail-open、P0 安全或财务错误。
- 负责人签名：`____`
- 关联 Issue：`____`

## Issue 最小字段

`severity`、`anonymousCaseId`、`releaseId`、`module`、`expected`、`actual`、`requestId/traceId`、`reproduction`、`evidencePath`、`owner`、`rollbackDecision`。不得用聊天记录代替 Issue。

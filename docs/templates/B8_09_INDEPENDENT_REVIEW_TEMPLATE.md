# H-15 独立代码与安全 Review 模板

状态：`awaiting_input`  PR/Commit：`____`  Review 人：`____`

## Review 范围

- API/Worker 任务边界与 lease 恢复；
- Redis 全局请求共享限流、失败关闭，以及登录/上传/模型闸门的单副本约束；
- PostgreSQL TLS、账号和 audit/ledger 不可变权限；
- S3 私有桶、签名 URL、ClamAV 和文件授权；
- secret、日志、metrics、trace 和告警；
- 备份、恢复、应用/数据/模型回退；
- Docker/Compose 权限、镜像固定与网络暴露；
- 自动化、UAT 证据和 `blocked_external` 声明。

| Issue | 严重性 | 文件/边界 | 结论 | Owner | 关闭证据 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

最终结论：`approved / changes_requested / rejected`

Review 人签字：`____`  项目负责人确认：`____`

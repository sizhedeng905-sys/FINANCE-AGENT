# CR-054 Local pilot PostgreSQL loopback isolation

## 目标

确保 FINANCE-AGENT 本地试用数据库只通过回环地址提供服务，不依赖宿主机原有的全接口 PostgreSQL 监听。

## 发现

- 宿主机已有 Windows PostgreSQL 17 服务监听 `0.0.0.0:5432`。
- 该实例的 `pg_hba.conf` 只允许 `127.0.0.1/32` 和 `::1/128`，外部连接无法完成数据库认证，但监听地址本身仍不满足本轮“只绑定 127.0.0.1”的硬边界。
- 当前非提升权限会话不能安全重启 Windows 服务；没有强杀数据库进程。

## 处理

- 将宿主机 `postgresql.conf` 的 `listen_addresses` 收紧为 `127.0.0.1`，供下次正常服务重启生效。
- 启动独立 `postgres:17.10-bookworm` 试用容器，发布端口固定为 `127.0.0.1:55432`。
- 从原 `finance_agent_pilot_test` 做一致性 custom-format dump，并以 `--no-owner --no-privileges` 恢复到隔离容器。
- API 和 Worker 改为连接容器中的同名 `_test` 数据库；前端 API 地址不变。
- 数据库凭据只存在于本机运行环境和容器配置，没有写入仓库、Markdown 或日志。

## 恢复核验

- 52 条 Prisma migration 完整存在。
- confirmed/published/actual 正式记录仍为 2 条，总金额 `10045.93`。
- ReportSnapshot ID、核心哈希、2 个来源和指标保持一致。
- `report_narrative:v5`、11 个 claims 和 2 个复核决定保持一致。
- API readiness 的 database、Redis、Worker、storage、Qwen 和 Paddle 均为 `ok/healthy`。
- 财务和老板 seed 账号登录、`/auth/me`、退出及前端 HTTP 200 通过。

## 宿主机遗留项

Windows PostgreSQL 17 服务仍会保持旧监听，直到负责人以管理员权限正常重启该服务或重启系统。FINANCE-AGENT 当前运行不依赖该服务；重启后新 `listen_addresses` 会生效。不得用强制结束 PostgreSQL 进程代替正常服务重启。

## 回滚

停止 API/Worker 后，可把它们的 `DATABASE_URL` 改回已验证的本机 `_test` 数据库并重新启动。不要删除容器卷，直到确认不再需要本轮试用证据。

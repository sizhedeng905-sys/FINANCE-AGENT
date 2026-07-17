# 阶段结果：B8-09

更新日期：2026-07-17

## 1. 阶段状态

`engineering_complete / blocked_external`

工程实现、配置渲染、证书链、静态恢复门禁和现有全量回归已完成。基础服务镜像已经拉取，backup 镜像也完成本地构建；目标 Staging 的真实容器启动、关联备份恢复 RPO/RTO 和发布回退仍未通过，原因是 Node 基础镜像 metadata 请求发生 registry TLS handshake timeout。H-12 至 H-16 也未由授权人员完成。因此本阶段不声明 Staging 验收通过或生产就绪。

## 2. 已完成工作

- 增加 `PROCESS_ROLE=api|worker|all`。生产拒绝 `all`；API 只提交 PostgreSQL 持久任务，Worker 执行 Excel/OCR lease 恢复和后台处理。
- 增加 Redis 共享全局固定窗口限流、生产 fail-closed 连接、Worker 心跳和 readiness 依赖。登录、上传准入和模型并发闸门仍为进程内状态，因此本阶段 Compose 固定单 API、单 Worker。
- 增加 S3/MinIO 文件适配、私有桶健康检查、路径边界、对象 inventory 和 30-300 秒签名 URL；签发动作写 audit/ledger。
- 增加 W3C `traceparent`、JSON 日志关联、有限 OTLP 批量导出、Prometheus 请求/队列/Worker/模型/存储/trace 指标。
- 增加 18 服务 Staging Compose：TLS gateway、前端、API、Worker、migrate、PostgreSQL TLS、Redis、ClamAV、MinIO、备份、Prometheus、Alertmanager、Loki、Promtail、Tempo、Grafana 和 node-exporter。
- 数据库账号分离为 migrator/runtime/backup；运行账号只可 INSERT/SELECT `audit_logs` 和 `ledger_events`，数据库层禁止 UPDATE/DELETE/TRUNCATE。
- 增加关联 logical/base/WAL 与对象快照备份、SHA-256 manifest、临时数据库 restore drill 和带精确确认值的破坏性恢复脚本。
- 增加备份非空与 `pg_restore --list` 完整性检查、独立 backup/restore 指标、缺失指标告警及 TLS 证书 14 天到期告警。
- 增加应用 Git SHA 镜像、迁移前检查、smoke、release manifest、应用/数据/模型路由回退脚本；发布成功后另存实际模型路由快照，回退恢复目标 release 的完整启停状态。
- 网关使用内建 request id 并贯穿 API/错误日志；客户端请求体上限为 52 MiB，使恰好 50 MiB 文件加 multipart 边界可到达后端统一校验。
- 增加合成 Staging 四角色账号初始化；随机密码只存在 Docker secret，不使用仓库内 `123456` 演示密码。
- CI 新增 Staging secret/TLS 初始化、Compose JSON 安全断言和所有 shell 脚本语法检查。

## 3. 主要文件

- 运行时：`backend/src/infrastructure/redis/`、`backend/src/worker/`、`backend/src/observability/`、`backend/src/files/s3-file-storage.service.ts`、`backend/src/worker.ts`。
- 数据库：`backend/prisma/runtime-grants.sql`、`backend/src/staging-seed.ts`。
- 镜像：`backend/Dockerfile`、`Dockerfile.frontend`、`backend/docker/backend-entrypoint.sh`。
- 部署：`deploy/staging/compose.yaml` 及 `gateway/`、`postgres/`、`redis/`、`minio/`、`monitoring/`、`backup/`、`scripts/`。
- 测试：`backend/test/observability.spec.ts`、`backend/test/s3-storage.spec.ts`、`backend/test/staging-deployment.spec.ts`，并更新 config/health/http-security 测试。

## 4. 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端 production build | 通过 |
| 后端 Jest | 29/29 suites，263/263 tests |
| PostgreSQL integration | 2/2 suites，60/60 tests；正常 API→Worker 交接不增加 attempt，过期租约恢复仍增加 attempt |
| 大批量回归 | 30,196 行 17.707 秒、49,999 行 32.253 秒；RSS 增量分别 152.21/295.71 MiB，连接峰值均 10 |
| 前端 production build | 通过；3143 modules；保留既有 Ant Design chunk |
| Playwright | 16/16 tests；teardown 文件残留 0 |
| Migration 双路径 | 空库 24/24；上一基线 23→24；最终 41 表、27 enum、173 index、77 foreign key |
| Staging 初始化 | 随机 secret 与本地 CA 生成通过；生成目录被 Git 忽略 |
| Compose 配置 | 18 services；证书链、固定版本标签、仅 TLS gateway 发布端口、PostgreSQL TLS、只读应用容器和 secret 未跟踪断言通过 |
| Shell 语法 | 10/10 scripts 通过 Git Bash `bash -n` |
| 容器构建 | `blocked_external`；基础服务镜像已拉取、backup 已构建；Node build metadata 请求 TLS timeout，未执行 Compose `up` |
| 真实 restore/RPO/RTO | `blocked_external`；基础镜像不可拉取，未运行，未填写虚假结果 |

测试没有读取、修改或提交真实业务原件和模型权重；`backend/.env` 仅由本地 Prisma/Nest 工具按既有配置消费，内容未输出、未修改、未暂存。

## 5. 未解决风险

- 当前镜像锁只完成固定补丁/日期 tag 和锁定工具；共享 Staging 必须在 registry 恢复后解析 digest，并将自建镜像推入受控 registry。
- 未在目标 Linux Staging 验证 Promtail 的 Docker JSON 日志挂载、MinIO 生命周期命令、PostgreSQL WAL archive 和完整 restore drill。
- 未取得真实 RPO/RTO，备份/保留/删除周期不能由 Codex代替管理层决定。
- 当前对象桶保持 private/versioned，备份加密与正式 KMS/密钥托管方案尚未由 H-14 决定，不能据此声明静态数据已满足生产加密政策。
- 登录、上传准入和模型并发闸门不是分布式控制；若 H-13 要求 API/Worker 横向扩容，该项必须先修复并通过多实例故障测试。
- Alertmanager 当前只保留本地审查 receiver；短信、邮件或企业 IM 接收人待 H-13/H-14。
- OCR 真值、财务逐分对账、老板标准答案、跨来源重复和冲销政策仍承接 B8-08 外部门禁。
- 外部 AI Provider 仍默认关闭；是否允许外发、脱敏、地域和保留待 H-12。

## 6. 需要人工输入

| 编号 | 必须结果 | 当前状态 |
| --- | --- | --- |
| H-12 | 外部 AI 数据政策签字 | `blocked_external` |
| H-13 | 服务器、域名、registry、TLS、GPU、监控接收人和容量清单 | `blocked_external` |
| H-14 | RPO/RTO、备份/日志/原件保留、删除审批和法务留存 | `blocked_external` |
| H-15 | 独立代码与安全 Review 及意见关闭记录 | `blocked_external` |
| H-16 | 财务、业务、老板最终 UAT 结论 | `blocked_external` |

模板见 `docs/templates/B8_09_*_TEMPLATE.md`。此前 H-01 至 H-11 中未签字项仍继续有效。

## 7. 回退说明

- 应用：按 `.release/releases/<id>.json` 恢复 Git SHA 镜像，不执行 down migration。
- 数据库/文件：先停止 API/Worker，校验 backupId 与 SHA-256，再恢复 PostgreSQL 和同批对象快照；恢复后重跑 migrate/runtime grants/smoke。
- 模型：按不含 secret 的路由快照和 SHA-256 恢复；配置哈希不一致时拒绝。
- 任何数据恢复都需要事件审批，不由自动发布脚本默认触发。

## 8. 下一步

1. 修复目标主机到受控 registry 的连接，先取得固定 Node 基础镜像，再完成全部镜像 digest 锁定。
2. 在 H-13 指定的 Linux Staging 执行 `staging:release`、smoke、真实 backup/restore 和应用/模型回退。
3. 将实测 RPO/RTO、日志/指标/trace 截图和告警送达记录附到本报告。
4. 完成 H-12/H-14/H-15/H-16；仅在问题全部关闭后把 B8-09 改为通过。

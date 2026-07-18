# B8-09 Staging 与试运行运行手册

更新日期：2026-07-18

## 1. 使用边界

本手册用于隔离的 Staging 和小范围试运行，不是生产发布批准。首次运行只允许合成或经 H-09 签字的脱敏数据。以下人工门禁未完成前，不得导入真实业务原件或宣称生产就绪：

- H-12 外部 AI 数据政策；
- H-13 服务器、域名、地域、容量和 GPU 拓扑；
- H-14 RPO、RTO、保留、删除和法务留存政策；
- H-15 独立代码与安全 Review；
- H-16 最终 UAT 签字。

## 2. 拓扑

`deploy/staging/compose.yaml` 提供以下 18 个服务：

| 边界 | 服务 | 约束 |
| --- | --- | --- |
| TLS 入口 | gateway | 只绑定本机 `8443/9443`；API、前端和对象下载均经 TLS |
| 应用 | frontend、backend-api、worker、migrate | API 与 Worker 使用同一固定镜像、不同 `PROCESS_ROLE`；非 root、只读根、drop all capabilities |
| 数据 | PostgreSQL 17、Redis、MinIO | 不发布主机端口；PostgreSQL TLS；运行与迁移账号分离；桶保持私有和版本化 |
| 文件安全 | ClamAV | 私网访问；生产配置不可切回 basic；不可用时上传失败关闭 |
| 观测 | Prometheus、Alertmanager、Loki、Promtail、Tempo、Grafana、node-exporter | 指标令牌、JSON 日志、W3C trace、OTLP、错误/容量/备份告警 |
| 可靠性 | backup | PostgreSQL logical/base/WAL 与对象快照关联；恢复脚本带校验和与显式确认门 |

持久化任务事实仍在 PostgreSQL。Redis 用于全局请求共享限流、Worker 心跳和运行协调，不作为唯一任务事实源。登录、上传准入和模型并发闸门仍为进程内控制，因此本版本只允许单 API、单 Worker；横向扩容前必须完成共享化和多实例故障测试。

前端镜像必须以 `VITE_APP_DATA_MODE=api`、`VITE_API_BASE_URL=/api` 构建。缺失/非法模式、危险 URL 或非 API Staging 构建均失败；构建后 `runtime-config.json` 必须再次通过 `npm run staging:frontend:check`。浏览器 smoke 会验证实际 API 请求、后端不可用错误、CSP、合成项目写读和软归档，不以首页 HTTP 200 代替可用性证明。中断后脚本会尽力软归档已创建项目；失败时输出项目 ID，要求人工处理。

## 3. 首次初始化

前置要求：Node.js 22+、Docker Compose v2、OpenSSL 3、Git。不要把 `.secrets`、`.runtime`、`.release` 或 `.evidence` 提交到 Git。

```bash
npm run staging:init
npm run staging:check
```

初始化脚本只创建缺失文件，不覆盖已有 secret。它会生成：

- 随机数据库、JWT、Redis、MinIO、S3、Metrics、Grafana 和合成 UAT 密码；
- Staging CA、网关证书和 PostgreSQL 证书；
- 三个不同数据库账号的 TLS URL；
- 本机忽略的初始化元数据。

本地浏览器联调时，把下列名称指向 `127.0.0.1`：

```text
staging.finance-agent.local
objects.finance-agent.local
```

正式 Staging 必须由 H-13 提供真实域名和受信任证书，不沿用本地 CA。

## 4. 镜像和供应链

`.env.example` 固定每个第三方镜像的补丁版或发布日期，不允许 `latest`。发布后运行：

```bash
npm run staging:lock-images
```

该命令把 registry digest 或本地 image ID 写入被忽略的 `.release/images.lock.json`。存在无法解析的镜像时退出非零，不得把未解析状态写成通过。发布到共享服务器前应将自建镜像推到受控 registry，并用 `repository@sha256:...` 再部署。

## 5. 发布

发布脚本要求已跟踪工作树干净，并按 Git SHA 标记前端、后端和备份镜像：

```bash
npm run staging:release
```

脚本顺序：

1. 重新运行配置、证书、私网和 secret 门禁；
2. 若旧环境在线，先导出模型路由快照并创建关联备份；
3. 构建固定镜像；
4. 执行 `prisma migrate deploy`；
5. 应用运行账号权限，数据库层禁止其更新/删除 `audit_logs` 与 `ledger_events`；
6. 只在 `finance_agent_staging` 创建四个随机密码合成 UAT 账号；
7. 启动 API、Worker、存储、安全和观测服务；
8. 运行 TLS、readiness、四角色登录、错误登录和 Metrics smoke；
9. 运行真实浏览器 API/CSP smoke，并清理合成写入；
10. 运行真实 logical restore drill；
11. 写入不含 secret 的 release manifest。

`migrate` 使用 `finance_migrator`；API/Worker 使用 `finance_runtime`；备份使用只读且具备 replication 权限的 `finance_backup`。三者不得复用密码。

## 6. 健康与观测

```text
GET /api/health/live   只检查进程
GET /api/health/ready  检查 PostgreSQL、对象存储、ClamAV、队列、模型、Redis 和 Worker 心跳
GET /api/metrics       仅接受独立 Bearer Metrics token
```

浏览入口：

```text
https://staging.finance-agent.local:8443/
https://staging.finance-agent.local:8443/ops/grafana/
```

请求日志不记录 query、Cookie、Token 或请求正文；日志包含 `requestId` 和 `traceId`。`traceparent` 经网关继续传递，API 将有限队列中的 span 批量导出到 Tempo。导出失败不阻断财务请求，但 dropped/error 指标触发告警。

2026-07-18 R1 本机隔离验收使用覆写主机端口启动全部 18 服务，Node smoke 与真实 Edge 浏览器 smoke 均通过；前端确认 `api + /api`，CSP 的内联脚本、外部连接和外部 frame 探针被阻断。验收后已删除该 Compose project 的容器与卷。该结果只证明本机工程链路，不替代 H13/H14 指定 Linux 环境中的 restore、RPO/RTO 或 rollback。

必须处理的默认告警：API 不可用、Worker 心跳缺失、5xx、队列积压、trace 丢弃、进程内存、逻辑存储容量、备份失败/过期和恢复演练过期。Alertmanager 外部接收人由 H-13/H-14 决定。

## 7. 文件与对象存储

- `finance-agent-raw` 与 `finance-agent-backups` 均为 private bucket；
- 原始桶和备份桶启用 versioning；
- private/versioning 不等同于静态加密验收；正式 SSE/KMS、密钥轮换和备份加密策略由 H-14 批准并在目标环境留证；
- 运行账号只能访问原始桶，不可读备份桶；
- 未完成 multipart 上传在 7 天后清理；业务对象不设置自动过期，等待 H-14；
- `GET /api/files/:id/signed-download` 先做 JWT 资源授权，再签发默认 60 秒 attachment URL，并写 audit/ledger；
- 原有后端流式 preview/download 继续可用；
- ClamAV 不可用、S3 不可用或可用容量低于门槛时，上传失败关闭。

## 8. 备份与恢复

备份容器默认每 6 小时执行一次：

```bash
docker compose --env-file .env -f deploy/staging/compose.yaml exec -T backup /opt/staging/run-backup.sh
```

每次备份包含 PostgreSQL custom dump、迁移时间、对象 inventory、对象桶快照和带 SHA-256 的 manifest；空 dump 或无法通过 `pg_restore --list` 的 dump 会失败关闭。每天至少生成一次 `pg_basebackup`，PostgreSQL 同时归档 WAL。业务对象自动删除期限和静态加密仍由 H-14 决定。

非破坏性恢复演练：

```bash
docker compose --env-file .env -f deploy/staging/compose.yaml exec -T backup /opt/staging/restore-drill.sh
```

演练在临时数据库恢复并核对表数、audit、ledger、RawFile、dump 哈希和对象快照数量，随后删除临时数据库。证据保存在 backup volume 的 `drills/`，Prometheus 记录实测 RPO/RTO。没有真实输出时不得填写“通过”。

## 9. 回退

应用回退：

```bash
npm run staging:rollback -- deploy/staging/.release/releases/<release>.json
```

该操作先备份，再按旧 manifest 恢复前端、API、Worker 镜像和模型路由状态；数据库采用向前兼容迁移，不执行 down migration。

只有数据损坏或错误迁移且已完成事件审批时，才允许数据恢复：

```bash
npm run staging:rollback -- deploy/staging/.release/releases/<release>.json --restore-data <backupId>
```

数据恢复会停止 API/Worker，要求精确的 `finance_agent_staging/<backupId>` 确认值，校验 dump SHA-256，恢复数据库与对象快照，再重跑 migrate/grants 和 smoke。禁止对生产库或未核对 backupId 使用该命令。

模型回退使用不含 endpoint/secret 的 route snapshot，恢复时必须同时提供快照 SHA-256；配置哈希变化会拒绝恢复。GPU 按需模型仍可使用：

```bash
npm run model:restore
```

## 10. 小范围试运行

- 仅创建少量授权用户和项目；admin/auditor 不开放业务前端；
- OCR 必须停在 `pending_confirm`，人工确认前 `BusinessRecord` 增量必须为 0；
- 每日按 `docs/B8_09_PILOT_DAILY_CHECKLIST.md` 核对导入、失败、重复候选、逐分差异、队列、GPU、存储、备份和告警；
- 所有问题进入 GitHub Issue，记录匿名 caseId、releaseId、requestId/traceId 和证据路径，不把聊天记录当缺陷台账；
- 真实数据只允许由授权人员小批量导入，且必须有 H-09/H-16 证据。

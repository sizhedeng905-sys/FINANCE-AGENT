# B8-09 Staging 与试运行运行手册

更新日期：2026-07-22

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
| 观测 | Prometheus、Alertmanager、Loki、Alloy、Tempo、Grafana、node-exporter | 指标令牌、JSON 日志、W3C trace、OTLP、错误/容量/备份告警；Alloy 只读日志文件且不挂载 Docker socket |
| 可靠性 | backup | PostgreSQL logical/base/WAL 与对象快照关联；恢复脚本带校验和与显式确认门 |

持久化任务事实仍在 PostgreSQL。Redis 用于全局请求/登录限流、上传准入、模型 FIFO 执行门、Worker 心跳和运行协调，不作为唯一任务事实源。上传与模型活跃槽位只保存短租约运行状态，业务文件/任务事实仍在 PostgreSQL/对象存储。R9.3 已完成本地双实例共享化与故障测试，但本版本 Compose 继续只允许单 API、单 Worker；横向扩容前必须在 H13/H14 目标环境完成多实例 release、恢复与回退。

前端镜像必须以 `VITE_APP_DATA_MODE=api`、`VITE_API_BASE_URL=/api` 构建。缺失/非法模式、危险 URL 或非 API Staging 构建均失败；构建后 `runtime-config.json` 必须再次通过 `npm run staging:frontend:check`。浏览器 smoke 会验证实际 API 请求、后端不可用错误、CSP、合成项目写读和软归档，不以首页 HTTP 200 代替可用性证明。中断后脚本会尽力软归档已创建项目；失败时输出项目 ID，要求人工处理。

## 3. 首次初始化

前置要求：Node.js 22+、Docker Compose v2、OpenSSL 3、Git。不要把 `.secrets`、`.runtime`、`.release` 或 `.evidence` 提交到 Git。

```bash
npm run staging:init
npm run staging:check
```

`deploy/staging/.env.example` 现在明确区分本机演示参数与后续目标环境参数。默认值仍是原有 `local_demo`，因此既有周五演示入口不变。以下变量必须作为一个一致配置集修改，`staging:check` 会拒绝域名、URL、端口或证书不匹配：

| 边界 | 变量 | 本机默认 |
| --- | --- | --- |
| 部署身份 | `STAGING_DEPLOYMENT_PROFILE`、`STAGING_ENVIRONMENT_ID` | `local_demo`、`finance-agent-staging-local` |
| 应用入口 | `STAGING_APP_DOMAIN`、`STAGING_APP_BASE_URL`、`STAGING_WEB_PORT` | `staging.finance-agent.local`、`https://staging.finance-agent.local:8443`、`8443` |
| 对象入口 | `STAGING_OBJECT_DOMAIN`、`STAGING_OBJECT_BASE_URL`、`STAGING_OBJECT_PORT` | `objects.finance-agent.local`、`https://objects.finance-agent.local:9443`、`9443` |
| Web 安全 | `STAGING_CORS_ORIGINS`、`STAGING_TRUSTED_PROXY_CIDRS` | 仅本机演示 origin、固定 Compose gateway |
| 网关 | `STAGING_GATEWAY_BIND_ADDRESS`、`STAGING_GATEWAY_PROBE_ADDRESS`、`STAGING_GATEWAY_INTERNAL_IP` | loopback bind/probe、固定私网地址 |
| 证书 | `STAGING_CERTIFICATE_MODE` | `local_ca`；`provided` 只读取运维提供的 TLS 文件 |
| 镜像 | `STAGING_REGISTRY_PREFIX`、各 `*_IMAGE`、`IMAGE_IDENTITY_POLICY` | 本机 `finance-agent`、`local_identity` |
| 合成数据 | `STAGING_SYNTHETIC_SEED_ENABLED` | `true`，仅供本机演示 |

`STAGING_APP_BASE_URL` 必须出现在 CORS 白名单中，应用和对象 URL 必须与各自域名、端口完全一致。registry 前缀只接受不带 tag/digest 的小写 OCI 路径。`provided` 模式不会生成或覆盖证书；缺少 CA、gateway 或 PostgreSQL TLS 文件时初始化立即失败。这里完成的是参数化底座，不代表目标环境已经通过：目标 profile 的更严格失败关闭门禁、真实 DNS/TLS/registry/secret 和预检证据仍受 H13/H14 约束。

### 3.1 Target profile 失败关闭契约

`staging:init` 只服务 `local_demo`。目标环境的 `.env`、secret 和证书必须由运维在仓库外供应，不能用初始化脚本生成。准备好非敏感配置和本机私有材料挂载后执行：

```bash
npm run staging:target:check
```

target 还必须显式提供以下非 secret 元数据；证据只保存其存在性或 SHA-256，不输出原值：

| 变量 | 含义 |
| --- | --- |
| `STAGING_TARGET_REGION` | 经 H13 确认的地域/机房标识 |
| `STAGING_TARGET_OWNER_ID` | 运维责任主体稳定标识，不写个人联系方式 |
| `STAGING_TARGET_CHANGE_ID` | 本次受控变更或部署单号 |
| `STAGING_TARGET_SECRET_PROVIDER` | `docker_secret_files`、`vault` 或受支持云 secret manager 类别 |
| `STAGING_TARGET_CERTIFICATE_ISSUER` | 已批准证书签发体系的稳定标识 |

命令在下列任一条件出现时退出码为 `2`，输出 `status=blocked_external` 和稳定错误码：本地/测试/示例域名、本地环境 ID、loopback-only bind、全网 trusted proxy、`local_ca`、本机初始化痕迹、合成 seed、`local_identity`、非远程 registry、任一服务镜像不是 `@sha256`、证书文件缺失或 target 元数据缺失/仍是占位符。`staging:check` 在 profile 为 `target` 时也执行同一契约，发布脚本无法绕过。

本机默认运行该命令会得到 `TARGET_PROFILE_REQUIRED`，这是预期的失败关闭，不是目标环境已经存在。通过该静态契约也只表示配置具备预检资格；DNS/TLS 公信链、网络、registry 签名、依赖服务、告警与灾备仍由后续只读预检和 H13/H14 验证。

### 3.2 只读目标环境预检

target 静态契约通过后，执行以下命令。该命令不启动/停止容器、不迁移数据库、不上传文件、不发送告警、不执行备份或恢复：

```bash
npm run staging:preflight
```

### Secret inventory 与轮换

`deploy/staging/secret-policy.json` 是不含值的工程策略清单，固定 20 个 Compose file-secret、13 个轮换组、消费服务、消费重启顺序和影响代码。它的 `engineering_default_pending_h14` 状态表示 90 天默认年龄（合成 seed 为 30 天）只是上线前工程门禁，不替代 H14 批准的正式轮换/保留政策。执行：

```bash
npm run staging:secret:inventory
```

检查器只对固定 `.secrets/<name>` 执行 `lstat`，不读取内容，也不把绝对路径、字节数、mtime、mode 或内容哈希写进证据。它拒绝缺失、空/超限、未来时间、符号链接、非普通文件；Linux target 还拒绝 group/world 权限和硬链接。`fresh`、`due_soon`、`stale` 由文件 mtime 计算，明确只是工程信号，不证明 Vault/KMS/云 Secret Manager 中的真实版本已轮换。`stale` 或非法文件阻断 `staging:check`；target 缺少挂载时独立 inventory 命令返回 `blocked_external`。

真实轮换不得直接运行仓库脚本改值。由已批准的 secret provider 在仓库外生成新 generation，并按 `secret-policy.json` 的 rotation set 整组处理，尤其不能把 `*_password` 与派生 `*_database_url`/`redis_url` 分开轮换。统一顺序为：

1. 预检当前 inventory、备份/恢复状态、目标权限和受影响服务；记录不含值的 generation ID 与幂等键；
2. 在 provider 中暂存整组新版本，保持旧版本可回退；
3. 先让 PostgreSQL/Redis/MinIO 等凭据提供方接受新版本，再更新对应 file-secret generation；不支持双版本的组必须进入明确维护窗口；
4. 严格按 `consumerOrder` 重载/重启消费者，执行 readiness、最小 smoke、备份或告警合成检查；
5. 只有全部验证通过后才撤销旧版本；`revoke_old` 是不可逆回滚边界；
6. 撤销前失败时恢复旧 generation、重启相同消费者并验证，状态记为 `ROLLED_BACK`；撤销后失败禁止冒充回滚，进入 `FORWARD_FIX_REQUIRED` 并用新 generation 前向修复；
7. `jwt-signing` 会使现有 HS256 会话失效，必须提前安排重新登录；`staging-seed` 仅用于 local demo，target 必须继续禁用合成 seed。

`npm run staging:secret:test` 用纯合成 metadata 和 generation ID 验证顺序、optimistic version、幂等重放、撤销前回滚及撤销后前向修复。它不生成、读取、替换或撤销任何真实 secret，也不声称真实 provider 轮换通过。

预检需要由 H13/H14 提供以下目标连接元数据；值保留在未跟踪的目标 `.env`，JSON/Markdown 证据只保留计数、状态、稳定错误码和哈希：

| 边界 | 必需变量 |
| --- | --- |
| PostgreSQL | `STAGING_TARGET_POSTGRES_HOST`、`STAGING_TARGET_POSTGRES_PORT`、`STAGING_TARGET_POSTGRES_SERVER_NAME` |
| Redis | `STAGING_TARGET_REDIS_HOST`、`STAGING_TARGET_REDIS_PORT`；ACL 模式可加 `STAGING_TARGET_REDIS_USERNAME` |
| S3 | `STAGING_TARGET_S3_HEALTH_URL`，仅 HTTPS、不得带凭据/query/fragment |
| ClamAV | `STAGING_TARGET_CLAMAV_HOST`、`STAGING_TARGET_CLAMAV_PORT` |
| 异地备份 | `STAGING_TARGET_BACKUP_DESTINATION_ID`、`STAGING_TARGET_BACKUP_HEALTH_URL`；完整声明见第 8 节 |
| 告警 | `STAGING_TARGET_ALERT_ROUTE_ID`、`STAGING_TARGET_ALERT_HEALTH_URL` |

资源默认门槛为 4 CPU、12 GiB RAM、48 GiB 可用磁盘、TLS 至少剩余 14 天、单探针 5 秒；可用 `STAGING_TARGET_MIN_CPU_COUNT`、`STAGING_TARGET_MIN_MEMORY_GIB`、`STAGING_TARGET_MIN_DISK_GIB`、`STAGING_TARGET_TLS_MIN_VALID_DAYS` 和 `STAGING_TARGET_PROBE_TIMEOUT_MS` 显式收紧或按 H13 结果调整。非法值失败关闭。

机器清单固定覆盖 Linux、Docker Server、Compose、系统 NTP 同步、CPU/RAM/磁盘、应用/对象 DNS、两个公开端口、TLS 链/主机名/到期、registry v2、PostgreSQL TLS 协商、Redis `AUTH` + `PING`、S3 health、ClamAV `PING`、备份 health 和告警 health。PostgreSQL 项只证明网络与 TLS 协商，不宣称 SQL 权限或业务查询通过；S3/备份/告警项只证明 HTTPS health 状态，不代替后续签名、加密、真实告警送达或恢复演练。

证据写入 Git 忽略的 `deploy/staging/.evidence/target-preflight-*.json` 与 `.md`。结果语义：`passed` 表示本次只读机器检查全绿；`failed` 表示已提供目标的某项检查失败；`blocked_external` 表示仍缺 target profile 或外部配置。无论哪种状态，都不等于部署批准、生产就绪、UAT 或 H13-H16 签字。

### 3.3 告警接收与合成交付

`local_demo` 固定使用 `./monitoring/alertmanager.yml`，receiver 不配置任何外发渠道。初始化脚本只创建内容为本机禁用标记的 `alert_webhook_url` 占位文件；本机配置不会读取它。`staging:check` 会拒绝 local profile 改用 webhook 配置，也会拒绝 target profile 继续使用本机空接收器。

target 必须同时满足：

- `STAGING_ALERTMANAGER_CONFIG_FILE=./monitoring/alertmanager-webhook.yml`；
- 由已批准的 secret provider 在 `deploy/staging/.secrets/alert_webhook_url` 挂载一个 HTTPS webhook URL；
- URL 不进入 `.env`、Git、命令参数、应用日志或提交证据；
- Alertmanager 使用原生 `url_file` 读取 secret，并启用 `send_resolved`。

普通合成测试只启动本机回环 receiver，不访问外部网络：

```bash
npm run staging:alert:test
```

对真实 target 接收端发送一次 firing 和一次 resolved 必须是受控人工动作。命令要求 target profile 已通过、私密 URL 文件存在，并同时提供一次性环境授权和确认参数：

```bash
STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED=true npm run staging:alert:synthetic -- --confirm-target-alert-delivery
```

PowerShell 使用：

```powershell
$env:STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED = 'true'
npm run staging:alert:synthetic -- --confirm-target-alert-delivery
Remove-Item Env:STAGING_ALERT_SYNTHETIC_DELIVERY_APPROVED
```

缺少任一授权、仍是 local profile、URL 文件缺失/非法或发送失败时，命令在发出后续请求前失败关闭；`blocked_external` 使用退出码 2。证据只写入忽略目录 `.evidence/alert-synthetic-*.json`，保存 route/endpoint/payload 哈希、阶段、HTTP 状态和重试次数，不保存 URL、provider 响应正文或业务数据。若 firing 成功但 resolved 失败，证据保留已成功阶段并明确标记失败阶段，必须人工检查接收渠道。

该合成命令直接验证接收 webhook 的 firing/resolved 契约，不替代 Prometheus 规则触发、Alertmanager 分组/抑制、值班人实际收件和关闭响应的目标演练。真实接收人、升级顺序、渠道 SLA 和留存仍受 H13/H14/H15 约束；没有真实接收端证据时保持 `BLOCKED_EXTERNAL`。

初始化脚本只创建缺失文件，不覆盖已有 secret。它会生成：

- 随机数据库、JWT、Redis、MinIO、S3、Metrics、Grafana 和合成 UAT 密码；
- Staging CA、网关证书和 PostgreSQL 证书；
- 三个不同数据库账号的 TLS URL；
- 本机忽略的初始化元数据。

R5 收紧了镜像策略。已有 `deploy/staging/.env` 不会被初始化脚本覆盖；若它仍引用旧供应商镜像或无 digest 的第三方镜像，`staging:check` 会失败关闭。只同步 `.env.example` 中非敏感的镜像变量，不要覆盖现有 secret、URL 或人工环境配置。

本地浏览器联调时，把下列名称指向 `127.0.0.1`：

```text
staging.finance-agent.local
objects.finance-agent.local
```

正式 Staging 必须由 H-13 提供真实域名和受信任证书，使用 `provided`，不沿用本地 CA。

## 4. 镜像和供应链

`.env.example`、Compose 和 Dockerfile 将第三方运行镜像及构建输入固定到 `sha256`，不允许 `latest` 或仅凭 tag 通过配置门禁。PostgreSQL、MinIO、Prometheus、Alertmanager、node-exporter、Alloy 和 Tempo 使用仓库中的固定源码/包版本 Dockerfile 构建。

单独检查当前本机所有 Compose/模型/扫描镜像身份时运行：

```bash
npm run staging:lock-images
```

该命令生成自校验的 `staging-image-lock/2.0`，记录 registry digest、本地 image ID、平台、OCI revision 和使用位置。存在无法解析镜像、`latest`、tag 漂移或 revision 不一致时退出非零，不得把未解析状态写成通过。

`npm run staging:image-integrity:test` 运行 17 个合成攻击用例。完整 release 会为每个锁定镜像生成 SPDX SBOM、Grype SARIF 和 Critical 修复门禁，并在部署前生成 `staging-release-plan/2.0`。本机证据使用 `local_identity`，只在同一 Docker 主机有效。发布到共享服务器前必须由 H13 指定受控 registry、签名身份和信任根，使用 `repository@sha256:...` 与已验证签名；当前 `pending_h13` 不得视为签名通过。

target 的只读 registry 签名门禁使用现有 image lock/scan 链，不上传、复制、签名或删除镜像。目标环境必须把所有实际部署服务镜像镜像化到 `STAGING_REGISTRY_PREFIX` 下并使用 `repository@sha256:...`，在未跟踪的 `.secrets/cosign.pub` 提供经 H13 批准的 Cosign 公钥，并显式设置：

```text
STAGING_TARGET_SIGNATURE_POLICY=cosign_key_slsa_v1
STAGING_TARGET_REGISTRY_AUTH_MODE=docker_config|credential_helper|workload_identity
```

准备完成后执行：

```bash
npm run staging:signature:check
```

命令逐个执行只读 `cosign verify` 与 `cosign verify-attestation --type slsaprovenance`，然后由程序再次核对签名 claim 和 attestation subject 均绑定目标 digest。输出只保留 registry/key/version/repository/output 哈希、digest、计数和状态，不保存 registry credential、签名正文、attestation 正文或 Cosign stderr。缺 target、受控 registry 镜像、公钥、认证模式或 Cosign 二进制时返回 `blocked_external`/退出码 2；签名、仓库、digest 或 SLSA subject 不匹配时返回 `failed`/退出码 1。

`signed_registry` 的 supply-chain scan 复用同一 verifier，原先未经机器证据写入的 `operator_verified_h13` 已移除。Cosign 2xx/读取成功只证明本次 registry 读取和指定 key/claim 验证，不代表推送权限、密钥托管、审批流程或生产发布获批。第三方镜像若未镜像化并纳入同一受控签名政策，门禁保持阻断；本工具不会自动上传或重新签名。

2026-07-18 本机完整门禁扫描 22 个镜像、生成 66 份证据并通过“无可修复 Critical”。扫描仍有 53 High、88 Medium、38 Low，必须继续升级和评估；详情见 `docs/汇报/R5_IMMUTABLE_IMAGE_ROLLBACK_REPORT_2026-07-18.md`。

## 5. 发布

发布脚本要求已跟踪工作树干净，并按 Git SHA 标记全部仓库自建镜像。镜像路径来自 `STAGING_REGISTRY_PREFIX`，不再硬编码本机仓库前缀：

```bash
npm run staging:release
```

脚本顺序：

1. 使用候选镜像变量重新运行配置、证书、私网、digest 和 secret 门禁，并保存配置证据；
2. 若旧环境在线，先导出模型路由快照并创建关联备份；
3. 拉取固定第三方镜像，带 SBOM/provenance 请求构建全部仓库自建镜像；
4. 生成镜像锁，验证配置引用，为全部锁定镜像生成 SBOM/扫描证据；
5. 冻结完整 migration ledger 和部署前 release plan；任何门禁失败时尚未启动候选服务；
6. 使用锁内环境和 `--no-build --pull never` 启动 API、Worker、存储、安全和观测服务；`migrate` 执行 `prisma migrate deploy`、运行账号授权和合成 Staging seed；
7. 复核运行容器 image ID 与数据库完整 migration 集合；
8. 运行 TLS、readiness、四角色登录、错误登录和 Metrics smoke；
9. 运行真实浏览器 API/CSP smoke，并清理合成写入；
10. 运行关联 logical/object restore drill；
11. 写入不含 secret 的自校验 release manifest、当前镜像锁和 runtime image 环境。

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

网关 access log 只记录 `method`、不含 query 的 `$uri`、状态、上游状态、响应字节、总/上游耗时、`requestId`、`traceId` 和当前客户端 IP；禁止 `$request`、`$request_uri`、`$args`、Authorization、Cookie 和请求正文。标准 Nginx request error 可能回显原始 request line，因此 HTTP server 的请求级 error log 被关闭，启动/配置错误仍写全局 stderr；排障使用安全 access log 的 `upstream_status` 和关联 ID。客户端 IP 的正式脱敏与保留期限等待 H09/H14。

应用请求/500 日志同样只记录无 query path 和必要元数据，不记录 headers/body/异常消息；trace 只保存规范化 path。前端当前没有自动错误上报通道，只展示服务端安全消息与 requestId。不得在 Issue、截图或聊天中粘贴完整预签名 URL；确有业务 query 排障需求时只能新增经审查的 allowlist/哈希字段。

2026-07-18 R1 本机隔离验收使用覆写主机端口启动全部 18 服务，Node smoke 与真实 Edge 浏览器 smoke 均通过；前端确认 `api + /api`，CSP 的内联脚本、外部连接和外部 frame 探针被阻断。验收后已删除该 Compose project 的容器与卷。该结果只证明本机工程链路，不替代 H13/H14 指定 Linux 环境中的 restore、RPO/RTO 或 rollback。

2026-07-18 R2 使用独立 Compose project 生成带合成 X-Amz、普通 query、Authorization、Cookie 和编码换行的 API 200、对象 400、API 中断 503 请求。29 条网关 JSON 均可解析，15 个合成敏感标记泄露为 0，伪造日志行 0；API 恢复健康后删除全部测试容器与卷。

2026-07-18 R3 删除了固定 `S3_CAPACITY_BYTES` 物理容量伪装。应用容量指标标注 `logical_quota`/`volume_metric`/`provider_metric`/`estimated_usage`/`unknown`，S3 连通只表示 `probeOk`。Prometheus 另从私网 `/minio/metrics/v3/cluster/health` 采集物理 usable free/total；对象网关对外阻断 metrics 路径。Grafana dashboard 为 `Finance Agent Storage Capacity`。

必须处理的默认告警：API 不可用、Worker 心跳缺失、5xx、队列积压、trace 丢弃、进程内存、逻辑存储容量、MinIO 物理容量/指标缺失、备份失败/过期、对象强哈希覆盖缺失、对象元数据摘要不一致和恢复演练过期。当前逻辑使用率 80% 与物理可用 30% 是 H13/H14 签字前的保守 Staging 默认；正式阈值和 Alertmanager 接收人由 H-13/H-14 决定。

## 7. 文件与对象存储

- `finance-agent-raw` 与 `finance-agent-backups` 均为 private bucket；
- 原始桶和备份桶启用 versioning；
- private/versioning 不等同于静态加密验收；正式 SSE/KMS、密钥轮换和备份加密策略由 H-14 批准并在目标环境留证；
- 运行账号只能访问原始桶，不可读备份桶；
- 未完成 multipart 上传在 7 天后清理；业务对象不设置自动过期，等待 H-14；
- `GET /api/files/:id/signed-download` 先做 JWT 资源授权，再签发默认 60 秒 attachment URL，并写 audit/ledger；
- 原有后端流式 preview/download 继续可用；
- 使用 S3 时必须显式配置 `S3_LOGICAL_QUOTA_BYTES`；旧 `S3_CAPACITY_BYTES` 会启动失败，因为它不能代表物理容量；
- readiness 返回 backend、probe、capacity source、可信 total/used/available、新鲜度、限制和 upload admission reason；
- 逻辑已用量来自未作废 `raw_files.file_size`，最终上传事务获取全局 advisory lock 后重新计算；不使用进程内容量计数，也不逐次扫描全桶；
- 逻辑用量不包含尚未提交或待处置孤儿对象，必须同时观察 MinIO 物理指标并运行对象完整性/恢复门禁；
- ClamAV/S3 不可用，容量未知/过期/矛盾，单文件超过可用量或会侵占保留水位时，上传失败关闭；
- `50301` 表示容量无法可信验证，`50701` 表示文件或保留水位超限，具体稳定原因在 `data.reason`。

## 8. 备份与恢复

备份容器默认每 6 小时执行一次：

```bash
docker compose --env-file .env -f deploy/staging/compose.yaml exec -T backup /opt/staging/run-backup.sh
```

每次备份生成 `backup-manifest/1.0`，包含 PostgreSQL custom dump、规范化 schema、完整 migration ledger、活动 `raw_files` 引用、源对象清单、备份对象清单和 manifest 自身 SHA-256 sidecar。对象清单以 Base64 保存 key，并记录 size、ETag、version ID、metadata、encryption/retention 状态和流式计算的内容 SHA-256；ETag 明确不作为强哈希。数据库引用在 dump 前后和对象快照后必须保持一致，任一活动引用缺失、size/hash 不符或对象在复制期间变化都会使本次备份失败并进入 `failed/` 隔离目录。旧版只有对象数量的清单会报告未验证对象数并拒绝恢复，不会伪造强哈希覆盖。

每天至少生成一次 `pg_basebackup`，PostgreSQL 同时归档 WAL。正式 SSE/KMS、不可变异地副本、保留和删除期限仍由 H13/H14 决定；private bucket、versioning 和本机 backup volume 不能替代这些审批。

### 8.1 异地备份声明与计时证据

本地 profile 固定 `STAGING_OFFSITE_BACKUP_MODE=disabled`。target 必须显式改为 `contract_only` 并提供以下非 secret 元数据，缺失或占位值会使 `staging:check` 失败关闭：

| 类别 | 变量 |
| --- | --- |
| Provider/位置 | `STAGING_TARGET_BACKUP_PROVIDER_CLASS`、`STAGING_TARGET_BACKUP_DESTINATION_ID`、`STAGING_TARGET_BACKUP_OFFSITE_REGION`、`STAGING_TARGET_BACKUP_FAILURE_DOMAIN_ID` |
| 加密 | `STAGING_TARGET_BACKUP_ENCRYPTION_MODE=sse_kms|client_side_envelope`、`STAGING_TARGET_BACKUP_KMS_KEY_ID` |
| 不可变/复制 | `STAGING_TARGET_BACKUP_IMMUTABILITY_MODE`、`STAGING_TARGET_BACKUP_REPLICATION_MODE`、`STAGING_TARGET_BACKUP_VERSIONING=true`、`STAGING_TARGET_BACKUP_RETENTION_POLICY_ID` |
| 目标 | `STAGING_TARGET_BACKUP_RPO_SECONDS`、`STAGING_TARGET_BACKUP_RTO_SECONDS` |

异地区域必须不同于 `STAGING_TARGET_REGION`，故障域 ID 不能等于当前环境、区域或 destination。目标值和 retention policy 仍需 H14 定稿；配置通过只得到 `declared_unverified`，不会把字符串声明当成 provider 加密、Object Lock 或真实恢复证据。契约检查命令为：

```bash
npm run staging:offsite-backup:contract
```

在 `local_demo` 中它返回 `disabled_local_demo`；target 即使声明完整，也会以 `OFFSITE_BACKUP_REAL_REPLICATION_AND_RESTORE_EVIDENCE_REQUIRED`/退出码 2 保持阻断，直到具备真实 provider、强哈希副本和隔离恢复证据。

`staging-offsite-replication-evidence/1.0` 只接受同一个 `backup-manifest/1.0` SHA-256、完全相等的对象数量/字节数、与契约一致的 KMS 标识哈希、版本化和不可变声明。`staging-recovery-timing-evidence/1.0` 使用 `recoverablePointAt <= failureDetectedAt <= recoveryStartedAt <= verificationCompletedAt` 计算：

- RPO = failure detected - latest verified recoverable point；
- RTO = restore verification complete - failure detected。

两个 schema 只允许 `synthetic` 或 `target_isolated`，状态始终保留 `pending_h14_h15`；不接受 `target_live`，也不把“低于尚未批准的声明值”写成正式达标。`npm run staging:offsite-backup:test` 通过纯合成对象验证部分复制、manifest/count/bytes、KMS、不可变/版本化、时序、RPO 和 RTO 故障，不发起网络请求或写远端对象。

非破坏性恢复演练：

```bash
docker compose --env-file .env -f deploy/staging/compose.yaml exec -T backup /opt/staging/restore-drill.sh
```

演练为每次执行创建唯一 `_test` 临时数据库和唯一临时桶，恢复后核对 dump、schema、migration、对象 key/size/流式 SHA-256、活动 `raw_files` 引用和应用读取，再删除临时资源。演练同时断言同数量错 key、同 key 错大小、同大小错内容、缺失、额外对象、migration 篡改和数据库悬空引用均被拒绝。证据保存在 backup volume 的 `drills/`，Prometheus 记录实测 RPO/RTO 和强哈希覆盖；本机合成 RPO/RTO 只作测量，H14 未批准前不得写成正式达标。

备份镜像的无外部依赖故障注入可单独执行：

```bash
npm run staging:backup-integrity:test
```

## 9. 回退

应用回退：

```bash
npm run staging:rollback -- .release/releases/<release>.json
```

manifest 路径相对 `deploy/staging`。该操作先验证 manifest/计划/镜像锁/供应链/配置/migration 的哈希与身份，再创建关联备份，按锁恢复全部 18 服务使用的镜像和模型路由状态；启动后复核实际容器 image ID。数据库采用向前兼容迁移，不执行 down migration。

只有数据损坏或错误迁移，且 H13/H14 对本次目标、backupId、变更单和时间窗给出一次性批准时，才允许数据恢复。先从模板创建 Git 忽略目录中的授权 JSON，保持仓库内示例的 `h13Approved/h14Approved=false`，获得真实审批后再由授权人填写：

```text
deploy/staging/backup/restore-authorization.example.json
```

执行时显式提供该文件：

```bash
export RESTORE_AUTHORIZATION_FILE=/secure/path/restore-authorization.json
npm run staging:rollback -- .release/releases/<release>.json --restore-data <backupId>
```

数据恢复会停止 API/Worker，先在临时数据库和临时桶完成与演练相同的全量校验，再对当前 live 数据建立数据库与对象补偿快照。授权文件必须绑定 `finance-agent-staging`、`finance_agent_staging`、`finance-agent-raw`、backupId、24 小时内到期时间、唯一 nonce 和 H13/H14 审批号；同一文件只能使用一次。通过后才按“对象切换 → 数据库单事务恢复 → 全量复核 → audit/ledger”执行；中途失败自动尝试恢复补偿快照并保留证据。

PostgreSQL 与 S3 不支持跨系统原子事务，因此这只是应用停写条件下的分阶段切换与补偿，不得描述为原子恢复。补偿副本、正式备份、加密、异地和删除策略等待 H14；未取得授权时脚本失败关闭，禁止通过修改确认逻辑绕过。

模型回退使用不含 endpoint/secret 的 route snapshot，恢复时必须同时提供快照 SHA-256；配置哈希变化会拒绝恢复。GPU 按需模型仍可使用：

```bash
npm run model:restore
```

## 10. 小范围试运行

- 仅创建少量授权用户和项目；admin/auditor 不开放业务前端；
- OCR 必须停在 `pending_confirm`，人工确认前 `BusinessRecord` 增量必须为 0；
- 每日按 `docs/计划/B8_09_PILOT_DAILY_CHECKLIST.md` 核对导入、失败、重复候选、逐分差异、队列、GPU、存储、备份和告警；
- 所有问题进入 GitHub Issue，记录匿名 caseId、releaseId、requestId/traceId 和证据路径，不把聊天记录当缺陷台账；
- 真实数据只允许由授权人员小批量导入，且必须有 H-09/H-16 证据。

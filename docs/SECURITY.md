# 安全说明

更新日期：2026-07-18

## 已实现控制

### 身份与权限

- 密码使用 bcrypt 哈希，数据库不保存明文密码。
- 受保护接口只从 `Authorization: Bearer` 解析当前用户，不接受前端传入的 role、creatorId 或 targetUserId 作为授权依据。
- 每次鉴权读取数据库用户状态和 `tokenVersion`；登出、重置密码、停用或角色变化后旧 Token 失效。
- finance 与 boss 的管理边界、最后一个有效 boss、员工资源归属和各领域角色矩阵由后端强制执行。
- 登录按“来源 IP + 规范化账号”限制：15 分钟内 5 次失败后阻断 15 分钟，并写认证审计。

### HTTP 与配置

- 启动时校验 PostgreSQL URL、非占位且至少 32 字符的 JWT secret、端口、上传限制、Provider、模型运行参数、CORS、Swagger、代理层数和请求限流参数。
- 生产环境必须显式配置 `CORS_ORIGINS`；未在白名单的 Origin 不获得 CORS 许可。
- Helmet 启用 CSP、`X-Content-Type-Options` 和 `X-Frame-Options: DENY`；开发环境不伪造 HSTS，生产环境由 Helmet 启用。
- 全局按 IP 限流，响应包含 RateLimit 与 Retry-After 信息。开发可使用内存，生产强制 Redis 原子固定窗口；Redis 不可用时失败关闭。生产禁止 hop count，只接受明确 `TRUSTED_PROXIES`。
- 登录限流、上传准入和模型并发闸门当前仍为进程内状态；B8-09 Staging 只允许单 API、单 Worker，横向扩容前必须改为共享原子控制并通过多实例故障测试。
- Swagger 默认只在非生产环境启用；生产需显式设置 `SWAGGER_ENABLED=true`。
- DTO 使用 whitelist、forbidNonWhitelisted 和类型转换；成功与错误都使用统一 envelope。

### 数据与文件

- 关键业务写入使用事务、状态前置条件、唯一约束和幂等键；重复老板终审、导入确认和 OCR 确认不会重复入账。
- 删除用户、项目、记录和文件采用停用、归档、作废或软删除，保留审计链。
- 关键操作写 `audit_logs`；经营记录、原件和审批结果写 `ledger_events` 或任务尝试日志。
- 上传校验扩展名、MIME、文件签名、内容、大小、数量、文件名和资源归属；存储 key 使用不可预测标识，不使用原文件名。
- 生产强制私有 S3-compatible bucket 和 ClamAV；签名 URL 只有 30-300 秒，签发前重新授权并写 audit/ledger。S3、ClamAV 或容量检查失败时上传关闭。
- S3 连通性不再被解释为物理容量。应用只把 `statfs`、Provider 指标或 PostgreSQL 可信用量加显式逻辑配额标为容量来源；未知、过期、估算或矛盾状态均失败关闭。逻辑配额在最终事务内用全局 advisory lock 复核，MinIO 物理容量由私网 Prometheus 独立监控。
- PostgreSQL Staging 使用 TLS 和 migrator/runtime/backup 三账号；runtime 在数据库层不能 UPDATE/DELETE/TRUNCATE audit/ledger。
- 记录引用的原件禁止普通删除。上传目录、E2E 文件、`.env` 和模型目录由 Git 卫生检查阻止提交。

### AI/OCR

- 模型不持有数据库连接，只接收后端批准工具返回的最小结构化上下文。
- Provider key 不通过管理 API 返回，调用日志保存模型/路由/输入输出哈希和 correlation，不保存 Authorization header。
- 模型输出经过 JSON Schema 校验；超时、重试、熔断、并发和队列均有上限。
- OCR 结果必须经过任务权限和人工确认才能生成经营记录；默认 Mock，不会自动探测或启动本地权重。

## 日志与错误

- `X-Request-Id` 可由合法客户端值传入或由服务生成，并回写响应；W3C `traceparent` 被验证、继续或重新生成。
- 结构化请求日志记录 requestId、traceId、方法、去查询参数路径、状态、耗时、actor id/role 和结果，不记录请求体。
- 未处理异常对客户端只返回“服务端错误”，5xx 日志记录异常类型而非敏感堆栈或凭据。
- `/api/health/ready` 检查数据库、对象存储、ClamAV、队列、模型、Redis 和 Worker heartbeat，但不公开连接串、密钥或账号。
- `/api/metrics` 需要独立高熵 Bearer token；OTLP 使用有界队列，失败只输出不含业务内容的错误并增加 dropped 指标。

| 日志边界 | 允许字段 | 明确禁止/处理 |
| --- | --- | --- |
| Gateway access | 时间、客户端 IP、method、`$uri`、status/upstream status、字节、耗时、requestId/traceId | 不使用 `$request`、`$request_uri`、`$args`；不记录 Authorization、Cookie、body 或 User-Agent |
| Gateway request error | 启动和配置错误仍在全局 stderr | HTTP server 请求级 error log 关闭，避免 Nginx 回显带 query 的原始 request line；请求故障看安全 access log |
| API request/error | method、无 query path、status、耗时、已认证 actor、异常类型 | 不记录 query、headers、body、异常消息或堆栈；JSON 转义阻断换行注入 |
| Trace | 规范化 span path、method/status、requestId 和 trace IDs | 不记录 query、headers、body、Cookie 或 Token |
| AI/OCR 调用 | Provider/model/route、版本、耗时、输入输出哈希、correlation | 不保存 Authorization header、Provider key 或完整原始凭据 |
| Frontend | 向用户显示安全错误消息和 requestId | 当前无自动错误上报；不得把完整 URL、Cookie、Token 或预签名参数发送到日志服务 |

R2 的静态与实际容器测试使用合成 X-Amz、普通业务 query、Authorization、Cookie 和编码换行，证明 200/400/503 日志仍为合法 JSON 且不包含测试敏感值。`remote_addr` 的生产脱敏、访问范围和保留期限由 H09/H14 决定。

## 环境与密钥

- `.env`、`.env.test`、模型权重、真实样本和上传文件不得进入 Git。
- 开发 seed 只允许 `_dev` / `_test` 数据库，生产环境强制拒绝。
- Staging secret 通过 Docker secret file 注入，不写镜像、Compose、数据库或 Git；生产必须替换为批准的 secret manager，并建立轮换记录。
- 生产环境使用独立高熵 JWT/Redis/S3/Metrics/数据库 secret；开发示例值和合成 UAT 密码不能复用。
- 反向代理必须终止 TLS，并配置精确 `TRUSTED_PROXIES`；不要盲目信任任意 `X-Forwarded-For`。

## 依赖审计

2026-07-17 执行根目录与后端 `npm audit --omit=dev --audit-level=high`，两者均为 0 vulnerabilities。新增 AWS SDK、Redis 和 Prisma production CLI 后重新审计仍为 0；未使用 `--force`。

## 上线前必须补齐

- 在 H-13 指定目标主机完成固定 digest 镜像、TLS、私网、Redis、S3、ClamAV、集中日志/指标/trace 和告警送达实测。
- 执行关联数据库/对象备份、真实恢复和应用/数据/模型回退，记录实测 RPO/RTO；按 H-14 设置保留、删除和法务留存。
- 由 H-14 批准 PostgreSQL、对象和备份的静态加密、KMS/密钥轮换与异地副本策略；private bucket 和 versioning 不能替代加密验收。
- 将 Docker secret file 替换或接入正式 secret manager，演练 JWT/Redis/S3/数据库/Provider key 轮换。
- 用脱敏真实数据执行越权、文件恶意样本、OCR 错提取、Prompt 注入和报表口径验收。
- 完成 H-12 外部 AI 数据政策、H-15 独立 Review 和 H-16 最终 UAT；任何开放 P0/P1 均阻断上线。

## 事件处理

发现疑似泄露时立即禁用相关账号、轮换 JWT/Provider/数据库凭据、保留 audit/ledger/请求日志证据，并检查原始文件访问记录。不要删除或改写审计链；需要更正经营数据时创建作废/更正事件。

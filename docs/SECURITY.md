# 安全说明

更新日期：2026-07-12

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
- 全局按 IP 限流，响应包含 RateLimit 与 Retry-After 信息。`TRUST_PROXY_HOPS` 只能在明确代理拓扑后配置。
- Swagger 默认只在非生产环境启用；生产需显式设置 `SWAGGER_ENABLED=true`。
- DTO 使用 whitelist、forbidNonWhitelisted 和类型转换；成功与错误都使用统一 envelope。

### 数据与文件

- 关键业务写入使用事务、状态前置条件、唯一约束和幂等键；重复老板终审、导入确认和 OCR 确认不会重复入账。
- 删除用户、项目、记录和文件采用停用、归档、作废或软删除，保留审计链。
- 关键操作写 `audit_logs`；经营记录、原件和审批结果写 `ledger_events` 或任务尝试日志。
- 上传校验扩展名、MIME、文件签名、内容、大小、数量、文件名和资源归属；磁盘路径使用不可预测标识，不使用原文件名。
- 记录引用的原件禁止普通删除。上传目录、E2E 文件、`.env` 和模型目录由 Git 卫生检查阻止提交。

### AI/OCR

- 模型不持有数据库连接，只接收后端批准工具返回的最小结构化上下文。
- Provider key 不通过管理 API 返回，调用日志保存模型/路由/输入输出哈希和 correlation，不保存 Authorization header。
- 模型输出经过 JSON Schema 校验；超时、重试、熔断、并发和队列均有上限。
- OCR 结果必须经过任务权限和人工确认才能生成经营记录；默认 Mock，不会自动探测或启动本地权重。

## 日志与错误

- `X-Request-Id` 可由合法客户端值传入或由服务生成，并回写响应。
- 结构化请求日志记录 requestId、方法、去查询参数路径、状态、耗时、actor id/role 和结果，不记录请求体。
- 未处理异常对客户端只返回“服务端错误”，5xx 日志记录异常类型而非敏感堆栈或凭据。
- `/api/health/ready` 只公开数据库是否就绪，不公开连接串、版本或账号。

## 环境与密钥

- `.env`、`.env.test`、模型权重、真实样本和上传文件不得进入 Git。
- 开发 seed 只允许 `_dev` / `_test` 数据库，生产环境强制拒绝。
- 生产环境使用独立高熵 JWT secret、数据库最小权限账号和密钥管理服务；开发示例值不能复用。
- 反向代理必须终止 TLS，并正确设置 `TRUST_PROXY_HOPS`；不要盲目信任任意 `X-Forwarded-For`。

## 依赖审计

2026-07-12 执行 `npm audit --omit=dev --audit-level=high`：高危和严重漏洞为 0。

- 前端剩余 1 个 ECharts 中等级 XSS 公告；自动修复要求升级到 ECharts 6，属于破坏性主版本升级。当前图表数据来自后端结构化数值，不把用户 HTML 传入 formatter；仍应单独安排 ECharts 6 兼容升级。
- 后端剩余 2 个 ExcelJS 传递依赖 uuid 中等级公告，影响 v3/v5/v6 在传入 buffer 时的边界检查；本项目不直接调用该路径。强制修复会把 ExcelJS 降到旧主线，不采用破坏性自动修复，等待上游升级并持续审计。

## 上线前必须补齐

- 将内存请求/登录限流替换为 Redis、Ingress 或 API Gateway 的共享策略。
- 将本地文件替换为私有对象存储，接入病毒扫描、加密、备份、恢复和保留策略。
- 配置 TLS、WAF/网络边界、数据库备份、集中日志、指标告警和密钥轮换。
- 用脱敏真实数据执行越权、文件恶意样本、OCR 错提取、Prompt 注入和报表口径验收。
- 升级并验证剩余中等级依赖公告；任何 `--force` 升级都必须先通过完整回归。

## 事件处理

发现疑似泄露时立即禁用相关账号、轮换 JWT/Provider/数据库凭据、保留 audit/ledger/请求日志证据，并检查原始文件访问记录。不要删除或改写审计链；需要更正经营数据时创建作废/更正事件。

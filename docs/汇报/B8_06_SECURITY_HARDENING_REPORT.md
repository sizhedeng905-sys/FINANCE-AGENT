# B8-06 权限、Cookie、文件与数据安全验收报告

更新日期：2026-07-16

## 阶段结果：B8-06

- 状态：passed（工程门禁）；H-10/H-11 为 `blocked_external`
- 基线提交：`abd83fb`
- 新提交：本报告所在 B8-06 提交
- 修改范围：AI 日志隔离、生产 Cookie/JWT、管理员与审计员角色、step-up 预留、Office/CSV/PDF/图片安全、上传资源上限、文件证据下载、隔离区维护、Git/DLP 门禁
- 数据库迁移：有，`20260716100000_b8_security_boundaries`
- 新增测试：认证攻击、文件主动内容、资源准入与回收、仓库 DLP，以及 PostgreSQL 所有权/职责分离/健康检查场景
- 实际执行测试及结果：21/21 Jest suites、230/230 tests；57/57 PostgreSQL integration；14/14 Playwright；前后端 build、Prisma、hygiene 和生产依赖审计通过
- 未执行测试及原因：生产 TLS/反向代理、真实 ClamAV/对象存储、人工认证政策和文件允许政策需目标环境或负责人输入
- 新发现风险：MFA 仅有 purpose-bound step-up 预留；生产角色策略、原件预览/下载范围尚未签字；项目仍不能描述为 production-ready
- 真实数据源文件哈希：未接触
- 需要人工决定：H-10、H-11
- 下一阶段：B8-07（按用户持续推进授权开始）

## AI 日志隔离

- 老板调用日志始终按当前 JWT 用户的 `createdBy` 过滤；跨老板详情返回 404。
- 老板接口只返回 provider、model、耗时、状态、fallback、输入哈希、关联 ID、attempt 和时间，不返回 request、response、错误正文或端点。
- 新增 auditor-only 完整日志接口；请求、响应和错误递归脱敏手机号、身份证、银行卡/账号、邮箱、Bearer/JWT 及敏感字段。
- 端点快照只保留 URL origin，不保留凭据、路径、查询参数或 fragment。
- 完整审计日志默认只查询最近 90 天，可通过 `AI_AUDIT_RETENTION_DAYS` 收紧或调整。

接口：

```text
GET /api/ai/call-logs/:id
GET /api/ai/audit/call-logs
GET /api/ai/audit/call-logs/:id
```

## 认证与职责分离

- 开发环境只接受 `finance_agent_*` Cookie；生产只接受 `__Host-finance_agent_*`。
- 禁止的 Cookie family、混合 family、同名重复、空值重复和非法编码重复均拒绝并清理。
- Cookie 登录写操作继续执行环境对应的双提交 CSRF 严格匹配。
- JWT 固定 `HS256`，强制 issuer、audience 和 `typ=access`；step-up token 不能冒充 access token。
- 新增 `admin` 与 `auditor`。admin 可管理全部角色；finance/boss 仅可管理 employee；finance 不能重置 reviewer 或其他 finance。
- 高权限角色变化、密码重置、状态变化和停用同时写 audit log 并通知目标用户；最后一个有效 boss/admin 受保护。
- `POST /api/auth/step-up` 使用当前用户密码签发 5 分钟、purpose-bound 的 step-up token；MFA 状态明确为 reserved，不宣称已实现 MFA。

## 文件与资源安全

- OOXML 检查 canonical part 路径、重复部件、压缩比/展开大小、Relationship Type、Content Type、外部关系、VBA/OLE/ActiveX、活动字段和主动公式。
- CSV 使用带引号状态机检查首字符策略；`=`, `@` 和非纯数字的 `+`/`-` 失败关闭，普通正负数保留。
- 旧 XLS 继续在受限子进程中净化；SheetJS 未使用的 `.bin` 默认声明不会误报，但实际主动部件仍失败关闭。
- PDF 在受限 Worker 中检查加密、页数、对象复杂度、活动内容和超时；图片限制宽、高、总像素与解码后内存。
- `/files/upload`、`/import-tasks` 和 `/ocr-tasks/upload` 共用每用户并发、在途总字节和速率准入；默认允许验收所需 5 路并发、260 MiB 在途和每分钟 60 次。
- ClamAV socket 写入和本地存储写入均处理 backpressure；存储从隔离文件流式落盘。
- 原件统一标记 `untrusted_original`；下载固定为 `application/octet-stream` attachment，并返回 `nosniff`、`noopen` 和 `X-File-Trust`。
- 启动时清理过期/非法隔离文件，并对数据库与磁盘执行缺失文件失败关闭、孤儿/已作废文件清理和匿名路径哈希审计。

## Git 与 DLP

- 默认阻止 `.xls/.xlsx/.csv/.pdf/.doc/.docx/.jpg/.jpeg/.png/.zip` 业务文件候选提交。
- 仅允许配置文件中逐路径声明的合成 fixture；模型权重、环境文件、上传/隔离目录和大文件继续拒绝。
- DLP 检查私钥、手机号、校验有效的身份证、Luhn 有效银行卡/账号、可配置内部客户词典和高熵敏感赋值。
- `.githooks/pre-commit` 检查 staged 文件；GitHub Actions 对仓库候选执行相同门禁。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端单元测试 | 21/21 suites，230/230 tests |
| PostgreSQL 集成 | 57/57 tests；23 migrations；无 pending migration |
| 大表回归 | 30,196 行 17.715 s、API 23 ms；49,999 行 32.604 s、API 39 ms |
| 资源峰值 | 30,196 行 RSS 增量 153.13 MiB；49,999 行 242.07 MiB；连接峰值 10/11 |
| 浏览器 E2E | 14/14 tests；teardown 文件残留 0 |
| Cookie/JWT | 开发/生产混合、duplicate、malformed、empty、CSRF mismatch 和 token purpose 全部拒绝 |
| 文件攻击 | OOXML/CSV/PDF/图片/XLS 主动内容、伪格式和资源边界测试通过 |
| 构建与 Prisma | 前后端 production build、format、validate、migrate status、41 表 db verify 通过 |
| 仓库与依赖 | tracked hygiene 通过；根目录与后端 production audit 均为 0 vulnerabilities |

## 外部门禁

- H-10：管理层与安全负责人确认 admin、finance、reviewer、boss 的生产认证、MFA 和职责分离政策。
- H-11：安全与业务负责人确认各格式可上传、可预览、可下载原件及是否需要净化副本。
- B8-07/B8-09：在真实 TLS 反向代理、ClamAV、对象存储和部署拓扑中复验 Cookie、健康鉴权、流式存储与恢复。

在这些项目完成前，B8-06 只能标记为工程门禁通过，不能据此声明生产就绪。

# 系统架构

更新日期：2026-07-20

## 范围

当前版本完成物流企业财务运营第一版闭环、阶段 9 Excel、阶段 10 OCR，以及 M0-M8 的 AI 建议、双人财务批准、不可变报告快照、攻击性工程验收和最终证据收口。核心业务以 PostgreSQL 为事实来源；前端 Mock 只用于显式离线演示，不能在 API 失败时自动兜底。真实业务口径、模型准确率、目标 Staging 与生产发布仍受 H01-H16 门禁约束。

```text
React/Vite
  -> src/api Repository（mock 或 api，启动时显式选择）
  -> NestJS /api
     -> DTO 校验、JWT、角色与资源范围
     -> 领域 Service、状态机、事务与幂等
     -> Prisma
  -> PostgreSQL

TLS Gateway
  -> React/Vite static frontend
  -> NestJS API（只提交持久任务）
  -> S3-compatible private object endpoint

NestJS API / Worker
  -> 本地 FileStorage（开发）或 S3/MinIO（Staging）
  -> Redis（共享限流、Worker heartbeat）
  -> PostgreSQL durable task lease
  -> ClamAV（生产 fail-closed）
  -> AI Provider（默认 mock，可替换 OpenAI-compatible）
  -> OCR Provider（默认 mock，可替换 Local Paddle HTTP）

Observability
  -> Prometheus / Alertmanager
  -> Loki / Promtail
  -> Tempo OTLP / Grafana

Excel deterministic parser ----\
                                -> versioned IR -> AI suggestion -> finance revision
OCR Provider + evidence --------/                                  -> revalidate
                                                                  -> immutable approval snapshot
                                                                  -> atomic BusinessRecord commit

confirmed + actual records -> fixed Decimal query -> canonical ReportSnapshot
                                                   -> constrained AI narrative suggestion
```

## 前端边界

- `VITE_APP_DATA_MODE=api|mock` 是唯一模式开关。
- `src/api/httpClient.ts` 统一处理 Bearer Token、超时、requestId、响应 envelope、401 会话失效和错误展示。
- 页面与 Zustand Store 只调用 `src/api` Repository，不直接把 `src/mock` 当作 API 失败回退。
- API 与 Mock Repository 使用相同 DTO/返回类型，便于无数据库演示和真实联调分别验收。

## 后端分层

- 入口层：`main.ts` 配置全局前缀、校验管道、统一响应/异常、CORS、Helmet、日志和 Swagger。
- 接口层：Controller 负责路由、DTO、Swagger 描述及从 Token 获取当前用户。
- 授权层：JWT Guard、角色装饰器和 Service 内资源归属共同限制访问；前端角色不参与授权决策。
- 领域层：项目、模板、字段、记录、工单、文件、通知、规则、报表、AI、导入、OCR 和模型运行时各自独立模块。
- 数据层：`PrismaService` 管理 PostgreSQL 连接；跨表关键写入使用 Prisma transaction。
- 追溯层：关键操作写 `audit_logs`；经营数据和原始文件相关事件写 `ledger_events` 或对应任务/尝试日志。
- 运行层：生产用 `PROCESS_ROLE=api|worker` 拆分请求和后台执行；开发/测试可使用 `all` 保持单进程体验。

## 数据域

| 数据域 | 核心模型 |
| --- | --- |
| 身份与审计 | User、AuditLog |
| 数据中心 | Project、Template、FieldDefinition、TemplateField、ProjectTemplate |
| 经营记录 | BusinessRecord、RecordValue、LedgerEvent |
| 审批 | WorkOrder、Approval、WorkOrderTimeline、WorkOrderAttachment |
| 文件与通知 | RawFile、Notification、NotificationReceipt |
| 规则与 AI | RiskRule、RuleRunResult、AiAnomaly、AiConversation、AiMessage、AiCallLog、AiPromptVersion |
| Excel | ImportTask、ImportSheet、ImportColumn、ImportRow、MappingProfile、MappingProfileRule、MappingDecision、FieldSuggestion |
| OCR | OcrTask、OcrAttempt、OcrCorrection；任务内冻结 IR、review/validation/approval snapshot |
| 模型运行时 | ModelDeployment、TaskModelRoute、AiTask、AiCallAttempt、AiModelConfig |
| 报告证据 | ReportSnapshot、ReportSnapshotSource、ReportNarrative、AiFinancialClaim |
| 写入治理 | IdempotencyKey、StepUpGrant、RetentionRun、RetentionLegalHold |

动态字段由 `field_definitions` 和关系表定义，新增字段不会修改数据库列。动态值按类型落入 `record_values.value_text/value_number/value_date/value_json`，统计金额和数值不依赖字符串解析。

## 核心闭环

1. 员工通过真实账号登录，JWT 中只保存身份声明，后端再读取当前数据库用户。
2. 员工创建草稿、上传附件并提交工单。
3. 财务、复核员按后端状态机执行各自动作；规则检查产生运行结果和异常。
4. 老板最终审批。通过时在同一事务内幂等生成 `BusinessRecord/RecordValue`、时间线、审计和 ledger 事件。
5. confirmed actual 经营记录进入固定查询和 canonical ReportSnapshot；draft、对账层和预算层不能混入 actual 报告。
6. 通知按目标用户或角色隔离；报告叙述和老板 AI 助手只能使用批准的结构化工具或服务端 Claim 白名单，模型不直接连接数据库。

## 导入与 OCR

Excel 导入保存任务、Sheet、列、原始行、映射决定、稳定单元格证据和逐行错误。AI 只对列摘要做模板/字段建议，不逐行调用模型。每个通过校验的有效明细行生成一条记录；普通错误明细不可被排除后部分发布，疑似汇总行必须由财务明确处置。人工修改产生新 revision 并使旧 ValidationSnapshot 失效；另一名有效财务重新校验后批准。后台确认先写 report-invisible staging，最终事务重验身份、来源、模板、行集合和输出 hash 后整批原子发布。PostgreSQL lease、行 hash 和幂等键阻止恢复或重放造成重复入账。

OCR 先保存原文件与任务，再由 Provider 返回版本化 page/block/token/bbox 证据。AI 只能在项目启用模板、字段和 evidence ref 白名单内建议。人工纠正必须保存 `MANUAL_OVERRIDE` revision 和理由，并使旧 ValidationSnapshot 失效；上传者不能自审批。最终事务重新读取账号、角色、文件安全状态、模板、候选证据和当前 hash，冻结 approval snapshot 后最多生成一条记录。确认前不会产生经营记录。Mock Provider 用于确定性验收，Local Paddle 适配器只接受内部 JSON Schema 契约。

## AI 建议与批准边界

- `AI_INGESTION_MODE` 和 `AI_REPORT_MODE` 只接受 `disabled|suggest`，缺失默认 disabled；全局 kill switch 优先。
- `AiPromptVersion`、严格输出 Schema、`finance_core_guard`、Provider/模型、source/IR、模板、转换、规则、脱敏和授权策略形成完整版本向量。
- Excel/OCR/文件文字均是不可信数据，不会成为系统指令；未知 ID、字段、状态、转换、证据和 JSON 属性均拒绝。
- AI Worker 最多推进到待财务复核。AI 模块不能导入正式记录写服务，也不能批准、提交、执行 SQL 或修改模板。
- 外部 Provider 在 H12 白名单和数据政策批准前拒绝真实或未知数据；失败转人工，不静默回 Mock。

## 报告快照

- canonical ReportSnapshot 在 PostgreSQL `REPEATABLE READ` 中固定读取 `confirmed + actual`，金额始终使用 `Prisma.Decimal`。
- 不同币种分别统计，不做未批准的汇率换算；来源记录 ID/version/content hash 形成稳定 source digest。
- Snapshot/Narrative/Claim 为不可变审计事实；相同事实复用相同快照，并发冲突仅对 `P2002/P2034` 做三次有界新事务重试。
- 报告 AI 只能逐字选择服务端 Claim Catalog，必须保留全部 warning；新增数字、实体、原因、比较或预测会被确定性 validator 拒绝。

## 模型运行时

- Seed 默认只启用 Mock deployment；本地 Qwen/Paddle/Embedding deployment 均为 `disabled`。
- 共享运行时提供任务路由、超时、有限重试、熔断、并发门控、有界队列、健康检查和调用尝试记录。
- Provider 输出先经过 JSON Schema 校验，失败不会绕过人工确认或业务状态机。
- 本机 RTX 5090 的驱动、显存、文本/VL/Embedding 切换和真实调用延迟已按 B8-07 验证；OCR 业务准确率、财务标准答案和目标 Staging GPU 拓扑仍待人工与目标环境验收，部署步骤见 `docs/MODEL_DEPLOYMENT.md`。

## 运行与可观察性

- `/api/health` 和 `/api/health/live` 表示进程存活。
- `/api/health/ready` 检查 PostgreSQL、对象存储、ClamAV、队列、模型、Redis 和 Worker heartbeat；任一生产依赖不可用时返回统一 503。
- 每个请求带 `X-Request-Id` 和 W3C `traceparent`，日志包含方法、无查询参数路径、状态码、耗时及已认证 actor，不记录 Token、密码、正文或 Provider key。
- `/api/metrics` 使用独立 Bearer token；span 通过有界 OTLP 队列导出，失败计入 dropped/error 指标但不拖垮财务请求。
- 生产 migration 使用 `prisma migrate deploy`，NestJS shutdown hook 负责优雅断连。
- Staging 的 PostgreSQL 使用 TLS 和 migrator/runtime/backup 三账号；runtime 对 audit/ledger 只有 INSERT/SELECT。
- 备份把 logical/base/WAL 与对象快照通过 manifest 关联；恢复演练和应用/数据/模型回退均有显式脚本与安全确认门。

## 当前生产缺口

- B8-09 工程配置已经提供对象存储、ClamAV、Redis、TLS、观测和备份恢复，但尚未在 H-13 指定的目标服务器完成真实容器、RPO/RTO 与回退演练。
- 生产全局请求限流、登录限流、上传准入和模型并发/排队使用 Redis 共享原子控制；AI、OCR 与推理健康探针按部署摘要共享 FIFO 预算。B8-09 Staging 继续限制为单 API、单 Worker，横向扩容须先在 H13/H14 目标环境完成多实例 release、故障、恢复与回退验收。
- R8.6 已有本机 18 服务 release/restore/同 manifest rollback 证据；R8.7 完整重验曾因 Debian security 502 停止，目标 Linux 与新的远端 CI 仍为 `blocked_external`。
- 真实 OCR/AI 仍需脱敏企业样本、标准答案集和业务人员验收；外部 AI 数据政策待 H-12。
- RPO/RTO、数据/日志/原件保留、删除和法务留存待 H-14；独立 Review 和最终 UAT 待 H-15/H-16。

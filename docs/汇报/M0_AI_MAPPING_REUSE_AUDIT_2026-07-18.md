# M0 AI 分类、映射、审批与报告复用审计

日期：2026-07-18

分支：`agent/b8-stable-hardening`

审计基线：`66a5ee2c919374edb74411621aedc82185077f34`

状态：`passed`（仅表示 M0 设计与现状审计完成，不表示 M1-M8 实现完成）

## 1. 输入与主任务优先级

- 主任务书 R1-R7.2 的本机代码类 P0/P1 已有失败复现、修复提交和回归证据。
- R8.6 的本机完整 release、恢复演练、日志检查和同 manifest rollback 已通过；R8.7 最终后端镜像的 OpenSSL/Prisma 契约已通过。
- R8.7 完整 release 重验连续两次被 Debian security 索引 502 阻断，已按规则标记 `blocked_external`，没有关闭 TLS 或签名校验。
- R9 目标 Linux Staging 受 H13/H14 阻断；R10 真实模型准确率受 H04-H09/H12/H16 阻断。它们不阻止合成数据上的 M1-M8 非生产框架。
- `docs/FINANCE_AGENT_HUMAN_DECISIONS_UAT_SIGNOFF_2026-07-18.md` 中 H01-H16 全部仍为 `Pending`。本轮不固化正式会计、重复、外发、保留或职责分离政策。
- `docs/ai/FINANCE_AGENT_AI_PROMPT_CATALOG_V0_1.md` 当前为 0 字节未跟踪文件。固定 manifest 可按补充任务书实现，但目录正文不能被宣称已核对；该用户资产不修改、不暂存。

## 2. 已核验调用链

### 2.1 Excel

```text
FilesService 安全上传
  -> ImportTask.create（项目锁、模板快照、audit/ledger、幂等）
  -> inspect / parse（ExcelJS、Sheet/表头、同步或流式批处理、lease/恢复）
  -> ImportSheet / ImportColumn / ImportRow
  -> autoMatch / saveMappings / FieldSuggestion / MappingProfile
  -> preview（服务端分页、响应预算、确定性类型和必填校验）
  -> confirm（step-up 可配置、后台 confirmation lease）
  -> 分批创建 pending BusinessRecord / RecordValue
  -> 全批处理结束后批量改为 confirmed
```

当前优点：原文件哈希、模板快照、项目级锁、行哈希、分页预览、Decimal、幂等和恢复机制可复用。

当前关键差距：单元格地址、lexical/display/formula/cache 证据不完整；Profile 只有模板和列名规则；确认采用 `valid_rows_only`，错误行可被静默排除；批准前没有不可变 review/validation/approval 快照；分批期间已存在正式 `BusinessRecord`；没有保守禁止上传者自审批。

### 2.2 OCR

```text
FilesService 安全上传
  -> OcrTask.create（模板/Provider 配置快照、audit/ledger、幂等）
  -> queue / processing（lease、heartbeat、恢复、attempt）
  -> DocumentPreprocessor + OcrProviderRegistry
  -> pages / textBlocks / fieldCandidates(page,boundingBox,confidence,evidence)
  -> correction
  -> confirm（项目锁、确定性值校验、单事务 BusinessRecord/audit/ledger）
```

当前优点：Provider 抽象、配置哈希、attempt、页码/bbox、人工纠错、Decimal 和项目锁可复用。

当前关键差距：没有版本化 OCR IR、token/block stable ID、坐标系版本和 IR 哈希；`rotationReserved` 等只表示预留；纠错没有统一 review revision 和旧校验失效；上传者可确认；没有冻结完整版本向量。

### 2.3 AI 与报告

```text
ReportsService 固定查询 confirmed + actual
  -> AiToolsService 构造结构化上下文
  -> AiService 选择 AiPromptVersion / ModelDeployment
  -> Provider
  -> AiAnswerGroundingService 按 scope/period/metric/value/sourcePath 校验
  -> 后端确定性渲染
  -> AiCallLog + audit
```

当前优点：AI 不执行 SQL；数字来自后端工具；模型配置、Prompt 版本和调用日志已有扩展点；错误会明确降级。

当前关键差距：没有不可变 canonical `ReportSnapshot`；Claim 只存在响应 JSON，不是持久化审计实体；Prompt 长文本仍散落在 service；`StructuredOutputValidatorService` 会剥离 Markdown fence，违反严格 JSON 要求；安全 fallback 实际调用 Mock，但 call log 仍以原 Provider 为主语；缺少 ingestion/report 独立模式和全局 kill switch。

## 3. 复用矩阵

| 领域能力 | 现有类/表/API | 复用方式 | 最小扩展 | 禁止重复实现 |
| --- | --- | --- | --- | --- |
| 原文件与安全门禁 | `RawFile`、`FilesService`、扫描/隔离/短签名 URL | 继续作为 Excel/OCR 唯一原件入口 | 在任务冻结 `rawFileSha256`、安全状态和策略版本 | 不建第二套上传或对象存储模块 |
| Excel 任务 | `ImportTask` | 继续作为 Excel ingestion aggregate | IR/hash、review/version vector、validation/approval/commit 关联 | 不建平行 `IngestionDocument` |
| Sheet/列/行 | `ImportSheet/Column/Row` | 继续分页和批处理 | stable ref、cell evidence、IR schema、统计/结构指纹 | 不把 5 万行另存巨大 JSON |
| Excel 解析 | `ExcelParserService` | 保留 document/streaming 双路径 | 输出版本化 evidence DTO 和 canonical hash | 不引入第二个工作簿解析器 |
| 映射建议 | `MappingDecision`、`FieldSuggestion` | AI 结果先写 suggestion，财务修改写 revision | suggestion/version vector/transform/evidence/status | 不建重叠 `MappingSuggestion` 表 |
| Mapping Profile | `MappingProfile/Rule` | 扩展现有规则复用 | project scope、fingerprint、version、status、transform、approval hash | 不做模糊静默复用 |
| OCR 任务 | `OcrTask/OcrAttempt/OcrCorrection` | 继续使用任务、attempt、恢复和纠错 | OCR IR/hash、tokens、coordinate/preprocess version、review revision | 不建第二套 OCR task |
| OCR Provider | `OcrProviderRegistry`、local/mock Provider | 继续做真实 Provider 路由和配置冻结 | 输出标准化 adapter；模式/kill switch 前置 | 不在 ingestion 模块直连模型 URL |
| 模板版本 | 每个 `Template` 行及 `version/templateSnapshot` | 把模板行视为不可变版本 | family/parent/status/content hash；旧任务绑定现有 ID | 不原地修改旧版本解释 |
| Prompt Registry | `AiPromptVersion` | 扩展为唯一 registry | schema/policy/budget/retired/content hash | 不建 `PromptDefinition`，不在 service 散落长 Prompt |
| 模型配置与调用 | `AiModelConfig/ModelDeployment/TaskModelRoute/AiTask/AiCallAttempt/AiCallLog` | 复用路由、attempt、日志、资源闸门 | 完整 version vector、output hash、错误类别和实际 fallback Provider | 不建平行 AI 调用台账 |
| 严格输出 | `StructuredOutputValidatorService` | 强化一个共享验证器 | 禁 fence、重复键/深度/大小/污染键、白名单后校验 | 不在各 service 手写宽松 JSON 提取 |
| 确定性转换 | `RecordPolicyService` 与现有字段 normalize | 抽取成版本化纯函数 registry | 仅白名单 transform key | 不执行模型给出的表达式或代码 |
| 项目并发锁 | `acquireProjectWriteLock` | 模板、审批、Profile、commit 共用 | 状态/version/hash 条件更新 | 不新增不同 advisory lock key |
| 幂等 | `IdempotencyService`、业务唯一约束 | 最终命令继续使用 actor+operation key | expected version/hash、approval/output hash | 不只靠前端防重复点击 |
| 审计 | `AuditLog`、`LedgerEvent` | 关键命令和正式事实继续同事务写入 | review/validation/approval/commit ID 与版本向量 | 不把应用日志当审计链 |
| 财务审核 | 当前 mapping/correction + audit | 保留 UI/API 路径并引入统一 revision 语义 | 新增不可变 review/validation/approval/commit 实体，因为现有表不能表达历史修订 | 不用单个 boolean 覆盖历史 |
| 业务写入 | Import/OCR/Records 的现有事务写入 | 抽取唯一 ingestion commit 边界 | 只接受不可变批准快照；AI 模块禁止依赖该服务 | 不让 Provider/AI service 导入 Prisma 写库能力 |
| 应用通知 | `Notification/NotificationReceipt` | 站内通知可作为同事务持久事实 | commit 结果同事务创建；外部通道以后使用 outbox | 不在 DB 事务内调用外部网络 |
| 确定性报告 | `ReportsService` | 复用真实 confirmed/actual 查询和 Decimal | repeatable-read、分币、canonical snapshot/hash | 不让 AI 查询数据库或重算金额 |
| AI Claim | `AiFinancialClaim` TS 契约与 `sourcePath` 校验 | 迁移为 snapshot JSON Pointer grounding | 持久化 report narrative/claims 和 snapshot 关联 | 不另建无法关联现有老板助手的依据链 |
| Worker | import/OCR lease、`WorkerRuntimeService` | 继续使用 heartbeat/recovery | AI inference 与 commit 使用独立 lease 语义 | 不沿用解析 lease 做人工审核 |

## 4. 最小领域扩展设计

现有表无法安全表达“建议 -> 多次人工修改 -> 重新校验 -> 不可变批准 -> 幂等提交”的历史，因此允许新增少量非重叠实体；它们服务 Excel/OCR 两条链，不各造一套。

### 4.1 现有表增加字段

`ImportTask`：

- `sourceSha256`、`irSchemaVersion`、`irHash`、`parserVersion`；
- `structureFingerprint`、`fingerprintVersion`；
- `reviewRevision`、`currentValidationSnapshotId`、`approvedSnapshotId`、`commitId`；
- `policySnapshot`、`payloadHash`；
- 扩展状态但保留旧状态兼容读取。

`ImportSheet/Column/Row`：

- Sheet stable ID、visibility、header rows、merged ranges；
- 列字母、header parts、统计和 evidence；
- 行级 `cellEvidence`，只保存有界、可分页证据，不把整表返回浏览器。

`OcrTask`：

- `sourceSha256`、`irSchemaVersion`、`irHash`、`coordinateVersion`、`preprocessingVersion`；
- `tokens`、`reviewRevision`、validation/approval/commit 关联和 policy snapshot。

`Template`：

- `templateFamilyId`、`parentVersionId`、`versionStatus`、`contentSha256`；
- 旧行回填为各自 family，不破坏现有 ID/FK。

`AiPromptVersion`：

- `purpose`、输入/输出 Schema 版本、Provider class 白名单、输入预算、timeout policy、redaction policy、`retiredAt`、`contentSha256`；
- Prompt 退役只阻止新调用，历史内容继续可读。

`AiTask/AiCallAttempt/AiCallLog`：

- 完整 version vector、input/output hash、实际 fallback Provider、Schema error category；
- 默认只保存最小化摘要，原文保留继续受 H12/H14 约束。

`MappingProfile/Rule`：

- project scope、profile version、结构指纹/version、状态、template version、transform registry version、批准 hash、usage/last used；
- 唯一约束使用 project + fingerprint + template version + profile version。

### 4.2 新增非重叠实体

- `IngestionReviewRevision`：可选关联 ImportTask/OcrTask，保存每次 AI 建议、人工修改、值覆盖及 payload hash；数据库 check 保证只关联一种任务。
- `IngestionValidationSnapshot`：绑定 task + review revision，保存规则版本、错误/警告、结果 hash；任务仅指向当前快照，修改后清空指针，旧快照不改写。
- `ApprovedIngestionSnapshot`：冻结 source/IR/template/Prompt/Schema/Provider/model/transform/validation/redaction/auth policy 完整向量及 output hash。
- `IngestionCommit`：批准快照唯一关联、operation/idempotency key、record count/hash 和提交结果；正式记录通过来源 FK/快照关联追溯。
- `ReportSnapshot`：canonical JSON、事实核心 hash、query/canonicalization/source digest/watermark、scope/period/currency/warnings。
- `ReportNarrative` 与 `ReportClaim`：保存 Prompt/Provider/模型、叙述和逐项 JSON Pointer grounding。现有 TS `AiFinancialClaim` 适配为该契约，不另起老板助手链。

站内通知继续复用 `Notification`。外部通知尚无获批需求，不在 M0 新建通用消息平台。

### 4.3 Migration 原则

1. 只新增 migration，不修改已有 28 条 migration。
2. 新列先可空或有保守默认；在一次性 `_test` 库回填，再决定是否收紧。
3. 旧 task/status/API 仍可读取；新命令只对具备新版本向量的任务开放。
4. 哈希、版本、approval/commit 和 Profile 唯一性由数据库约束，不只靠 service。
5. migration 不调用模型、不读取真实文件、不依赖网络。
6. 分别验证空库和上一基线升级；失败必须完整清理临时库。

## 5. 状态映射与命令表

客户端只能发命令，不能提交目标状态。下表是统一语义；M1-M5 映射回 Import/OCR enum。

| from | command | to | actor | 前置条件 | 幂等/并发 | errorCode 语义 |
| --- | --- | --- | --- | --- | --- | --- |
| `UPLOADED` | `inspect/parse/run_ocr` | `PARSING/OCR_RUNNING` | finance | 文件 clean、项目/模板可用 | task lock + 新 processing lease | 文件/状态 4xx，Provider 门禁 503 |
| `PARSING` | `select_sheet_header` | `UPLOADED` | finance | 需要显式 Sheet/表头 | expected version | 409 stale version |
| `PARSING/OCR_RUNNING` | worker success | `PARSED/OCR_READY` | worker | lease owner、IR hash 成功 | lease token | lease lost 不覆盖新结果 |
| `PARSING/OCR_RUNNING` | retryable failure | `FAILED_RETRYABLE` | worker | attempt 未耗尽 | attempt unique | 稳定错误类别 |
| `FAILED_RETRYABLE` | `retry` | `PARSING/OCR_RUNNING` | finance/worker | 文件和版本仍有效 | 新 lease | 409 stale/cancelled |
| `PARSED/OCR_READY` | `request_ai_suggestion` | `CLASSIFYING` | finance | mode=`suggest`、kill switch off、白名单候选 | input hash + AI task key | disabled 转手工，不伪造成功 |
| `CLASSIFYING` | valid classification | `MAPPING` | worker | strict Schema/ID/evidence 校验 | attempt 审计 | 无合法候选进入人工 |
| `MAPPING` | valid suggestion/manual mapping | `NEEDS_FINANCE_REVIEW` | worker/finance | 每列/字段已映射或明确 unmapped | revision + payload hash | 未知 ID/transform 400 |
| `NEEDS_FINANCE_REVIEW` | `save_draft` | `REVIEW_IN_PROGRESS` | finance reviewer | 当前项目权限 | expected version/hash | 409 concurrent edit |
| `REVIEW_IN_PROGRESS` | `modify_mapping/value/evidence` | `REVIEW_IN_PROGRESS` | finance reviewer | 未批准、证据同来源 | 新 revision，旧 validation 失效 | 409 stale payload |
| `REVIEW_IN_PROGRESS` | `revalidate` | `VALIDATING` | finance reviewer | expected revision/hash | 单次 validation key | 409 stale revision |
| `VALIDATING` | validation blocked | `NEEDS_FINANCE_REVIEW` | server | blocking error 或未确认 warning | immutable snapshot | 422 validation blocked |
| `VALIDATING` | validation clean | `NEEDS_FINANCE_REVIEW` | server | 全量确定性校验通过 | current snapshot pointer | 不自动批准 |
| `NEEDS_FINANCE_REVIEW` | `request_changes` | `CHANGES_REQUESTED` | finance reviewer | 原因必填 | command idempotency | 409 already terminal |
| `CHANGES_REQUESTED` | `revise` | `REVIEW_IN_PROGRESS` | uploader/finance | 输入未变且仍有权限 | 新 revision | 409 stale source |
| `NEEDS_FINANCE_REVIEW` | `approve_and_commit` | `APPROVED_PENDING_COMMIT` | finance reviewer | 非上传者、账号 active、项目权限、current validation clean、expected version/hash、无未处置 warning | operation idempotency + task/project lock | 403 self/permission；409 stale；422 blocked |
| `APPROVED_PENDING_COMMIT` | internal commit claim | `COMMITTING` | commit worker/server | 不可变批准快照存在 | 独立 commit lease | 无快照拒绝 |
| `COMMITTING` | transaction success | `COMMITTED` | commit service | 事务内重鉴权和版本向量仍有效 | approval/commit unique + record source unique | 重放返回同结果 |
| `COMMITTING` | transient failure | `FAILED_RETRYABLE` | commit service | 事务已回滚 | 新 commit lease，同 approval | 不出现部分正式事实 |
| 任意 pre-commit | source/template/policy revoked | `STALE` | server | 冻结版本被明确撤销或安全策略要求 | 条件更新 | 409 rebuild required |
| 任意 pre-commit | `cancel` | `CANCELLED` | finance | 未进入不可逆 commit | task lock 与 commit 竞争 | 胜者唯一；已提交不能显示取消 |

`APPROVED_PENDING_COMMIT` 和 `COMMITTING` 只允许服务端内部设置。AI Worker 最多推进到 `NEEDS_FINANCE_REVIEW`。

## 6. 完整冻结向量

批准时必须保存：

```text
sourceSha256 + irHash + parser/OcrVersion
templateVersionId + templateContentSha256 + candidateSetHash
promptVersionId + promptContentSha256 + input/outputSchemaVersion
provider + modelConfigId + modelRevision + inputHash + outputHash
transformRegistryVersion + validationRuleVersion + mappingProfileVersion
redactionPolicyVersion + authorizationPolicyVersion + financePolicyBaselineVersion
reviewRevision + validationSnapshotHash + normalizedOutputHash
```

创建新的 active 模板或 Prompt 不改写旧任务解释。只有旧版本被明确撤销或安全策略要求时才置 `STALE`。

## 7. M 系列问题台账

| 编号 | 严重性 | 问题 | M 阶段 | 当前状态 |
| --- | --- | --- | --- | --- |
| M0-INPUT-001 | P1 | Prompt Catalog 文件为 0 字节，无法核对目录正文 | M0/M2/M8 | `blocked_external` |
| M1-EXCEL-EVIDENCE-001 | P0 | Excel 缺少稳定单元格 lexical/display/address/formula 证据和 IR hash | M1 | `verified` |
| M1-OCR-EVIDENCE-001 | P0 | OCR 缺 token/block stable ID、坐标版本和 IR hash | M1 | `verified` |
| M2-PROMPT-REGISTRY-001 | P1 | Prompt 散落、registry 契约和 content hash 不完整 | M2 | `verified` |
| M2-STRICT-SCHEMA-001 | P0 | 宽松剥离 Markdown fence，缺少重复键/深度/污染键防线 | M2 | `verified` |
| M2-AI-MODE-001 | P0 | ingestion/report 模式、kill switch、H12 外部 Provider失败关闭缺失 | M2 | `verified` |
| M3-PROFILE-001 | P1 | Profile 无项目范围、结构指纹、版本、失效和 transform | M3 | `open` |
| M4-OCR-REVIEW-001 | P1 | OCR evidence UI 无 token/bbox 稳定引用及 revision 语义 | M4 | `open` |
| M5-SELF-APPROVAL-001 | P0 | 上传者可确认 Import/OCR，最终事务未按保守策略重验身份 | M5 | `open` |
| M5-PARTIAL-COMMIT-001 | P0 | Excel `valid_rows_only` 会在存在错误行时部分创建正式记录 | M5 | `open` |
| M5-SNAPSHOT-COMMIT-001 | P0 | 无 immutable review/validation/approval/commit 链和唯一 commit service | M5 | `open` |
| M6-REPORT-SNAPSHOT-001 | P0 | 报告无 canonical snapshot、事实 hash、水位、分币和持久 Claim | M6 | `open` |
| M7-ATTACK-BUDGET-001 | P1 | 新状态、Schema、注入、资源和 Provider 降级矩阵尚无自动断言 | M7 | `open` |
| M8-EVIDENCE-001 | P1 | manifest/registry/Schema 漂移、迁移证据和 Draft PR 尚未收口 | M8 | `open` |

## 8. M0 关闭结论

- 没有设计第二套 Excel、OCR、文件、Provider、Worker、审计或老板助手模块。
- 已明确必须扩展的现有表/服务及现有模型无法表达的少量不可变实体。
- 已给出统一状态命令表、完整版本冻结向量和向后兼容 migration 路径。
- 主任务的本地开放代码 P0/P1 没有被跳过；外部/人工阻塞均保留真实状态。
- 下一步从 M1 的 Excel/OCR IR 和稳定 canonical hash 开始，先写失败测试，再做最小实现。

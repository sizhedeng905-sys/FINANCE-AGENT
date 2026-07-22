# R7.1 数据生命周期与 Retention Dry-run 报告

更新日期：2026-07-18
分支：`agent/b8-stable-hardening`
状态：`engineering_passed / pending_human_decision(H12,H14)`

## 1. 结论

R7.1 已完成非生产工程框架和自动化验收：系统能够按数据类别创建有界的 retention 盘点任务，使用 PostgreSQL lease 在多实例间原子领取，跳过 legal hold，记录匿名前后计数和审计，并在失败或 lease 过期时安全恢复。

本实现**不删除任何数据**。`DATA_RETENTION_MODE` 只允许 `disabled|dry-run`；非法值（包括 `execute`）会让应用启动失败。数据库同时使用以下约束阻止这一版记录真实删除：

- `retention_runs_dry_run_only`: `dry_run` 必须为 `true`；
- `retention_runs_deleted_count_zero`: `deleted_count` 必须为 `0`；
- `batch_size` 固定为 `1..500`；
- `max_attempts` 固定为 `1..10`。

实际保留天数、删除权限、legal hold 释放、备份/Provider 副本传播和不可恢复删除仍需 H12/H14 签字。在此之前系统保持失败关闭。

## 2. 数据增长面盘点

| 数据类别 | 当前载体 | 内容性质 | R7.1 行为 | 未决门禁 |
| --- | --- | --- | --- | --- |
| `ai_conversation_content` | `AiMessage.content/toolContext` | 用户问题、回答、结构化工具上下文 | 可 dry-run 盘点；legal hold 可保护；不删除 | H12/H14 |
| `ai_provider_payload` | `AiCallLog`、预留 `AiCallAttempt` | Provider 调用审计 | 新调用只保存哈希、字节/字符数、字段名、版本和结果计数；历史旧 payload 仅盘点 | H12/H14 |
| `ai_task_payload` | 预留 `AiTask.input/outputPayload` | AI 任务中间输入/输出 | 当前业务调用链未写入；保留分类与盘点能力 | H12/H14 |
| `ocr_intermediate` | `OcrTask`、`OcrAttempt` | OCR 全文、页/bbox/候选、raw result | active/confirmed 证据标记 protected；failed/cancelled 仅作为 dry-run candidate | H04/H05/H14 |
| `import_intermediate` | `ImportTask/Sheet/Column/Row` | Excel 原值、映射、错误与确认证据 | active/confirmed 证据标记 protected；failed/cancelled 仅作为 dry-run candidate | H03/H14 |
| `notification` | `Notification/Receipt` | 用户通知正文和已读状态 | 可 dry-run 盘点；不删除 | H14 |
| `idempotency_response` | `IdempotencyKey.responseBody` | 首次响应重放事实 | 可 dry-run 盘点；不删除 | H01/H02/H14 |
| `audit_event` | `AuditLog` | 安全/业务审计 | 永久标记 protected，R7.1 不提供删除路径 | H09/H14 |
| `ledger_event` | `LedgerEvent` | 财务事件链 | 永久标记 protected，R7.1 不提供删除路径 | H01/H02/H14 |

静态调用链检查未发现当前业务代码写入 `AiTask`/`AiCallAttempt`；这两张表是模型控制面的预留载体，不据此宣称已有任务清理调用链。OCR 和 Excel 中间结果仍是正式入账的来源证据，不能在 H14 之前由工程代码决定删除。

## 3. AI 审计内容/元数据分离

旧实现把完整问题、全部工具上下文和 Provider 原始响应写入 `AiCallLog.requestPayload/responsePayload`。读取 API 虽会脱敏，但数据库仍长期保存完整内容。

R7.1 起，新调用使用 `ai-call-audit/1.0`：

- 请求只保存 `inputHash/questionHash`、字符数、历史条数/字符数、工具名称、工具数据哈希和顶层字段清单；
- 响应只保存 Provider 响应哈希/字节数、最终回答哈希/字符数、通过 grounding 的 claim 数和 fallback 状态；
- 完整对话仍只存在 `AiMessage` 内容区，归入 `ai_conversation_content`；
- 原始问题、工具值和原始 Provider 响应不再复制到新增 `AiCallLog`；
- 旧日志不做无授权回填或删除，只由 dry-run 盘点并等待 H12/H14。

## 4. API 与权限

| 接口 | 角色 | 行为 |
| --- | --- | --- |
| `GET /api/retention/classes` | `admin`, `auditor` | 查看类别、模式、政策版本和 H 门禁 |
| `GET /api/retention/runs` | `admin`, `auditor` | 分页查看 dry-run |
| `GET /api/retention/runs/:id` | `admin`, `auditor` | 查看匿名计数和状态，不返回 lease token |
| `POST /api/retention/runs` | `admin` | 只允许 `dryRun=true` 和显式历史 `cutoffAt` |
| `GET /api/retention/legal-holds` | `admin`, `auditor` | 分页查看 active hold |
| `POST /api/retention/legal-holds` | `admin` | 对存在的白名单资源建立/强化 hold |

没有 legal hold 释放接口。释放规则和权限未获 H14 批准前，系统选择只增不减的保守行为。`finance/boss/employee/reviewer` 均不能访问 retention 管理接口。

## 5. Lease、重试与证据

- Worker 使用 `FOR UPDATE SKIP LOCKED` 和随机 lease token 原子领取任务；原生 SQL 只返回 ID，再由 Prisma 复读并校验 token，避免列映射歧义。
- 同一任务由两个实例并发处理时只有一个实例取得 lease。
- lease 过期且仍有 attempt 时可重新领取；达到上限后状态变为 `failed` 并写审计。
- 完成更新和完成审计位于同一 PostgreSQL 事务；重放 completed 任务不会新增完成审计。
- 每次仅扫描 `batchSize <= 500`；证据只保存类别计数、保护原因计数和最多 20 个带域 SHA-256，不保存资源 ID、问题、OCR 文本或通知正文。
- Prometheus queue depth 新增 `retention` 类别，统计 `queued/running`。

## 6. 环境变量

```env
DATA_RETENTION_MODE=disabled
DATA_RETENTION_BATCH_SIZE=100
DATA_RETENTION_LEASE_MS=60000
DATA_RETENTION_MAX_ATTEMPTS=3
```

`AI_AUDIT_RETENTION_DAYS` 目前只限制 auditor API 的查询窗口，不是删除政策，也不会触发清理。

## 7. 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端 Jest | 37/37 suites，335/335 tests |
| PostgreSQL 集成 | 6/6 suites，78/78 tests；含双实例 lease、legal hold、匿名证据、重放和耗尽恢复 |
| 大批量回归 | 30,196 行约 20.3 秒；49,999 行约 36.3 秒；连接峰值 10 |
| Prisma migration | 空库 26 条、旧基线 25→26；43 张业务表、29 enum、179 index、79 FK |
| 后端 build | passed |
| 前端 runtime/build | 4/4；Vite 3,144 modules |
| Playwright | 17/17；清理后文件残留 0 |
| Repository hygiene | 615 tracked/candidate files passed |
| 生产依赖审计 | root/backend 均 0 vulnerabilities |

## 8. 仍未完成

- H12：外部 Provider 可发送的数据分类、地域、日志和供应商保留/删除证明；
- H14：每类实际天数、legal hold 创建/释放职责、备份传播、删除复核、恢复窗口和销毁证据；
- 历史 `AiCallLog` 中旧版完整 payload 的处置；
- OCR/Import 正式证据的最小保留集与关联记录删除规则；
- 真实删除演练、备份副本传播验证和生产调度。

因此本阶段只能声明“非破坏性生命周期盘点框架通过”，不能声明“保留政策已执行”或“生产数据已删除”。

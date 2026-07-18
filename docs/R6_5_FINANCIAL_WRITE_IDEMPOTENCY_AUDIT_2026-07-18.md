# R6.5 财务写入口幂等审计

更新日期：2026-07-18
执行分支：`agent/b8-stable-hardening`
状态：工程门禁通过；正式必填范围、跨来源重复和保留期仍待人工决策

## 1. 审计结论

本阶段逐项盘点了会创建或改变财务事实、业务事实、原始证据及其审核状态的入口，并补齐三个工程缺口：

1. 工单、Excel 和 OCR 表中的业务幂等键原先直接保存客户端原值，虽然公共 `idempotency_keys` 表按操作者隔离，但这些全局唯一列会让两个用户使用同一原始键时错误冲突。现统一保存 `idem-v1:<sha256>` 作用域指纹，不保存原始键。
2. 记录编辑、工单草稿编辑和文件上传原先没有公共响应重放。现支持可选 `Idempotency-Key`，同键同请求返回首次状态码和响应，同键不同请求稳定返回 409。
3. 文件上传的并发重放现只保留一个 `RawFile`、绑定、audit 和 ledger；重放请求已经写入对象存储的额外对象会被补偿删除。

这不等于已经决定正式业务去重政策。客户端以新键再次创建相似记录仍可能代表一次合法新业务；是否强制键、键保留多久、什么业务内容应视为重复，以及重复后阻断、合并还是仅提示，分别受 H01/H02/H03/H07/H14 约束。

## 2. 公共契约

| 项目 | 当前实现 |
| --- | --- |
| Header | `Idempotency-Key`；格式为 8-128 个 `[A-Za-z0-9._:-]` 字符 |
| 作用域 | 当前 JWT 用户 ID + HTTP method + 稳定 route + key；资源/项目等请求内容进入请求摘要 |
| 请求摘要 | 对规范化请求对象做稳定 JSON canonicalization 后计算 SHA-256 |
| 持久化 | PostgreSQL `idempotency_keys` 保存操作者、method、route、key、请求哈希、状态和首次响应 |
| 并发 | 事务级 PostgreSQL advisory lock + `(created_by, method, path, key)` 唯一约束 |
| 同请求重放 | 返回首次 HTTP status 和 response body，不再次执行 handler |
| 改体重放 | 409，`reason=IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` |
| 在途请求 | 409，`reason=IDEMPOTENCY_REQUEST_IN_PROGRESS` |
| 非法/缺失键 | 必填入口分别返回 `IDEMPOTENCY_KEY_REQUIRED` 或 `IDEMPOTENCY_KEY_FORMAT_INVALID`；可选入口在缺失时按普通命令执行 |
| 事务失败 | claim 与业务写入同事务回滚；相同 key 可用修正后的请求重新执行 |
| 多实例/重启 | 幂等事实和锁均在 PostgreSQL，API 进程重启或多实例不依赖进程内缓存 |
| 业务列 | 工单、ImportTask、OcrTask 使用 `idem-v1:<scoped sha256>`，避免原始键泄露及跨操作者冲突 |
| 保留 | 当前 `expiresAt=null`，策略标记为 `RETAIN_UNTIL_H14_APPROVED`；删除、legal hold 和备份传播待 R7/H14 |

稳定错误原因是 API 契约的一部分，不依赖中文 message 文案。

## 3. 财务与证据写入口矩阵

### 3.1 文件

| 入口 | 当前幂等边界 | 重复副作用结论 | 未决政策 |
| --- | --- | --- | --- |
| `POST /api/files/upload` | 可选公共 key；请求摘要包含项目/工单、规范文件名、MIME、字节数和 SHA-256 | 同键并发只创建一个文件事实、绑定、audit、ledger；额外对象补偿删除 | H07/H11/H14 决定正式必填、附件归属和保留 |
| `DELETE /api/files/:id` | 项目锁、当前状态和 ledger event key；再次删除返回不存在 | 不重复生成删除事件，不提供首次 HTTP 响应重放 | H07/H14 决定删除、净化和物理清理语义 |
| 签名下载 | 每次签发都是独立安全事件并审计，不接受幂等键 | 不改变财务事实；不会把一次新下载误当旧响应 | H11/H14 决定下载与保留政策 |

### 3.2 工单与审批

| 入口 | 当前幂等边界 | 重复副作用结论 | 契约等级 |
| --- | --- | --- | --- |
| `POST /api/work-orders` | 可选公共 key + `idem-v1` 作用域业务指纹 | 同键同请求精确重放；跨操作者同原始键互不冲突 | 精确响应重放 |
| `PATCH /api/work-orders/:id` | 可选公共 key；摘要含资源 ID 和 DTO | 同键同请求精确重放；改体 409；audit 一次 | 精确响应重放 |
| `POST .../:id/submit` | 行锁、版本和状态机 | 第二次请求被终态/状态规则拒绝，首次副作用不重复 | 等价幂等，不重放首次响应 |
| `POST .../:id/supplement` | 行锁、允许状态和版本 | 每次材料补充是显式新 revision；非法终态拒绝 | 有意多次命令 |
| `POST .../:id/finance-review` | 行锁、角色、状态和事务 | 每个状态迁移只成功一次；审批、时间线、通知和 audit 不重复 | 等价幂等 |
| `POST .../:id/reviewer-review` | 行锁、角色和状态 | 同上；规则复核使用后续状态门禁收敛 | 等价幂等 |
| `POST .../:id/ai-review` | 状态机；已处理返回 `alreadyProcessed` | 不重复生成正式记录或审批 | 显式等价幂等 |
| `POST .../:id/boss-approve` | 必填公共 key + 工单/项目事务锁 | 同键精确重放；并发审批只生成一个 BusinessRecord、审批、时间线、通知、audit、ledger | 精确响应重放 + exactly-once 事实 |
| `POST .../:id/generate-record` | 可选公共 key + 工单锁 + `generatedRecordId` | 重试返回同一记录，不重复入账 | 精确响应重放 + 唯一来源 |
| `POST .../:id/urge` | 行锁和 30 分钟窗口 | 窗口内只产生一次通知/audit；窗口后是有意新催办 | 时间窗等价幂等 |

### 3.3 手工 BusinessRecord

| 入口 | 当前幂等边界 | 重复副作用结论 | 契约等级 |
| --- | --- | --- | --- |
| `POST /api/records` | 可选公共 key + 项目锁 | 同键同请求精确重放；改体 409；事务失败不残留 claim | 精确响应重放 |
| `PATCH /api/records/:id` | 可选公共 key + 项目锁；摘要含 ID/DTO | 同键同请求精确重放；audit 一次 | 精确响应重放 |
| `DELETE /api/records/:id` | 软作废状态机、项目锁和唯一 ledger 语义 | 不物理删除；重复命令不产生第二份事实 | 等价幂等 |
| `POST /api/records/:id/confirm` | 可选公共 key + 状态机/项目锁 | 同键精确重放；已确认记录不能再次改变 | 精确重放 + 终态保护 |

### 3.4 Excel ImportTask

| 入口 | 当前幂等边界 | 重复副作用结论 | 契约等级 |
| --- | --- | --- | --- |
| `POST /api/import-tasks` | 可选公共 key、文件 SHA、`idem-v1` 任务指纹和对象补偿 | 同键精确重放；重复上传对象被清理；跨操作者不冲突 | 精确响应重放 |
| inspect/parse | 服务端状态机、lease、heartbeat 和任务版本 | Worker 重启/租约接管不重复发布正式记录 | 可恢复任务幂等 |
| mapping rules/auto-match/suggestions | 任务版本、状态和关系唯一性；修改形成审核中的新事实 | 不创建正式 BusinessRecord；重复修改按显式 revision 处理 | 审核草稿语义 |
| `POST .../:id/confirm` | 可选公共 key、任务/项目锁、lease、确定性记录 ID、`(importTaskId, sourceId)` 唯一约束 | 浏览器重发、并发、超时和 Worker 恢复不重复生成记录/audit/ledger | 精确重放 + exactly-once 正式事实 |
| `POST .../:id/cancel` | 任务锁和终态状态机 | 与确认竞争有唯一终态；取消后 Worker 不发布记录 | 等价幂等 |

### 3.5 OCR Task

| 入口 | 当前幂等边界 | 重复副作用结论 | 契约等级 |
| --- | --- | --- | --- |
| `POST /api/ocr-tasks`、`POST /api/ocr-tasks/upload` | 可选公共 key + `idem-v1` 任务指纹 | 同键精确重放，跨操作者不冲突 | 精确响应重放 |
| run/recognize/retry/cancel | 持久状态机、任务 lease、heartbeat 和 attempt | Worker 恢复不覆盖成功 attempt，不重复发布记录 | 可恢复任务幂等 |
| corrections/correct | 人工纠错是显式 revision；状态/权限校验 | 不直接生成 BusinessRecord，每次真实修改保留审计 | 审核 revision |
| `POST .../:id/confirm` | 必填公共 key、任务/项目锁、`generatedRecordId` | 同键精确重放；并发只生成一个记录、audit、ledger | 精确响应重放 + exactly-once 正式事实 |

### 3.6 通知、报告和 AI

| 边界 | 当前结论 | 后续要求 |
| --- | --- | --- |
| 通知 read/read-all | `(notificationId,userId)` 唯一收据和状态更新保证重复已读不重复 audit；不是财务事实 | 当前没有外部通知 outbox/retry 接口；M5 增加事务 outbox 后需补独立投递幂等 |
| 现有报表 | 均为确定性 GET 查询，没有持久化“报告生成”写入口 | M6 的不可变 ReportSnapshot 必须增加内容寻址、同事实哈希和并发生成测试 |
| 老板 AI 会话 | 会写会话/消息，但 Provider 无权写财务表；每次提问是有意新消息 | R7 决定日志/消息保留；M6 报告叙述必须绑定 Snapshot，不能复用聊天消息作财务事实 |
| 项目/模板/字段/用户/规则配置 | 受角色、项目锁、唯一约束和 audit 保护，但不属于本阶段“正式财务事实”精确重放范围 | M2/M5 的版本冻结与审批政策会继续收紧；不能用本报告宣称全部管理 API 精确重放 |

## 4. 攻击与故障证据

| 用例 | 断言 |
| --- | --- |
| 两个用户使用相同原始 key 创建工单 | 两个请求均成功且生成不同工单；持久业务列为不同作用域指纹，不含原始 key |
| 同用户同 key 改变 payload | 稳定 409，不改变首次业务事实 |
| 两次并发文件上传 | 返回同一响应；数据库只有一个 RawFile、一个绑定、一个 audit、一个 ledger；额外对象被删除 |
| 记录更新重放 | 返回首次响应，只有一条 update audit |
| 文件上传/记录创建事务失败 | `idempotency_keys` 不残留未完成 claim；修正请求可重试成功 |
| 老板终审并发/重放 | 只有一个正式经营记录及一组审批副作用 |
| Excel 5,001/30,196/49,999 行 Worker 恢复 | 确定性记录 ID 和来源唯一约束阻止重复发布 |
| OCR Worker lease 恢复 | 成功 attempt 与生成记录不重复，旧 Worker 失权 |

## 5. 实际验收证据

| 门禁 | 结果 |
| --- | --- |
| 定向单元 | 4 suites，20 tests，passed |
| 后端全量单元 | 35/35 suites，326/326 tests，passed |
| PostgreSQL 全量集成 | 5/5 suites，75/75 tests，passed |
| Playwright | 17/17 tests，passed；teardown 后文件残留 0 |
| 前端 runtime | 4/4 tests，passed |
| 前端 production build | 3,144 modules，passed |
| 后端 build | passed |
| Prisma migration | 空库 25/25；上一基线 24→25；41 tables、27 enums、173 indexes、77 foreign keys |
| Repository hygiene | 599 tracked/candidate files，passed |
| 依赖审计 | 根目录和 backend 均为 0 vulnerabilities |

大文件抽样仍在既有安全预算内：30,196 行确认约 18.4 秒、RSS 增量约 76.3 MiB；49,999 行约 40.3 秒、RSS 增量约 33.7 MiB。该本机合成结果不是生产 SLA。

## 6. 未决边界与保守行为

- **H01/H02**：尚未批准正式入账粒度、冲销、关账及哪些命令必须强制 key。当前批准/确认入口依靠 key、终态和来源唯一性阻止重复事实，但不自行定义会计政策。
- **H03**：尚未批准 Excel/OCR/手工/工单跨来源业务指纹和处置。当前只生成重复候选，不自动合并、删除或阻断。
- **H07/H11**：附件归属、下载和删除规则未签字。当前文件删除为受审计逻辑状态，安全门禁失败关闭。
- **H14**：idempotency 响应、audit、ledger、原件和备份中的保留/删除传播未签字。当前不自动清理幂等记录。
- 浏览器端当前为每次新命令生成 key。网络丢包后的同一 promise/服务重放安全；浏览器崩溃后若用户重新发起并生成新 key，创建类命令不能在 H03 前猜测其是否重复。
- 通知目前是库内通知且与源事务一起写入；外部投递 outbox 尚待 M5。
- ReportSnapshot 尚待 M6，因此本阶段没有宣称报告生成 exactly-once。

## 7. 回退

本阶段没有数据库 migration。若回退代码，既有 `idempotency_keys` 数据仍可读取；但不得只回退作用域指纹修复而继续依赖工单/import/OCR 的全局唯一原始键，否则会重新引入跨操作者冲突。正式回退前应先运行本报告中的跨操作者、并发上传和事务回滚用例。

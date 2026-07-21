# CR-014 Excel AI 人工审核决定与 Provenance 持久化报告

日期：2026-07-21
分支：`agent/b8-stable-hardening`
状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING`

## 目标

在 CR-013 “AI 建议只进入前端草稿”的基础上，为财务显式保存映射建立服务端可验证、不可静默复用的审核证据。AI 仍无批准权，保存映射不会创建 `BusinessRecord`。

## 实现

- `PUT /api/import-tasks/:id/mappings` 强制携带 `expectedVersion` 与 `expectedReviewRevision`，任务锁内不一致返回 409。
- 新增 `import_ai_review_decisions`，按任务、列、审核修订保存 AI Task、输出哈希、版本向量哈希、sourceRef、冻结模板、建议字段/转换/evidence、最终字段、人工决定、理由、操作者与时间。
- 复用现有 `AiTask`，只接受当前任务最新且成功的 `excel_column_mapping`；项目模板必须仍启用且当前模板版本必须与任务冻结版本一致，旧输出、跨任务 ID、重复使用、篡改哈希和跨模板版本全部失败关闭。
- 服务端从持久化的严格 AI 输出重新推导建议字段，不相信客户端提交的建议值；`accept/edit/ignore` 与最终映射语义再次核对。
- AI 决策、映射、Mapping Profile、audit 与 ledger 位于同一 PostgreSQL 事务；任一校验失败不留下局部记录。
- 新增分页只读接口 `GET /api/import-tasks/:id/ai-review-decisions`，供下一提交的财务确认页展示审计摘要。
- 跨模板或 AI 不可用时前端不提交 AI provenance，完整人工映射路径保持可用。

## 攻击性断言

- 缺少 expected version/revision：400。
- 旧页面版本：409。
- 其他任务的 AI Task、旧 AI 输出、输出哈希篡改、冻结模板不一致：409。
- 项目模板停用：400；模板版本在审核期间漂移：409；两者均不写审核决定。
- `accept` 携带其他字段、`edit` 伪装成 ignore：400。
- 两个并发保存只有一个 200，另一个 409；最终只有一组四条审核决定。
- 同一 AI 输出再次保存：409。
- 测试结束时 AI 审核路径创建的正式业务记录为 0。

## 实际测试

| 门禁 | 结果 |
| --- | --- |
| Prisma 空测试库 reset/deploy | 44 migrations，0 pending，PASS |
| 后端 build | PASS |
| 前端 production build | PASS |
| 后端单元 | 50 suites / 464 tests，PASS |
| AI ingestion PostgreSQL 专项 | 1 suite / 6 tests，PASS |
| PostgreSQL/Redis 全量 | 11 suites / 111 executed tests，PASS；仓库既定 3 suites / 14 tests skipped；276.93 秒 |
| Excel/AI Playwright 专项 | 6 tests，PASS；清理后 0 文件残留 |
| CR-013 远端 Build | run `29831004356`，全部 job PASS |
| CR-013 远端 CodeQL | run `29831004341`，PASS |

## 边界与下一步

- 本提交证明服务端审核证据与并发边界，不证明真实模型准确率。
- 新 migration 为向后兼容增量，并在数据库层约束哈希格式、正审核修订、证据数组及决定/最终状态一致性；旧应用可忽略新表。生产环境不得通过删除该表做回退，以免损失审计事实。
- 全量回归的 30,196 行采样为 39.313 秒、峰值 RSS 增量 709.84 MiB、峰值连接 11；49,999 行为 72.591 秒、72.10 MiB、连接 12。均未越过现有自动门禁，但跨轮次内存波动继续作为目标环境容量风险，不把本机通过写成 H13 已关闭。
- 下一独立提交在第二财务确认页读取分页接口，展示建议、最终值、决定、操作者和哈希摘要，并用 Playwright 证明从 AI 建议保存到确认页的真实链路。
- PR 保持 Draft；三次人工演练、真实财务/OCR/AI 真值、目标 Linux Staging 和 owner UAT 仍未关闭。

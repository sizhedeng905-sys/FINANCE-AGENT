# PR #4 独立审查指南

更新日期：2026-07-17

审查对象：[Draft PR #4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)，分支 `agent/b8-stable-hardening`。本指南帮助 reviewer 按风险顺序审查，不代表独立 Review 已完成。

## 1. 推荐顺序

1. 数据库 migration、Decimal、数据层与不可变日志。
2. JWT/Cookie/角色/归属和跨账号隔离。
3. Excel/OCR/工单状态机、幂等、lease 和 shutdown。
4. 上传解析、ClamAV、S3/本地路径与对象对账。
5. AI Claim、模型部署快照、GPU 切换和 Provider 降级。
6. 前端 API/Mock、Decimal、轮询、错误和首页统计。
7. API/Worker、Redis、观测、TLS、备份恢复和发布回退。
8. CI、DLP、供应链与 RC 文档结论。

## 2. 高风险域

| 域 | 优先文件 | 必须保持的不变量 | 重点测试 |
| --- | --- | --- | --- |
| 财务记录 | `records/`, `reports/`, `record-value.ts` | 金额不经 JS float；只聚合 confirmed actual；来源快照不可漂移 | `reports-record-generation`, `finance-uat`, PostgreSQL golden cases |
| Migration | `backend/prisma/migrations/`, `schema.prisma`, `runtime-grants.sql` | 24 条可从空库执行；23→24 可升级；runtime 不可修改 audit/ledger | `db:migration-paths`, `db:verify` |
| 认证权限 | `auth/`, `users/`, guards、前端 auth/store reset | role/userId 只信 token；停用/角色/密码变化撤销旧 token；owner 隔离 | `auth-security`, `app`, `auth-and-errors` |
| 状态机 | `import-tasks/`, `ocr/`, `work-orders/`, `idempotency/` | 终态不可旁路；同 key 同响应、改体 409；旧 lease 不可迟到提交 | PostgreSQL integration、`work-orders`, `ocr` |
| Worker | `worker/`, recovery services | durable queue 是事实源；shutdown 等待当前和恢复任务；失败不永久 processing | `worker-shutdown`, integration recovery cases |
| 文件 | `files/`, `file-security/`, storage adapters | 路径/对象键受控；扫描 fail-closed；未知竞态对象不误删；下载再鉴权 | `file-security`, `s3-storage`, upload resource tests |
| AI | `ai/`, `ai-answer-grounding.service.ts` | Claim 绑定 scope/period/metric/value/sourcePath；失败明确 fallback；会话 owner 隔离 | `ai`, `ai-claims`, AI benchmark、PostgreSQL golden cases |
| 模型 | `model-runtime/`, model scripts、Paddle adapter | 健康与执行使用同一部署快照；ready 认证；GPU 切换互斥并恢复文本 | `model-runtime`, lock test、真实 model resilience |
| 前端 | `src/api/`, stores、角色首页 | API 失败不回退 Mock；会话切换无旧缓存；Decimal 不转 Number；统计来自服务端 | 16 项 Playwright、frontend build |
| Staging | `deploy/staging/`, Dockerfiles、entrypoint | 仅 TLS gateway 暴露；三 DB 账号；secret 不入镜像；恢复需显式确认 | `staging-deployment`, config check、shell syntax |
| 可观测性 | `observability/`, Redis infrastructure | trace queue 有界；shutdown 尽量排空；Redis 健康后短断可恢复 | `observability`, `http-security` |

## 3. Migration 人工检查

- 逐条确认 24 个目录按时间排序且均有 `_prisma_migrations` 记录。
- 重点检查 `audit_financial_invariants`、`background_import_progress`、`record_provenance_snapshots`、`record_data_layers`、`b8_idempotency_keys`、`b8_background_confirmation`、`b8_ocr_async_precision`、`b8_security_boundaries` 和 `b8_model_control_plane`。
- 确认最新 migration 只有 nullable 列、索引和外键增量，不删除或重写历史金额。
- 检查 `runtime-grants.sql` 对 `audit_logs`、`ledger_events` 的 UPDATE/DELETE/TRUNCATE revoke。
- 运行 `npm run db:migration-paths --prefix backend`，不得只看已有开发库 status。

## 4. 必问问题

- 任一 API 是否信任 body/query 中的 `role`、`creatorId`、`targetUserId` 或 owner ID？
- 任一 confirmed 记录、audit 或 ledger 是否能被普通 runtime 覆盖/删除？
- 任一金额是否经过 `Number()`、float JSON 或非 Decimal 求和？
- cancel/confirm、approve/reject、retry/cancel、双 Worker 是否共享同一确定性锁/版本条件？
- 上传失败后数据库、隔离区、对象存储和临时文件是否一致清理？
- Provider 不可用、返回错 scope/period/value 时是否会被误呈现为真实答案？
- 退出、401、账号切换和多标签页是否能看到前一个账号数据？
- shutdown 是否等待正在执行的任务，同时有上限避免无限挂起？

## 5. Reviewer 最小命令

```bash
npm ci
npm ci --prefix backend
npm run build
npm run build --prefix backend
npm test --prefix backend -- --runInBand
npm run test:integration --prefix backend
npm run test:e2e
npm run db:migration-paths --prefix backend
npm run check:hygiene
npm run staging:check
```

目标 Staging 还必须执行 `npm run staging:release`，并保留 smoke、restore drill、RPO/RTO、告警送达和 rollback 证据；当前本地 registry TLS 阻塞不能视为通过。

## 6. PR 关系与签字

PR #1 至 #4 均为开放 Draft 且 base 为 `main`。PR #4 是当前聚合分支，包含此前阶段历史；不要在未决定合并顺序时机械合并多个 Draft。独立 reviewer 应把意见写入 PR #4，P0/P1 必须有复现、修复提交和防回归测试后才能关闭。

需要的最终签字：代码 owner、安全负责人、财务负责人、业务负责人和老板。Codex 自动化结果不能代签。

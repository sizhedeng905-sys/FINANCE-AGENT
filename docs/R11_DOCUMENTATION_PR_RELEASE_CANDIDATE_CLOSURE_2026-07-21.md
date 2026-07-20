# R11 文档、Draft PR 与发布候选收口报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally / blocked_external / awaiting_human_signoff`
> 分支：`agent/b8-stable-hardening`
> Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)

## 1. 基线与边界

- R11 开始时本地/远端共同 HEAD：`dded264`（R10 L0）。
- 远端 run `29768468874` 的 PostgreSQL/E2E job 在 30,196 行最终发布处超时；CodeQL 和应用镜像 job 通过。
- R9.3B 修复提交 `cc033d4` 与 R11 文档提交 `9e889bb` 已正常推送；此前两次网络失败后先完成独立本地工作，仅在 443 探针恢复后重试。未 force push、未 rebase、未改写历史。
- PR #4 保持 Draft，不标记 Ready、不合并。3/3 历史 CodeQL threads 已 resolved/outdated，但不替代新 head 检查。
- 用户未跟踪文档、本地模型、真实数据、`.env`、IDE 配置和下载脚本均未纳入提交。

本报告只关闭本地可执行的 R11 工程文档子项。H13/H15/H16 和其他真实业务证据未完成，因此候选不是 production-ready，也不能开始真实用户试运行。

## 2. 文档交叉检查

| 领域 | 复核文档 | R11 结论 |
| --- | --- | --- |
| 项目总览 | `README.md`, `backend/README.md`, `IMPLEMENTATION_PROGRESS.md` | 当前候选统一为 428 unit、114 PostgreSQL/Redis integration、17 Playwright；区分本地、远端和人工门禁 |
| 架构与数据流 | `ARCHITECTURE.md`, `SECURITY.md` | AI 只建议；Decimal/固定查询负责算账；Excel 哈希预检受 lease/version 围栏保护，最终事务重新鉴权并原子发布 |
| 环境与运行 | `LOCAL_SETUP.md`, `backend/.env.example`, `backend/.env.test.example` | production 四类共享控制必须为 Redis；非法/缺失关键配置失败关闭；secret 不进入 Git |
| Staging/生产边界 | `B8_09_STAGING_RUNBOOK.md`, `B8_09_STAGING_REPORT.md`, topology template | 本机隔离 smoke 不冒充目标环境；Compose 继续单 API/单 Worker；横向 release/restore/rollback 待 H13/H14 |
| Migration/seed | `backend/prisma/schema.prisma`, 41 migrations, seed, `API_MIGRATION_MATRIX.md` | 空库 41 条、40 到 41 升级有证据；本轮无 schema/migration 变化；seed 仅合成数据 |
| 备份/恢复/回滚 | R4/R5/R8.6 报告与 Staging runbook | 单机恢复不称异地灾备；真实 RPO/RTO、云备份、密钥和跨版本回退待 H13/H14 |
| Excel/OCR/AI | M1-M7 报告、`MODEL_DEPLOYMENT.md` | Mock/Local/External 明确分层；模型健康/L0 不等于业务准确率；OCR 未执行的预处理不写成已实现 |
| 测试与风险 | `E2E_ACCEPTANCE.md`, `B8_BLOCKER_MATRIX.md`, 本报告 | 当前数字与实际命令一致；目标容量、真值、签字继续保留红灯 |
| PR 审查 | `PR_PREPARATION.md`, `PR4_REVIEW_GUIDE.md` | 提交分组、审查顺序、高风险文件、强制 Redis 测试条件和回滚边界已写明 |

## 3. 本轮纠正的过期表述

1. 删除登录、上传和模型门仍为 process-local 的旧说明，统一为 Redis 原子共享控制和断连失败关闭。
2. 当前候选测试数从历史 410/97、428/113 更新为实际 428/114；历史阶段报告保留其当时数字。
3. R8.2-R8.9 区分已完成的工程/CI 路径与尚未执行的目标 self-hosted Staging。
4. 大批量 Excel 不再只引用 167.004 秒窄余量；新增 R9.3B 根因、25.502/42.954 秒结果和远端复跑要求。
5. 明确 L0 只证明资产、鉴权、容器与合成推理契约；H04/H05 真实 OCR 和业务准确率未通过。
6. 明确 step-up 是单次密码二次确认框架，不是 MFA；正式 SoD、自审批和账号责任人仍待 H10 签字。
7. 明确 retention 仍为 dry-run，S3 逻辑容量不是物理容量，外部 Provider 在 H12 前失败关闭。

## 4. 当前自动化证据

| 门禁 | 命令/场景 | 结果 |
| --- | --- | --- |
| Backend build | `npm run build` in `backend` | exit 0；Prisma generate + application/scripts TypeScript |
| Backend unit | `npm test -- --runInBand` in `backend` | 47/47 suites，428/428 tests，0 failure，23.279 s Jest |
| PostgreSQL/Redis integration | `TEST_REDIS_URL=redis://127.0.0.1:6379 REQUIRE_REDIS_INTEGRATION=true npm run test:integration` | 13/13 suites，114/114 tests，0 skip/failure，198.807 s |
| Finalization recovery | injected Prisma `P2028` after integrity preflight | recovered lease, 1,001 records once, one terminal batch ledger event |
| Large Excel | 30,196 and 49,999 rows | 25.502/42.954 s in full run；record/value/source/Decimal/audit/ledger/report closure passed |
| Frontend runtime | `npm run test:runtime` | 4/4 passed |
| Frontend/backend production build | root and backend build | passed；Vite 3,147 modules |
| Playwright | `npm run test:e2e` | 17/17 passed；teardown file artifacts 0 |
| Migration paths | `npm run db:migration-paths --prefix backend` | empty 41 and predecessor 40 to 41 passed；222 indexes、89 foreign keys |
| Production dependency audit | root and backend | 0 vulnerabilities |
| Repository hygiene | `npm run check:hygiene` | 720 tracked/candidate files passed after adding this report |

前端、Playwright、migration、Staging 脚本和依赖审计来自本轮 R11 候选的既有实际执行；R9.3B 只修改后端导入确认和测试，之后已重新执行 backend build、unit、完整 PostgreSQL/Redis integration。最终提交前仍会重跑受影响的快速门禁与 hygiene。

## 5. GitHub 与远端门禁

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| Local R9.3B commit | `passed` | `cc033d4`，3 个文件，staged hygiene 通过 |
| Push | `passed` | 远端分支 head 为 `9e889bb` |
| Draft PR #4 | `open_draft` | 不 merge、不 Ready |
| Last remote CodeQL | `passed` | run `29768468872`，只覆盖远端 `dded264` |
| Last remote application image | `passed` | run `29768468874` application job，只覆盖远端 `dded264` |
| Previous remote PostgreSQL/E2E | `failed` | run `29768468874`，30,196 行终态超时；保留为 R9.3B 红灯证据 |
| New head checks | `in_progress` | Build `29771646166`、CodeQL `29771646143`，覆盖 head `9e889bb` |

下一顺序固定为：等待 Build/CodeQL 全部结束，核对 job 日志和 review threads，再更新本报告。旧 run 不能作为新 head 的绿色证据。

## 6. H01-H16 发布影响

| 分组 | 当前状态 | 保守行为 |
| --- | --- | --- |
| H01/H03/H10 | 决策已记录，待真实样例/正式签字 | 每行明细、重复只提示、禁止上传者自审批；step-up 默认关闭 |
| H02/H06-H09/H11/H12/H14 | `pending_human_decision/evidence` | 负数拒绝、分币不合并、附件/下载保守、外部 AI 关闭、retention 仅 dry-run |
| H04/H05 | `awaiting_real_evidence` | 不声明 OCR 字段准确率或盲测通过，低置信/冲突转人工 |
| H13 | `blocked_external` | 不声明目标 Staging、容量、监控、GPU、云存储或恢复通过 |
| H15 | `blocked_external` | Codex 自动化不能替代外部独立代码/安全审查 |
| H16 | `awaiting_human_signoff` | 不标 Ready、不合并、不部署、不开放真实用户 |

## 7. R11 关闭判断

- 文档事实一致性：`engineering_verified_locally`。
- 当前 commit 全部适用本地门禁：`passed`。
- GitHub 新 head 门禁：`in_progress`，尚不能记作通过。
- H15 独立复核：`blocked_external`。
- H16 五方 UAT/Go-Live：`awaiting_human_signoff`。

因此 R11 的本地工程与文档部分已提交并推送，但“最终发布候选完成”的总条件尚未满足。下一动作是等待新 head CI，再由外部 reviewer 和负责人完成 H15/H16；在此之前保持 Draft。

# GitHub Draft PR 准备

更新日期：2026-07-20

## 当前 PR

- 仓库：`sizhedeng905-sys/FINANCE-AGENT`
- 分支：`agent/b8-stable-hardening`
- 目标：`main`
- Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 状态：保持 Draft，不 merge、不标记 Ready
- 远端状态：本地分支相对已知远端领先；此前两次推送因 `github.com:443` 连接失败，只有网络探针恢复后才重试

PR #4 是 B8 稳定化、R 系列补救和 M0-M8 AI 映射补充任务的累计审查入口。自动化工程门禁通过不等于真实财务验收、目标环境验证或生产授权。

## 当前范围

- R1-R8.9：前端真实性、安全日志、容量语义、备份恢复、供应链、财务并发/Decimal/幂等、retention dry-run、step-up 框架和本机 Staging 工程。
- M0-M2：现有 Excel/OCR/Provider/Worker 复用、版本化证据 IR、严格 AI Schema、模式与 kill switch、不可变 Prompt Registry 和完整调用版本向量。
- M3-M4：Excel 列级 AI 建议、Mapping Profile、OCR evidence 建议、review revision、ValidationSnapshot 和 bbox 人工复核。
- M5：OCR/Excel 双人财务批准、最终重鉴权、禁止上传者自审批、幂等批准快照和事务写入。
- M5.2：按 H01 每个有效明细行生成一条记录；普通错误明细不能被排除后部分发布，疑似汇总行必须由财务处置，整批失败关闭。
- M6-M7：canonical ReportSnapshot、Decimal/分币种固定查询、严格 Claim grounding、并发快照复用、攻击性测试、Provider 降级和资源边界。
- M8：架构/API/运行手册、迁移路径、Prompt 漂移、最终证据、README 和 Draft PR 交接。

## 数据库迁移

当前 Prisma 目录共 41 条 migration。M0-M8 的增量为：

```text
20260719000000_ingestion_ir_evidence
20260719010000_ai_prompt_registry_contracts
20260719020000_mapping_profile_structure_scope
20260719021000_mapping_profile_rule_constraints
20260719030000_ai_task_request_identity
20260720161500_ai_task_execution_lease
20260720173000_ocr_review_revisions
20260720203000_ocr_approval_snapshots
20260720220000_excel_review_validation_snapshots
20260720233000_report_snapshots_and_grounded_narratives
20260720234000_report_audit_maintenance_guard
20260720235000_remove_unused_currency_write_index
20260720235500_report_narrative_version_identity
```

已验证空库安装 41 条和上一版本 40→41 升级；最终结构含 222 个索引和 89 个外键。migration 为前向流程，生产不得运行 `prisma migrate dev` 或开发 seed。

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
```

## 配置边界

- 必需：`DATABASE_URL`、高熵 `JWT_SECRET`、`PORT`；production 还要求明确的 CORS、TLS、存储、扫描、Redis、Metrics 和 OTLP 配置。
- `AI_INGESTION_MODE`、`AI_REPORT_MODE` 只接受 `disabled|suggest`，缺失默认 `disabled`。
- `AI_GLOBAL_KILL_SWITCH` 优先于项目、模板和在途任务的新 Provider 调用。
- 外部 Provider 在 H12 未批准时拒绝真实或未知数据；失败转人工，不静默冒充 Mock 成功。
- 默认文本模型与 OCR 常驻，VL/Embedding 按需；模型资产不得提交 Git。

完整清单见 `backend/.env.example`、`backend/.env.test.example` 和 `docs/LOCAL_SETUP.md`。

## 当前自动化证据

2026-07-20 M7 全量基线：

| 门禁 | 结果 |
| --- | --- |
| 后端 Jest | 47/47 suites，410/410 tests |
| PostgreSQL 集成 | 10/10 suites，97/97 tests |
| Playwright API | 17/17 tests，teardown 后 0 文件残留 |
| Migration | 空库 41；40→41；222 indexes、89 foreign keys |
| 前端 runtime | 4/4 |
| 前后端 build | 通过；Vite 3,147 modules |
| 依赖审计 | 根目录与 backend 均 0 vulnerabilities |
| Repository hygiene | M7 706；M8 文档加入后 708 tracked/candidate files |
| Prompt 漂移定向 | 4/4 unit + 3/3 PostgreSQL；manifest/seed/Schema/hash 漂移失败关闭 |

49,999 行 Worker 的两次全量样本为 46.014 秒和 143.199 秒，均低于现有 180 秒断言，但波动明显；不得据此宣称目标环境稳定 p95。

## Reviewer 检查顺序

1. 先读 `docs/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md` 和 `docs/B8_BLOCKER_MATRIX.md`，确认没有把 H 门禁写成完成。
2. 核对 M5.2：错误明细不能被排除，汇总候选必须显式处置，最终 staging 只能整批原子发布。
3. 核对 M5：最终事务重读账号、角色、项目、来源、模板、证据、版本和 hash，上传者不能自审批。
4. 核对 M2-M4：AI 仅能引用服务端模板/字段/transform/evidence 白名单，输出不能到达正式记录写服务。
5. 核对 M6-M7：报告只读 `confirmed + actual`，Decimal 分币种，AI Claim 必须逐项与 Snapshot JSON Pointer 一致。
6. 核对 41 条 migration 的空库与升级路径、唯一约束、不可变触发器和回滚边界。
7. 查看 `docs/PR4_REVIEW_GUIDE.md` 执行独立代码/安全审查；在 H15/H16 前保持 Draft。

## 回滚原则

- 应用回滚到已锁定的上一镜像/提交；旧代码应忽略新增表和可空字段。
- 数据库 migration 不自动向下回滚。先停止写流量并保护当前快照，再使用已验证 manifest 做隔离恢复或受控前向修复。
- 导入/OCR 已提交数据通过批准快照、source、commit、audit、ledger 和 idempotency 关联定位，不物理删除审计链。
- AI 可用全局 kill switch 立即停止新调用；手工映射和人工复核路径保持可用。
- ReportSnapshot、Narrative 和 Claim 是不可变审计事实；临时 Provider payload 清理不能删除 canonical Snapshot。

## 未关闭门禁

- `M0-INPUT-001`：受保护的 `docs/ai/FINANCE_AGENT_AI_PROMPT_CATALOG_V0_1.md` 当前为 0 字节，运行时固定 manifest 已验证，但无法逐字核对目录正文。
- H01：每行明细规则已实现；真实汇总行样例、识别特征和正式签名未齐。
- H02/H07/H10/H11/H12/H14：负数/更正、附件清单、职责分离/MFA、文件政策、外部 Provider 和保留期限仍缺正式执行清单。
- H04-H09：OCR/AI 真值、真实逐分对账、报表口径和不可重识别脱敏仍需独立人工证据。
- H13：目标 Linux、域名、GPU、对象存储、告警、RPO/RTO 和正式容量预算未提供。
- H15/H16：独立代码/安全 Review 与最终 UAT/Go Live 未完成。
- GitHub push、远端 Build/CI 和 Draft PR 更新在网络恢复前为 `blocked_external`。

## 提交边界

只暂存明确列出的跟踪实现和公开汇总文档。`.env`、模型权重、下载脚本、真实/本地数据、上传物、证书、`.realdata-test/`、测试录像和用户未跟踪资料不得进入提交。不得 force push、历史改写、merge 或标记 Ready。

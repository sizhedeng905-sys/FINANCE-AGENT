# M8 最终证据与 Draft PR 交接报告

> 日期：2026-07-20
> 状态：`engineering_passed_with_external_and_human_gates`
> 适用范围：非生产工程框架、合成/匿名样本和本机 PostgreSQL
> 禁止解读：真实准确率通过、财务 UAT 完成、目标 Staging 通过或 production-ready

## 1. 基线

```text
仓库：sizhedeng905-sys/FINANCE-AGENT
分支：agent/b8-stable-hardening
M0 审计基线：66a5ee2c919374edb74411621aedc82185077f34
M8 内容基线：a457a9a34e0f42dd59fe4f5e95c88e39bf5f5e0b
结束 HEAD：本报告所在 M8 提交，以 Git 元数据为准
Draft PR：https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4
工作区剩余改动：提交后仅允许受保护的用户未跟踪资产
远端：M8 提交 30c6ead 已推送至 Draft PR #4；后续 CI 状态见 M8.1 补充报告
```

受保护未跟踪资产包括本地模型/下载脚本、用户提示词与需求文档、IDE 配置和 `人工复核.md`。本轮未读取 `.env` 内容，未移动、删除、修改或暂存上述资产。两个任务输入文件当前均为 0 字节：

- `docs/ai/FINANCE_AGENT_AI_PROMPT_CATALOG_V0_1.md`
- `docs/CODEX_FINANCE_AGENT_AI_MAPPING_PIPELINE_SUPPLEMENT_2026-07-18.md`

第二份补充任务的正文来自本次会话并已作为执行约束；空文件本身仍保持用户资产原状。Prompt Catalog 无正文可供逐字对照，因此 `M0-INPUT-001` 保持 `blocked_external`。

## 2. M0-M8 状态

### M0

```text
阶段：M0 现状审计与复用设计
状态：passed
实际实现：完成 Excel/OCR/Provider/Worker/审批/审计/报告调用链、复用矩阵、状态命令表、最小 migration 与版本向量设计；没有创建平行 ingestion/prompt 系统。
关键文件：docs/汇报/M0_AI_MAPPING_REUSE_AUDIT_2026-07-18.md
数据库 migration：无
攻击性测试：设计阶段，后续由 M1-M7 落地
提交 SHA：5ddb10c
剩余风险：Prompt Catalog 正文为空；H01-H16 不由 M0 代决
下一动作：保留 Catalog 阻塞，继续使用现有实体和失败关闭策略
```

### M1

```text
阶段：M1 规范化中间模型与取证
状态：passed
实际实现：Excel/OCR 版本化 IR、稳定 source/evidence ref、lexical/display/formula/cache、页/token/block/bbox、规范化 hash、大小预算与分页。
关键文件：docs/汇报/M1_INGESTION_IR_EVIDENCE_REPORT_2026-07-18.md
数据库 migration：20260719000000_ingestion_ir_evidence
攻击性测试：公式、日期系统、隐藏/合并表头、bbox 越界、重复/空 token、恶意文本
提交 SHA：5ae374e
剩余风险：真实 OCR 真值与旋转/清晰度效果待 H04/H05
下一动作：只在冻结 IR 和来源 hash 上生成建议
```

### M2

```text
阶段：M2 版本化模板、Prompt Registry 与 Schema 防线
状态：engineering_passed / blocked_external(M0-INPUT-001)
实际实现：固定 9 项 prompt manifest、finance_core_guard、严格 JSON/白名单、完整调用版本向量、disabled|suggest、全局 kill switch、外部 Provider 失败关闭。
关键文件：backend/src/ai/structured-suggestion；backend/src/ai/ai-prompt-registry.service.ts；docs/汇报/M2_AI_GUARDRAILS_AND_PROMPT_REGISTRY_REPORT_2026-07-18.md
数据库 migration：20260719010000_ai_prompt_registry_contracts
攻击性测试：Markdown/重复 key/原型污染/深度与大小/未知 ID/Unicode 控制字符/非法状态
提交 SHA：cd9afa1、ff213b6、b23c351、b5ca204
剩余风险：0 字节 Prompt Catalog 无法逐字核对；外部 Provider 继续受 H12 禁用
下一动作：Catalog 有正文后只做映射审计，不改写旧版本
```

### M3

```text
阶段：M3 Excel 分类映射与 Mapping Profile
状态：passed
实际实现：结构指纹、项目/模板范围、Profile 失效/撤销、列摘要一次 AI 建议、严格候选白名单、调用租约/恢复、全量确定性转换和服务端分页。
关键文件：docs/汇报/M3_1_MAPPING_PROFILE_STRUCTURE_SCOPE_REPORT_2026-07-18.md；docs/汇报/M3_2_EXCEL_AI_SUGGESTION_REPORT_2026-07-20.md
数据库 migration：20260719020000、20260719021000、20260719030000、20260720161500
攻击性测试：跨项目 Profile、结构/hash 篡改、kill switch、迟到响应、模板中途停用、恶意 JSON
提交 SHA：2243adf、b5467e6、6b33982、54234c9
剩余风险：真实业务列别名和模型建议准确率待 H 门禁
下一动作：Profile 只预填建议，始终要求财务批准
```

### M4

```text
阶段：M4 OCR 分类映射与证据复核
状态：engineering_passed / awaiting_human_signoff(H04,H05)
实际实现：OCR evidence 白名单、分类/映射建议、跨页冲突、review revision、内容寻址 ValidationSnapshot、鉴权 PDF 预览和 bbox 高亮。
关键文件：docs/汇报/M4_OCR_AI_EVIDENCE_REVIEW_REPORT_2026-07-20.md
数据库 migration：20260720173000_ocr_review_revisions
攻击性测试：空文本、坐标越界、无证据、跨页冲突、未知旋转、旧校验重放、390px UI
提交 SHA：45dc241、a19d892、5518f76
剩余风险：17 份真值、5 份盲测和阈值未冻结
下一动作：真实准确率保持未声明，所有结果继续人工复核
```

### M5

```text
阶段：M5 财务审核、事务入库与审计
状态：engineering_passed / awaiting_human_signoff(H01,H10)
实际实现：OCR/Excel expected version/hash 命令、人工 revision 使旧校验失效、第二财务、最终事务重鉴权、不可变批准快照、幂等 commit、audit/ledger/outbox；H01 按每个有效明细行一条记录并整批失败关闭。
关键文件：docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md；docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md
数据库 migration：20260720203000_ocr_approval_snapshots；20260720220000_excel_review_validation_snapshots
攻击性测试：上传者自审批、角色/账号/项目变化、双财务并发、同键重放/改体、取消竞争、旧快照、最终事务故障回滚
提交 SHA：ae003e9、26412a0
剩余风险：真实汇总行样例、正式职责分离/MFA 和签名未齐
下一动作：未处置汇总候选或任一阻断错误继续整批拒绝
```

### M6

```text
阶段：M6 ReportSnapshot 与 AI 叙述
状态：engineering_passed / pending_human_decision(H06,H08)
实际实现：repeatable-read canonical Snapshot、confirmed+actual 固定查询、Decimal 分币种、稳定来源 digest/hash、严格 Narrative/Claim validator 和 sourcePath 证据。
关键文件：docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md
数据库 migration：20260720233000、20260720234000、20260720235000、20260720235500
攻击性测试：数字篡改、额外实体/原因/比较、warning 遗漏、无数据、混合币种、不可变行、Provider 非 JSON/超时
提交 SHA：2e976c6
剩余风险：正式日报/周报口径、真实逐分对账和老板标准答案未签字
下一动作：AI 只生成 NEEDS_FINANCE_REVIEW 叙述，不计算或修改金额
```

### M7

```text
阶段：M7 攻击性测试、性能预算和 Provider 降级
状态：engineering_passed / blocked_external(H12,H13,H15,H16)
实际实现：修复六路相同 Snapshot 并发偶发 409；补齐权限、kill switch、并发单 Provider、超时脱敏、截断 JSON、4,999-50,001 行、文件字节、Worker 恢复和模型健康回归。
关键文件：backend/src/reports/report-snapshots.service.ts；docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md
数据库 migration：无
攻击性测试：47/47 unit suites、10/10 PostgreSQL suites、17/17 Playwright 及 Staging/供应链定向门禁
提交 SHA：a457a9a
剩余风险：49,999 行存在性能波动；目标 Linux、外部 Provider 和独立审查未执行
下一动作：在 H13 目标环境重测并建立 p95，未批准外部 Provider 继续关闭
```

### M8

```text
阶段：M8 文档、迁移证据与 Draft PR 收口
状态：engineering_passed / blocked_external(M0-INPUT-001) / awaiting_human_signoff
实际实现：更新架构、API、E2E、本地运行、PR review/准备、README、状态矩阵和本报告；复核 41 条 migration 双路径及 Prompt manifest/seed/Schema/hash 漂移门禁。
关键文件：docs/ARCHITECTURE.md；docs/汇报/API_MIGRATION_MATRIX.md；docs/E2E_ACCEPTANCE.md；docs/LOCAL_SETUP.md；docs/PR4_REVIEW_GUIDE.md；docs/计划/PR_PREPARATION.md；本报告
数据库 migration：无；复用空库 41 与 40→41 证据
攻击性测试：Prompt 漂移 4/4 unit + 3/3 PostgreSQL；M7 全量证据保持有效
提交 SHA：本报告所在提交，以 Git 元数据为准
剩余风险：Prompt Catalog 为空、GitHub Actions Node 20 弃用提醒、H01-H16 未全部关闭
下一动作：处理真实人工/目标环境门禁；不 merge、不标记 Ready
```

## 3. 测试证据

### 后端单元

```text
命令：cd backend && npm test -- --runInBand
退出码：0
结果：47/47 suites，410/410 tests
耗时：21.334 s（M7 最终全量）

命令：cd backend && npm test -- --runInBand test/ai-prompt-registry.spec.ts
退出码：0
结果：1/1 suite，4/4 tests
耗时：2.844 s（M8 定向）
```

### PostgreSQL 集成

```text
命令：cd backend && npm run test:integration
退出码：0
结果：10/10 suites，97/97 tests
耗时：189.756 s（M7 最终全量）

命令：cd backend && node scripts/run-integration-tests.mjs test/integration/ai-prompt-registry.integration-spec.ts
退出码：0
结果：1/1 suite，3/3 tests
耗时：2.785 s Jest；8.4 s 端到端命令（M8 定向）
```

### 前端与浏览器

```text
命令：npm run test:runtime
退出码：0；4/4
命令：npm run build
退出码：0；Vite 3,147 modules
命令：npm run test:e2e
退出码：0；17/17，56.7 s，teardown 后 0 文件残留
```

### Prisma 与 migration

```text
命令：cd backend && npm run db:migration-paths
退出码：0
结果：空库 41；40→41；222 indexes；89 foreign keys
补充：M8 Prompt PostgreSQL 定向测试再次从空库应用 41/41 且无 pending migration
```

### Docker、Staging、供应链与安全

```text
npm run staging:config:test                    -> 3/3
npm run staging:sbom:test                      -> 7/7
npm run staging:logs:test                      -> 4/4
npm run staging:backup-integrity:test          -> 9 cases
npm run staging:image-integrity:test ...       -> 17 attack cases；fixture 已清理
npm run check:hygiene                          -> 708 tracked/candidate files
npm audit --omit=dev --audit-level=high        -> 0 vulnerabilities
cd backend && npm audit --omit=dev --audit-level=high -> 0 vulnerabilities
```

本轮 M7/M8 没有重跑完整 18 服务 release/restore/rollback。R8.6 的本机历史证据仍可审计；R8.7 完整重验受 Debian security 502 阻断，H13 目标 Linux 从未被本机证据替代。

### Provider、Worker 与资源

```text
30,196 行：revalidate 2.998 s；API 26 ms；Worker 26.206 s；RSS +239.13 MiB；连接峰值 10
49,999 行：revalidate 5.964 s；API 40 ms；Worker 46.014 s；RSS +167.79 MiB；连接峰值 11
上一轮 49,999 行 Worker：143.199 s
模型：Qwen 文本 13 文件/9.31 GiB；PaddleOCR 23 文件/2 GiB
常驻：qwen-text、paddle-ocr healthy；按需：VL、Embedding expected_offline
```

资源结果证明有界处理和现有 180 秒断言，不证明目标机器稳定 p95。

## 4. 人工与外部阻塞

| 编号 | 当前状态 | 不能由 Codex 决定的原因 | 已完成安全框架 | 最小所需证据 | 缺失时保守行为 |
| --- | --- | --- | --- | --- | --- |
| H01 | awaiting_human_signoff | 真实汇总行特征与正式业务签字 | 每行明细、汇总候选、整批失败关闭 | 1-2 个匿名真实汇总/明细样例及签名 | 未处置候选禁止批准 |
| H02 | pending_human_decision | 负数白名单、冲销/更正和重述是会计政策 | Decimal、软作废保留历史、自动冲销关闭 | 模板级负数/更正规则 | 非正数继续拒绝或人工处理 |
| H03 | pending_human_decision | 正式跨来源重复指纹和动作需业务决定 | 候选提示、幂等、人工复核 | 匿名重复/非重复样例及动作矩阵 | 不自动合并或删除 |
| H04/H05 | awaiting_human_evidence | OCR 真值和盲测需独立标注 | OCR IR、bbox、人工 override、零自动入账 | 17 份真值、5 份盲测及阈值 | 全部人工复核，不声明准确率 |
| H06/H08 | pending_human_decision | 正式指标、周期和老板答案是业务口径 | fixed query、Decimal、Snapshot/Claim | 逐分对账、指标定义、标准答案 | 分币种保守报告，AI 需复核 |
| H07 | pending_human_decision | 模板必填附件清单未给出 | 多附件、审计、缺失阻断策略点 | 各模板附件清单与覆盖规则 | 未知要求不自动放行 |
| H09 | awaiting_human_evidence | 脱敏不可重识别需独立评估 | 最小化、hash 元数据、日志脱敏 | 脱敏样本和攻击复核 | 不外发真实数据 |
| H10 | pending_human_decision | 正式职责分离、MFA、例外需负责人批准 | 禁止上传者自审批、step-up 默认关闭 | 角色矩阵、MFA/例外流程 | 保守双人财务审批 |
| H11/H14 | pending_human_decision | 文件准入、下载、保留/删除和 legal hold 属于治理政策 | 安全门禁、私有存储、retention dry-run、legal hold | 类型/大小/期限/责任人/RPO/RTO | 删除关闭，只 dry-run |
| H12 | pending_human_decision | 外部厂商、地域、字段和保留涉及数据合规 | 外部 Provider fail closed | 厂商/地域/用途/字段/期限白名单 | 真实和未知数据禁止外发 |
| H13 | blocked_external | 目标 Linux、域名、GPU、存储和告警资源未提供 | 本机 18 服务、runbook、备份/回退框架 | 目标环境和运维参数 | 不发布、不横向扩容 |
| H15 | blocked_external | 独立审查必须由未参与实现者执行 | reviewer guide、攻击测试和 Draft PR | 独立代码/安全结论 | PR 保持 Draft |
| H16 | awaiting_human_signoff | 最终 UAT/Go Live 只能由负责人签署 | UAT 工具、问题台账和签字模板 | 全场景验收和签字 | 发布状态 blocked |

## 5. 能力声明

### 自动化证据已证明

- Excel/OCR 在正式入账前只保存证据、建议、revision、校验和批准快照；AI 无正式写库路径。
- 财务最终命令执行当前身份/项目/来源/模板/版本/hash 重验，上传者不能自审批，并发和重放只生成一次提交。
- H01 当前工程行为是每个有效明细行一条记录，任何阻断错误使整批不发布。
- ReportSnapshot 只读取 `confirmed + actual`，用 Decimal 分币种计算；AI 数字和 warning 可被确定性校验。
- 41 条 migration 可空库安装并从 40 升级；Prompt manifest/registry/seed/Schema/hash 漂移会使测试失败。

### 仅在合成/匿名样本证明

- Excel/OCR 建议、bbox 复核、50,000 行级处理、报告叙述和本地 Provider 降级流程。
- 本机单 API、单 Worker、PostgreSQL 与本地模型控制面的容量、并发和恢复表现。

### 仍是框架或 Mock

- Mock Provider 的分类、映射、异常说明和报告叙述输出。
- retention 只允许 dry-run；step-up/MFA 默认关闭；外部 Provider 真实数据调用关闭。
- 目标 Staging/生产部署、告警接收和正式备份 RPO/RTO 尚未执行。

### 尚未完成

- 真实 OCR/文本模型准确率、盲测、误识/拒识阈值和真实财务逐分对账。
- 生产数据外发、正式会计/冲销/关账/附件/重复/保留政策。
- 独立安全 Review、最终 UAT 和 Go Live 授权。

## 6. Draft PR 交接

- M0-M7 已形成小步提交；M8 只收口文档和最终证据，不改变业务代码。
- M8 提交 `30c6ead` 已正常推送；Build run `29752263099` 的业务门禁通过并由供应链门禁暴露旧 Nginx Critical，后续见 `M8_1_NGINX_CI_SECURITY_REFRESH_2026-07-20.md`。
- PR #4 描述应持续包含本报告、M8.1、M5.2/M6/M7、41 条 migration、测试矩阵和 H 阻塞。
- PR 必须保持 Draft。只有 H15 独立审查和 H16 最终签字完成后，才可另行决定是否 Ready 或 merge。

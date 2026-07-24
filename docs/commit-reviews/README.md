# FINANCE-AGENT Commit Review Index

本目录从 `3c6991b8c4c25c6f6ebc873ea47df98906e03396` 之后的新提交开始执行逐提交审查制度。每个新提交必须同时包含一份独立 `CR-XXX_*.md`；实际提交 SHA 通过 Git 历史追溯，不写入同一提交中的文档。

## 追溯命令

```bash
git log --follow --format="%H %s" -- docs/commit-reviews/CR-XXX_<short-slug>.md
```

## 审查索引

| 编号 | 文档 | 预计提交标题 | 优先级 | 状态 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| CR-001 | [CR-001_execution-baseline.md](CR-001_execution-baseline.md) | `docs: establish commit review baseline` | P0 governance | PARTIAL | 无 |
| CR-002 | [CR-002_excel-staging-attack-regression.md](CR-002_excel-staging-attack-regression.md) | `test: expose unpublished Excel staging bypasses` | P0 data integrity | EXPECTED_FAIL | CR-001 |
| CR-003 | [CR-003_excel-publication-isolation.md](CR-003_excel-publication-isolation.md) | `P0: isolate unpublished Excel records` | P0 data integrity | PARTIAL | CR-002 |
| CR-004 | [CR-004_excel-publication-integrity-fence.md](CR-004_excel-publication-integrity-fence.md) | `P0: fence Excel publication integrity` | P0 data integrity | PASS | CR-003 |
| CR-005 | [CR-005_excel-staging-regression-closure.md](CR-005_excel-staging-regression-closure.md) | `P0: close Excel staging regressions and claims` | P0 data integrity | PASS | CR-004 |
| CR-006 | [CR-006_prompt-execution-provenance.md](CR-006_prompt-execution-provenance.md) | `P1: execute versioned prompts with audited provenance` | P1 AI integrity | ENGINEERING_VERIFIED | CR-005 |
| CR-007 | [CR-007_owner-governance-consolidation.md](CR-007_owner-governance-consolidation.md) | `docs: consolidate single-owner decisions and open questions` | P1 governance | ENGINEERING_VERIFIED | CR-006 |
| CR-008 | [CR-008_docs-information-architecture.md](CR-008_docs-information-architecture.md) | `docs: organize reports and plans` | P2 documentation | ENGINEERING_VERIFIED | CR-007 |
| CR-009 | [CR-009_production-safe-system-registry.md](CR-009_production-safe-system-registry.md) | `P1: bootstrap production AI system registry` | P1 AI integrity | ENGINEERING_VERIFIED | CR-008 |
| CR-010 | [CR-010_runtime-image-package-manager-removal.md](CR-010_runtime-image-package-manager-removal.md) | `P0: remove package managers from backend runtime` | P0 supply chain | ENGINEERING_VERIFIED | CR-009 |
| CR-011 | [CR-011_friday-excel-report-demo-e2e.md](CR-011_friday-excel-report-demo-e2e.md) | `test: prove Friday Excel report demo` | P1 delivery evidence | REMOTE_ENGINEERING_VERIFIED | CR-010 |
| CR-012 | [CR-012_repeatable-friday-demo-delivery.md](CR-012_repeatable-friday-demo-delivery.md) | `docs: package repeatable Friday demo` | P1 delivery readiness | REMOTE_ENGINEERING_VERIFIED | CR-011 |
| CR-013 | [CR-013_excel-ai-advisory-draft-bridge.md](CR-013_excel-ai-advisory-draft-bridge.md) | `feat: bridge Excel AI suggestions into finance draft` | P1 AI review integrity | REMOTE_ENGINEERING_VERIFIED | CR-012 |
| CR-014 | [CR-014_excel-ai-review-provenance.md](CR-014_excel-ai-review-provenance.md) | `feat: persist verified Excel AI review decisions` | P1 AI review integrity | REMOTE_ENGINEERING_VERIFIED | CR-013 |
| CR-015 | [CR-015_excel-ai-review-confirmation-ui.md](CR-015_excel-ai-review-confirmation-ui.md) | `feat: show Excel AI review evidence before approval` | P1 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-014 |
| CR-016 | [CR-016_excel-approval-evidence-record-scope.md](CR-016_excel-approval-evidence-record-scope.md) | `feat: link Excel approval evidence to scoped records` | P1 delivery evidence | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-015 |
| CR-017 | [CR-017_excel-ai-canonical-review-basis.md](CR-017_excel-ai-canonical-review-basis.md) | `feat: bind Excel AI reviews to canonical state` | P0 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-016 |
| CR-018 | [CR-018_fast-uri-security-patch.md](CR-018_fast-uri-security-patch.md) | `fix: update fast-uri security patch` | P0 supply chain | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-017 |
| CR-019 | [CR-019_excel-ai-review-truth-table.md](CR-019_excel-ai-review-truth-table.md) | `fix: enforce Excel AI review truth table` | P0 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-018 |
| CR-020 | [CR-020_excel-ai-review-batch-integrity.md](CR-020_excel-ai-review-batch-integrity.md) | `fix: require complete idempotent Excel AI reviews` | P0 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-019 |
| CR-021 | [CR-021_excel-ai-review-digest-binding.md](CR-021_excel-ai-review-digest-binding.md) | `fix: bind Excel approvals to AI review digest` | P1 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-020 |
| CR-022 | [CR-022_excel-ai-approval-evidence-ui.md](CR-022_excel-ai-approval-evidence-ui.md) | `feat: expose digest-bound Excel approval evidence` | P1 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-021 |
| CR-023 | [CR-023_excel-ai-review-append-only.md](CR-023_excel-ai-review-append-only.md) | `fix: make Excel AI review evidence append-only` | P1 AI review integrity | LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-022 |
| CR-024 | [CR-024_ocr-correction-state-preconditions.md](CR-024_ocr-correction-state-preconditions.md) | `fix: require OCR correction state preconditions` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-023 |
| CR-025 | [CR-025_ocr-ai-stale-output-fence.md](CR-025_ocr-ai-stale-output-fence.md) | `fix: reject stale OCR AI suggestion output` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-024 |
| CR-026 | [CR-026_raw-ocr-value-preservation.md](CR-026_raw-ocr-value-preservation.md) | `fix: preserve raw OCR values during correction` | P1 OCR evidence integrity | SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-025 |
| CR-027 | [CR-027_ocr-ai-review-immutable-evidence.md](CR-027_ocr-ai-review-immutable-evidence.md) | `feat: add immutable OCR AI review evidence` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / API_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-026 |
| CR-028 | [CR-028_ocr-ai-complete-batch-review.md](CR-028_ocr-ai-complete-batch-review.md) | `feat: persist complete OCR AI reviews` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / APPROVAL_DIGEST_PENDING / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-027 |
| CR-029 | [CR-029_ocr-ai-review-digest-binding.md](CR-029_ocr-ai-review-digest-binding.md) | `fix: bind OCR approvals to review digest` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-028 |
| CR-030 | [CR-030_ocr-ai-review-context-recovery.md](CR-030_ocr-ai-review-context-recovery.md) | `fix: restore OCR AI review context` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-029 |
| CR-031 | [CR-031_ocr-ai-e2e-cleanup.md](CR-031_ocr-ai-e2e-cleanup.md) | `test: clean immutable OCR review fixtures` | P1 test isolation | LOCAL_ENGINEERING_VERIFIED / TEST_DATABASE_ONLY / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-030 |
| CR-032 | [CR-032_ocr-ai-finance-review-workspace.md](CR-032_ocr-ai-finance-review-workspace.md) | `feat: add OCR AI finance review workspace` | P1 OCR review integrity | SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-031 |
| CR-033 | [CR-033_report-snapshot-source-pagination.md](CR-033_report-snapshot-source-pagination.md) | `feat: expose paginated report snapshot sources` | P2 report evidence | SYNTHETIC_ENGINEERING_VERIFIED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-032 |
| CR-034 | [CR-034_report-narrative-review-workflow.md](CR-034_report-narrative-review-workflow.md) | `feat: add report narrative review workflow` | P2 report narrative integrity | SYNTHETIC_ENGINEERING_VERIFIED / UI_NOT_YET_WIRED / OQ03_POLICY_PENDING / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-033 |
| CR-035 | [CR-035_report-narrative-review-workspaces.md](CR-035_report-narrative-review-workspaces.md) | `feat: connect report narrative review workspaces` | P2 report narrative integrity | SYNTHETIC_ENGINEERING_VERIFIED / OQ03_POLICY_PENDING / REAL_MODEL_QUALITY_NOT_TESTED / OWNER_UAT_PENDING / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-034 |
| CR-036 | [CR-036_parameterized-staging-topology.md](CR-036_parameterized-staging-topology.md) | `feat: parameterize staging deployment topology` | P2 deployment safety | LOCAL_ENGINEERING_VERIFIED / TARGET_ENVIRONMENT_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-035 |
| CR-037 | [CR-037_fail-closed-target-profile.md](CR-037_fail-closed-target-profile.md) | `feat: enforce fail-closed staging target profile` | P2 deployment safety | LOCAL_ENGINEERING_VERIFIED / TARGET_RESOURCES_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-036 |
| CR-038 | [CR-038_read-only-target-preflight.md](CR-038_read-only-target-preflight.md) | `feat: add read-only staging target preflight` | P2 deployment evidence | SYNTHETIC_ENGINEERING_VERIFIED / REAL_TARGET_BLOCKED_EXTERNAL / REMOTE_PUSH_BLOCKED_EXTERNAL | CR-037 |
| CR-039 | [CR-039_progress-checkpoint-one.md](CR-039_progress-checkpoint-one.md) | `docs: add progress checkpoint one` | P2 delivery status | DOCUMENTED / RUNTIME_UNCHANGED / REMOTE_PUSHED | CR-038 |
| CR-040 | [CR-040_file-secret-alert-delivery.md](CR-040_file-secret-alert-delivery.md) | `feat: add file-secret alert delivery framework` | P2 deployment evidence | REMOTE_SYNTHETIC_VERIFIED / REAL_RECEIVER_BLOCKED_EXTERNAL | CR-039 |
| CR-041 | [CR-041_digest-only-registry-signatures.md](CR-041_digest-only-registry-signatures.md) | `feat: verify digest-only registry signatures` | P2 supply-chain evidence | REMOTE_SYNTHETIC_VERIFIED / REAL_REGISTRY_AND_TRUST_ROOT_BLOCKED_EXTERNAL | CR-040 |
| CR-042 | [CR-042_value-free-secret-lifecycle.md](CR-042_value-free-secret-lifecycle.md) | `feat: add value-free secret lifecycle gates` | P2 secret lifecycle | REMOTE_SYNTHETIC_VERIFIED / REAL_PROVIDER_ROTATION_BLOCKED_EXTERNAL / H14_POLICY_PENDING | CR-041 |
| CR-043 | [CR-043_offsite-backup-evidence-contracts.md](CR-043_offsite-backup-evidence-contracts.md) | `feat: add offsite backup evidence contracts` | P2 disaster-recovery evidence | REMOTE_SYNTHETIC_VERIFIED / REAL_OFFSITE_RESTORE_BLOCKED_EXTERNAL / H14_TARGETS_PENDING | CR-042 |
| CR-044 | [CR-044_prisma-format-gate.md](CR-044_prisma-format-gate.md) | `fix: restore Prisma format gate` | P0 CI acceptance | REMOTE_ENGINEERING_VERIFIED | CR-043 |
| CR-045 | [CR-045_staging-parameterization-regression.md](CR-045_staging-parameterization-regression.md) | `test: align staging parameterization assertions` | P0 CI regression | REMOTE_ENGINEERING_VERIFIED | CR-044 |
| CR-046 | [CR-046_dependency-install-runtime-image-hardening.md](CR-046_dependency-install-runtime-image-hardening.md) | `build: harden dependency install and runtime image` | P1 supply chain | REMOTE_ENGINEERING_VERIFIED / REAL_STAGING_LOGS_BLOCKED_EXTERNAL | CR-045 |
| CR-047 | [CR-047_overnight-fact-sync.md](CR-047_overnight-fact-sync.md) | `docs: close overnight evidence and handoff` | P2 delivery status | DOCUMENTED / RUNTIME_UNCHANGED | CR-046 |
| CR-048 | [CR-048_overnight-report-structure-closure.md](CR-048_overnight-report-structure-closure.md) | `docs: align overnight handoff structure` | P2 delivery status | DOCUMENTED / RUNTIME_UNCHANGED | CR-047 |
| CR-049 | [CR-049_excel-ai-e2e-retry-isolation.md](CR-049_excel-ai-e2e-retry-isolation.md) | `test: isolate Excel AI evidence retries` | P0 CI regression | LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING | CR-048 |
| CR-050 | [CR-050_ocr-provider-raster-evidence.md](CR-050_ocr-provider-raster-evidence.md) | `fix(ocr): preserve provider raster evidence` | P1 OCR evidence integrity | LOCAL_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED | CR-049 |
| CR-051 | [CR-051_local-ai-structured-contracts.md](CR-051_local-ai-structured-contracts.md) | `fix(ai): align local structured suggestion contracts` | P1 AI integrity | LOCAL_ENGINEERING_VERIFIED / OWNER_UAT_PENDING | CR-050 |
| CR-052 | [CR-052_import-confirmation-pagination-indexes.md](CR-052_import-confirmation-pagination-indexes.md) | `perf(import): index final integrity pagination` | P1 capacity | LOCAL_ENGINEERING_VERIFIED / TARGET_CAPACITY_PENDING | CR-051 |
| CR-053 | [CR-053_local-full-stack-handoff.md](CR-053_local-full-stack-handoff.md) | `docs: hand off local full-stack pilot` | P2 delivery status | DOCUMENTED / RUNTIME_VERIFIED | CR-052 |
| CR-054 | [CR-054_local-pilot-postgres-loopback-isolation.md](CR-054_local-pilot-postgres-loopback-isolation.md) | `docs: record loopback pilot database isolation` | P1 local security | LOCAL_ENGINEERING_VERIFIED / HOST_RESTART_PENDING | CR-053 |
| CR-055 | [CR-055_boss-chat-claim-allowlist.md](CR-055_boss-chat-claim-allowlist.md) | `fix(ai): constrain boss chat claim allowlists` | P1 AI integrity | LOCAL_MODEL_VERIFIED / OWNER_UAT_PENDING | CR-054 |
| CR-056 | [CR-056_boss-ai-evidence-disclosure.md](CR-056_boss-ai-evidence-disclosure.md) | `feat(ai): expose boss answer evidence` | P1 AI traceability | LOCAL_BROWSER_VERIFIED / OWNER_UAT_PENDING | CR-055 |
| CR-057 | [CR-057_ocr-field-key-label-bridge.md](CR-057_ocr-field-key-label-bridge.md) | `fix(ocr): recognize stable field-key labels` | P1 OCR local-provider compatibility | LOCAL_MODEL_BROWSER_VERIFIED / REAL_SAMPLE_NEEDED | CR-056 |

当前远端校准：CR-015 至 CR-046 的实现均已包含在运行时树 `5c16f3e`，该树的 Build and acceptance 与 CodeQL 已通过。CR-015 至 CR-038 行内保留的 `REMOTE_PUSH_BLOCKED_EXTERNAL` 是各审查文档提交时的历史状态，不代表当前分支仍未推送；真实样本、目标环境和 owner UAT 等业务门禁仍按各行原义保持开放。

## 审查分组

- P0 Excel staging 隔离与发布完整性：从 CR-002 开始。
- Prompt、生产初始化与 Excel AI：CR-006 已关闭 Prompt 真执行/provenance，CR-007 已统一负责人决定与开放问题，CR-008 已整理文档信息架构，CR-009 已关闭 production-safe system registry bootstrap，CR-010 已恢复运行镜像供应链绿色基线。CR-011/012 建立可重复周五演示，CR-013 至 CR-023 把受控建议、完整人工决定、canonical basis、摘要绑定、幂等审核和 append-only 证据接入 Excel 批准链。当前树已推送并取得同 SHA Build/CodeQL 绿色；真实财务口径与负责人 UAT 仍未完成。
- OCR 与报告财务复核：CR-024 至 CR-031 已建立 OCR 状态前置条件、原值保全、不可变审核证据、完整批次复核、摘要绑定、刷新恢复和测试清理；CR-032 已把该链路接入财务工作台并用合成 API E2E 验证换人复核、失败关闭和移动端边界；CR-033 已接入只读、分页、可筛选且绑定快照水位的报告来源明细；CR-034/035 已增加默认关闭、财务后老板两阶段、append-only 的 Narrative 文本复核后端与角色工作台。OQ-03 正式政策、真实 OCR/AI 准确率和负责人 UAT 仍未完成。
- Staging、模型网络和发布证据：CR-036 已参数化目标边界；CR-037 阻断 target 复用本地 CA/identity/seed/域名/初始化和 mutable image；CR-038 增加只读目标预检；CR-040 至 CR-043 增加告警、digest-only 签名、无值 secret 生命周期和异地备份证据契约；CR-044 至 CR-046 恢复远端门禁并收紧依赖/镜像。当前树远端合成验收通过，真实接收端、registry、目标运行和异地恢复仍受 H13-H16 门禁约束。

## 历史说明

本制度不重写公共历史。此前提交和对应阶段证据只在 [LEGACY_BASELINE_INDEX.md](LEGACY_BASELINE_INDEX.md) 中建立只读索引，不声称这些审查文档在历史提交发生时已经存在。

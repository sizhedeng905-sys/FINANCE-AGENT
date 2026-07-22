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

## 审查分组

- P0 Excel staging 隔离与发布完整性：从 CR-002 开始。
- Prompt、生产初始化与 Excel AI：CR-006 已关闭 Prompt 真执行/provenance，CR-007 已统一负责人决定与开放问题，CR-008 已整理文档信息架构，CR-009 已关闭 production-safe system registry bootstrap，CR-010 已恢复运行镜像供应链绿色基线。CR-011 已建立周五演示 E2E，CR-012 已整理演示交付包，CR-013 已把受控建议接入财务本页草稿，CR-014 已远端验证服务端人工审核决定与 provenance，CR-015/016 已推送但同一远端构建被新出现的高危依赖公告拦截；CR-017 至 CR-020 已在本地关闭 canonical review basis、依赖公告、审核真值和整批幂等完整性缺口，远端推送暂受网络阻塞。
- OCR 与报告财务复核：前序 P1 契约稳定后开始。
- Staging、模型网络和发布证据：代码路径可本地验证；目标环境仍受 H13-H16 门禁约束。

## 历史说明

本制度不重写公共历史。此前提交和对应阶段证据只在 [LEGACY_BASELINE_INDEX.md](LEGACY_BASELINE_INDEX.md) 中建立只读索引，不声称这些审查文档在历史提交发生时已经存在。

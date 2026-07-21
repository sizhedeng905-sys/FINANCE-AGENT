# Legacy Baseline Index

本文件只为审查者提供 `CR-001` 之前的证据入口。它不修改旧提交，不声称旧提交当时包含逐提交 CR 文档，也不替代 Git、CI 和 Draft PR 的实时状态。

## 基线

- 分支：`agent/b8-stable-hardening`
- 本制度生效前 HEAD：`3c6991b8c4c25c6f6ebc873ea47df98906e03396`
- Draft PR：`#4`
- 旧候选的实时 CI 状态以 PR #4 为准。

## 主要历史证据

| 分组 | 文档 |
| --- | --- |
| B8 总体 | `docs/汇报/B8_BLOCKER_MATRIX.md`、`docs/汇报/B8_OVERNIGHT_EXECUTION_REPORT.md` |
| Excel 审核/发布 | `docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md`、`docs/汇报/R9_3A_IMPORT_CONFIRMATION_TRANSIENT_RECOVERY_REPORT_2026-07-21.md`、`docs/汇报/R9_3B_IMPORT_PUBLICATION_TRANSACTION_HARDENING_REPORT_2026-07-21.md` |
| Prompt/AI 映射 | `docs/汇报/M2_AI_GUARDRAILS_AND_PROMPT_REGISTRY_REPORT_2026-07-18.md`、`docs/汇报/M3_2_EXCEL_AI_SUGGESTION_REPORT_2026-07-20.md` |
| OCR | `docs/汇报/M4_OCR_AI_EVIDENCE_REVIEW_REPORT_2026-07-20.md`、`docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md` |
| 报告 | `docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md` |
| 攻击与资源 | `docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md` |
| CI/发布 | `docs/汇报/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md`、`docs/汇报/R11_DOCUMENTATION_PR_RELEASE_CANDIDATE_CLOSURE_2026-07-21.md` |

## 当前重新打开的风险

新任务书重新打开 Excel 未发布记录隔离与最终发布完整性 P0。历史报告中“staging 对通用路径一直不可见”以及“M5.2/R9.3B 完全关闭”的文字必须以新的攻击测试和修复结果重新判定。

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

## 审查分组

- P0 Excel staging 隔离与发布完整性：从 CR-002 开始。
- Prompt、生产初始化与 Excel AI：P0 全量门禁通过后开始。
- OCR 与报告财务复核：前序 P1 契约稳定后开始。
- Staging、模型网络和发布证据：代码路径可本地验证；目标环境仍受 H13-H16 门禁约束。

## 历史说明

本制度不重写公共历史。此前提交和对应阶段证据只在 [LEGACY_BASELINE_INDEX.md](LEGACY_BASELINE_INDEX.md) 中建立只读索引，不声称这些审查文档在历史提交发生时已经存在。

# FINANCE-AGENT 真实业务数据 B0 基线报告

> 生成时间：2026-07-14T12:13:32.699Z
>
> 本报告只包含匿名聚合指标。原始路径、文件名、完整哈希、业务值和 OCR 原文仅保存在 Git 忽略的本地清单中。

## 门禁结论

| 检查项 | 结果 |
| --- | --- |
| 物理文件已扫描 | 112 / 112 |
| 原始文件复核哈希未变化 | 通过（112 / 112） |
| 文件均有匿名业务分类 | 通过 |
| 公开报告包含原始路径/完整哈希 | 否 |
| B0 是否允许进入 B1/B2 | 允许，按优先级修复兼容问题 |

## 文件概况

| 格式 | 数量 | 空间 |
| --- | ---: | ---: |
| `.docx` | 1 | 0.04 MiB |
| `.jpg` | 24 | 7.18 MiB |
| `.pdf` | 23 | 18.98 MiB |
| `.png` | 11 | 1.99 MiB |
| `.xls` | 15 | 0.91 MiB |
| `.xlsx` | 34 | 284.61 MiB |
| `.zip` | 4 | 9.53 MiB |
| **合计** | **112** | **323.25 MiB** |

## 匿名业务分类

| 数据族 | 数量 |
| --- | ---: |
| `RB-ARC` | 4 |
| `RB-ATT` | 7 |
| `RB-CASH` | 2 |
| `RB-CLM` | 5 |
| `RB-EINV` | 21 |
| `RB-EXP` | 11 |
| `RB-FRT` | 14 |
| `RB-MDM` | 3 |
| `RB-MGT` | 2 |
| `RB-OTHER` | 3 |
| `RB-PAY` | 3 |
| `RB-SCAN` | 2 |
| `RB-SHOT` | 25 |
| `RB-TABLE-IMG` | 10 |

## 当前处理路线

| 路线 | 数量 |
| --- | ---: |
| `manual-only` | 1 |
| `needs-conversion` | 19 |
| `needs-profile` | 27 |
| `security-rejected` | 6 |
| `supported` | 59 |

| 主要原因 | 数量 |
| --- | ---: |
| `merged_cells` | 30 |
| `formula_cells` | 29 |
| `multiple_non_empty_sheets` | 22 |
| `legacy_xls_requires_conversion` | 15 |
| `embedded_media` | 10 |
| `hidden_sheets` | 8 |
| `exceeds_default_upload_limit` | 7 |
| `active_or_external_office_parts` | 6 |
| `file_security_rejected` | 6 |
| `archive_requires_safe_unpack` | 4 |
| `document_table_requires_manual_route` | 1 |
| `exceeds_hard_upload_limit` | 1 |
| `ocr_page_limit` | 1 |
| `ocr_preprocessor_rejected` | 1 |
| `row_limit` | 1 |

## Excel 结构基线

| 指标 | 结果 |
| --- | ---: |
| XLSX 文件 | 34 |
| 工作表总数 | 298 |
| 多工作表文件 | 23 |
| 多个非空工作表文件 | 22 |
| 含隐藏工作表文件 | 8 |
| 含公式文件 | 29 |
| 含合并单元格文件 | 30 |
| 含内嵌媒体文件 | 10 |
| 内嵌媒体对象 | 998 |
| 内嵌媒体大小 | 256.38 MiB |
| 单文件最大工作表数 | 32 |
| 单工作表最大行数 | 30196 |
| 最大列数 | 180 |
| 超过默认上传限制 | 7 |
| 超过硬上传限制 | 1 |
| 超过当前行数限制 | 1 |

## PDF、图片和文档

| 指标 | 结果 |
| --- | ---: |
| PDF 文件 | 23 |
| 单页 PDF | 21 |
| 最大页数 | 35 |
| 超过 OCR 页数限制 | 1 |
| 图片文件 | 35 |
| 长图 | 6 |
| 最大宽度 | 2016 |
| 最大高度 | 4794 |
| DOCX 文件 | 1 |
| DOCX 表格/表格行 | 1 / 166 |

## 重复与归档

| 指标 | 结果 |
| --- | ---: |
| 独立文件完全重复组 | 6 |
| 重复组涉及文件 | 12 |
| ZIP 文件 | 4 |
| ZIP 条目 | 69 |
| 与散文件完全相同的条目 | 46 |
| ZIP 内独有表格文件 | 23 |
| 不安全路径/加密条目 | 0 / 0 |

## 现有服务兼容性

| 检查器 | 接受 | 拒绝 | 不适用/未检查 |
| --- | ---: | ---: | ---: |
| FileSecurityService | 87 | 25 | 0 |
| DocumentPreprocessorService | 57 | 1 | 54 |

## B0 结论

1. 当前真实数据的首要阻塞仍是多 Sheet/合并表头/公式、旧版 XLS 和大文件，不应通过提高单一大小限制绕过。
2. 表格数据与内嵌凭证必须分层处理，避免一次性载入大量媒体对象。
3. 超过 OCR 页数限制的 PDF 必须显式拆分或选择页范围，不能静默截断。
4. 完全重复当前只做哈希提示与幂等验证，不自动判断业务近似重复。
5. 下一批先补 B1 文件边界测试，再实现 B2 的 Sheet/表头选择和后台分块基线。

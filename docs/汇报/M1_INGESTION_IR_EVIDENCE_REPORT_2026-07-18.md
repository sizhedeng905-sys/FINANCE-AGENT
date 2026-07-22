# M1 Excel/OCR 规范 IR 与证据验收报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

状态：`passed`（非生产框架与合成/PostgreSQL 工程验收；不代表真实 OCR 准确率或生产授权）

## 实际实现

- 新增 `stable-json-v1` 规范 JSON 与 SHA-256 工具。对象键顺序不改变哈希，数组顺序保留语义；循环、`undefined`、非有限数字、原型污染键和超深/超量结构失败关闭。
- Excel 复用 `ExcelParserService` 的 document/streaming 双路径，新增 `excel-ir/1.0`、`exceljs-evidence-v1`、来源文件哈希、解析输入哈希、行证据摘要和 IR 哈希。
- Sheet 证据包含稳定 `sheetN` ID、名称/索引、显隐状态、表头起止行、表头行集合、合并区间、1900/1904 日期系统和 UTC 解释。
- 列证据包含 `sheetN:C` 稳定引用、Excel 列字母、多行表头 parts、推断类型、有界样本和空值/非空/有界 distinct 统计。
- 单元格证据按分页行持久化，包含 `sheetN!C3`、行列/地址、lexical 与哈希、字符串规范值、显示值、类型、公式、缓存值、合并锚点、警告和截断标志。现有 `rawData` 保持兼容。
- OCR 复用 `OcrTask/OcrAttempt` 与既有 Provider，新增 `ocr-ir/1.0`、`page-native-top-left-v1`、Provider 版本向量和稳定 IR 哈希。
- OCR 页保存尺寸、原始旋转、实际旋转、真实预处理操作和 warning；图片尺寸复用文件安全模块，PDF 选页只记录实际执行的 `PDF_PAGE_SLICE`。
- OCR block/token 使用 `p1-b1`、`p1-b1-t1` 稳定引用；bbox 做正数、页范围和坐标边界检查。没有真实 token/block 匹配的 Provider 字段候选保存为显式 `provider_field_candidate`，不伪装成 token。
- `ImportTask/Sheet/Column/Row` 和 `OcrTask` 原位增加版本、哈希和证据字段；没有创建第二套文件、任务、Worker 或 OCR 模块。
- 任务 API 仅增加有界 evidence 元数据；5 万行单元格证据仍按现有行分页访问，不进入任务详情巨大 JSON。OCR 的 canonical IR 保存在数据库用于审计，列表响应不返回整份 IR。

## 数据库 Migration

新增：`20260719000000_ingestion_ir_evidence`

- 所有新列对旧数据可空或有安全 JSON 默认值。
- SHA-256、日期系统、visibility 等增加数据库 check；IR/evidence hash 增加索引。
- `npm run db:migration-paths` 实测 29 条 migration 空库安装和 28→29 现有库升级均通过，临时数据库已清理。

## 自动化证据

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| IR 定向单测 | `npm test -- --runInBand test/ocr-ir.spec.ts test/ocr.spec.ts test/excel-parser.spec.ts test/canonical-json.spec.ts` | 4 suites / 29 tests passed |
| PostgreSQL Excel/OCR | `npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern="imports a real XLSX|runs OCR through human correction"` | 2/2 passed；首次运行发现并修复 OCR block 页码兼容问题 |
| PostgreSQL `.xls`/后台 Worker | `npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern="keeps legacy XLS evidence intact|persists, cancels, and recovers large background XLSX"` | 2/2 passed |
| Migration | `npm run db:migration-paths` | 29 空库 + 28→29 升级 passed |
| 后端回归 | `npm test` | 40 suites / 358 tests passed |
| 后端构建 | `npm run build` | passed |

PostgreSQL 用例实际断言了任务、Sheet、列、行四层 Excel 证据和 OCR IR/block/candidate evidence，并继续证明财务确认前 `BusinessRecord` 数量为 0。

## 已关闭问题

- `M1-EXCEL-EVIDENCE-001`：`verified`。
- `M1-OCR-EVIDENCE-001`：`verified`。

## 保留边界

- ExcelJS 已经把数值解析为 JavaScript number 后才交给业务代码；M1 从该边界开始立即转十进制字符串并保留显示/公式证据，但不声称恢复 OOXML 中已经丢失的原始数值字节表示。原始文件及 SHA-256 仍是最终证据源。
- OCR confidence 只是 Provider 输出的规范字符串，不是自动批准概率；真实金额/日期/字段准确率仍受 H04/H05。
- OCR 原图 bbox 高亮、review revision 和人工覆盖理由属于 M4/M5，尚未完成。
- Prompt Registry、严格 JSON Schema、AI mode/kill switch 属于 M2；AI 本阶段没有获得写库或批准能力。
- 现有 Excel `valid_rows_only` 和上传者自确认问题仍为 M5 P0，不能因 M1 通过而宣称统一审批链完成。

## 下一动作

进入 M2：在现有 `AiPromptVersion/AiTask/AiCallAttempt/AiCallLog` 上实现固定 manifest、严格 JSON/白名单验证、版本冻结、`AI_INGESTION_MODE`、`AI_REPORT_MODE` 和全局 kill switch。0 字节 Prompt Catalog 继续标记 `M0-INPUT-001 blocked_external`，不伪造目录正文核对结论。

# R9.1A XLSX Shared String 流式解析加固报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally`
> 对应问题：`R9-XLSX-STREAM-001`

## 问题

R9.1 的第一次全量回归中，嵌入媒体工作簿测试偶发一次 shared-string 未解析：表头被读成 `{"sharedString":0}` / `[object Object]`。隔离复跑和第二次全量均通过，因此不能把它归因为稳定业务回归，也不能用一次重跑绿色宣布根因消失。

风险不在报错本身，而在旧逻辑会把 ExcelJS 的内部 token 字符串化。若该值继续进入列名、字段映射和 IR，可能形成错误但看似有效的导入建议。

## 修复

- 复用现有有界 ZIP/XML 元数据扫描，确定性解析 `xl/sharedStrings.xml`。
- 合并普通文本与 rich-text run，并排除 phonetic run；不加载图片二进制或完整工作簿对象。
- 扫描全部 `t="s"` 单元格引用，拒绝非规范、非安全整数、越界或缺失 shared-string 表的索引。
- 每个 `WorkbookReader` 创建时预加载该共享字符串快照，减少 ExcelJS 内部 ZIP 条目读取时序对单元格解析的影响。
- `normalizeCell` 显式识别残留 `{sharedString:n}` token，返回解析错误和空值；表头路径立即拒绝，数据行进入错误状态，不再生成 `[object Object]`。
- 不增加猜值、重试后静默成功或 document-mode 大内存回退。

## 验收证据

| 命令/场景 | 结果 |
| --- | --- |
| Excel parser 定向 | 1 suite / 15 tests passed |
| 嵌入媒体测试连续 10 轮 | 10 runs / 0 failures |
| 单轮内并发流式解析 | 4/4 得到相同表头 |
| 未解析 token 注入 | 值为 null，并返回明确解析错误 |
| 删除 `xl/sharedStrings.xml` 的恶意工作簿 | 元数据门禁拒绝，不进入字段映射 |
| 后端全量单元 | 47 suites / 419 tests passed |
| 后端 build | exit 0 |
| PostgreSQL 真实 XLSX API 场景 | 1 passed / 68 skipped（按 test name 定向） |
| migration/seed | 41 migrations applied，seed 成功 |

PostgreSQL 场景覆盖真实上传、权限、嵌入媒体、多 Sheet/隐藏 Sheet、合并表头、公式缓存证据、映射、预览与取消。一次性数据库容器在测试后已删除。

## 剩余风险

- 本修复保证共享字符串有确定性来源，且最坏情况失败关闭；它不宣称已经修改或证明 ExcelJS 上游所有内部时序行为。
- 该提交最初连续两次遇到 GitHub 连接重置，随后已正常推送且未改写历史；当前累计 head 与远端状态以 `PR_PREPARATION.md` 为准。
- 真实 5 万行性能抖动仍按 M7 风险单独跟踪，本阶段没有放宽资源预算或超时。

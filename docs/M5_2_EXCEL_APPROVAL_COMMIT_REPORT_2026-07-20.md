# M5.2 Excel 财务审核与整批入账验收报告

> 日期：2026-07-20
> 分支：`agent/b8-stable-hardening`
> 起始 HEAD：`ae003e9a5ee639965cf4c041c04df5a1b700ea20`
> 状态：`engineering_passed / awaiting_human_signoff`

## 1. 本阶段结论

M5.2 已关闭 Excel `valid_rows_only` 部分发布的工程 P0。当前正式规则是：

1. 每个通过确定性校验的有效明细行生成一条正式 `BusinessRecord`。
2. 任一普通明细存在阻断错误时，整批不得发布；普通错误明细不能通过“排除”绕过校验。
3. 仅保守识别 `小计/合计/总计/本页合计/累计` 为疑似汇总行；财务必须明确纳入或排除并填写理由。
4. 汇总行识别不确定时保持阻断，不猜测；总额由正式明细记录通过 Decimal 聚合。
5. 财务修改会创建新的 review revision，并立即使旧 ValidationSnapshot 失效。
6. 财务必须先重新校验，再由另一名当前有效的财务用户批准并入库。
7. AI、上传者、旧页面、已撤权账号和已作废来源均不能发布正式记录。

H01 的“按照每行明细”已经进入工程实现和合成验收，但真实汇总行样例、稳定识别特征和正式签字仍未完成，因此不宣称业务 UAT 或生产门禁通过。

## 2. 主要实现

### 2.1 审核与校验

- `PUT /api/import-tasks/:id/rows/:rowId/review`
  - 只允许处理疑似汇总行；普通明细返回 `IMPORT_ROW_REVIEW_NOT_SUMMARY`。
  - 请求携带 expected task/review version、`include|exclude` 和 2-500 字符理由。
  - 每次修改递增 `reviewRevision`，清除旧校验和批准快照，并写 audit/ledger。
- `POST /api/import-tasks/:id/revalidate`
  - 以 500 行 keyset 批次扫描全部 ImportRow，不将大表完整加载进 Node 或浏览器。
  - 重新验证来源、项目、模板、映射、字段类型、必填项、H01 行审查和规范输出。
  - 保存有界、内容寻址的 `excel-validation/1.0` 快照、稳定 warning ID、行集合哈希和规范输出哈希。
- `POST /api/import-tasks/:id/confirm`
  - 强制 `Idempotency-Key`。
  - 请求必须精确携带 expected task/review/validation/payload hash 和全部 warning ID。
  - 客户端只能发送批准命令，不能提交目标状态或批准人身份。

### 2.2 不可变批准与最终发布

- 批准快照冻结 source/file/IR、template、mapping/profile、review/validation、策略版本、批准人、请求 key 哈希和规范输出哈希。
- 上传者自审批被保守禁止；最终事务重新读取账号状态、角色、项目、文件安全状态和模板版本。
- Worker 每批最多 500 行，以确定性记录 ID 和数据库唯一约束创建 `pending_confirm` staging 记录。
- staging 对报表不可见。只有所有行处理完成、记录数和两个内容哈希再次一致时，最终单一事务才统一发布：
  - `BusinessRecord` 改为 `confirmed`；
  - `ImportRow` 关联正式记录并改为 `confirmed`；
  - staging ledger 改为正式创建事件；
  - 写任务摘要 audit/ledger；
  - 任务改为 `confirmed`。
- 最后一批失败、账号停用、角色撤销、来源状态变化或哈希不一致时正式记录数保持 0；网络重放和 Worker 恢复不会重复入账。

### 2.3 数据库迁移

新增第 37 条 migration：

`backend/prisma/migrations/20260720220000_excel_review_validation_snapshots/migration.sql`

迁移为 `import_tasks` 增加 review、validation、approval snapshot/version/hash 字段，为 `import_rows` 增加不可变 parser 结果和人工 review 元数据，并使用 CHECK、索引和现有唯一约束守住快照一致性与查询边界。旧行由迁移把当前 parser 结果安全回填到新列；未修改已发布 migration。

## 3. 前端与 Mock 契约

- Excel 确认页显示整批失败关闭策略、阻断错误、warning、当前 review/validation 版本和预计创建记录数。
- 只有疑似汇总行显示纳入/排除操作；普通明细错误明确要求修正源文件后重新导入。
- “保存审核”“重新校验”“批准并入库”分离；批准前二次确认并提示不能自审批。
- API 与显式 Mock Repository 使用同一版本/hash/warning/整批失败关闭语义；Mock 不会冒充真实 Provider 或后端成功。

## 4. 测试证据

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 后端 build | `passed` | Prisma generate、应用与脚本 TypeScript，8.0 s |
| 前端 production build | `passed` | Vite 3,147 modules，8.7 s |
| 后端 Jest | `passed` | 46/46 suites，403/403 tests，21.086 s |
| PostgreSQL 定向 | `passed` | B8-03 11/11 tests，142.392 s |
| PostgreSQL 全量 | `passed` | 9/9 suites，96/96 tests，210.978 s |
| Playwright | `passed` | 17/17，52.1 s；包含整批阻断、分页、公式缓存、第二财务批准、旧 XLS 和 OCR |
| 前端 runtime | `passed` | 4/4 |
| Prisma/migration | `passed` | validate；空库 37 条；36→37 升级；205 indexes、82 foreign keys |
| Repository hygiene | `passed` | 693 tracked/candidate files |
| 生产依赖审计 | `passed` | 根目录和后端均为 0 vulnerabilities |
| Diff | `passed` | `git diff --check` 无错误 |

全量 PostgreSQL 容量采样：

| 行数 | 重新校验 | 确认 API | Worker 到终态 | RSS 增量 | 数据库连接峰值 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30,196 | 2.980 s | 22 ms | 25.473 s | 333.06 MiB | 10 |
| 49,999 | 5.710 s | 27 ms | 45.282 s | 32.84 MiB | 11 |

RSS 是同一 Jest 进程相对各用例起点的增量，不能把两行直接解释为独立进程绝对峰值。两个档位均逐项核对 ImportRow、BusinessRecord、RecordValue、金额、唯一 sourceId、状态、audit、ledger 和日报。

## 5. 失败复现与修复

首次全量 PostgreSQL 回归为 `94/96`：49,999 行用例超时，超时清理又与尚未结束的 Worker 竞争。调查确认专用测试库在多轮大表插入/删除后，即使几乎没有存活行，物理文件仍膨胀到约 361 MB；原集成启动器只执行 deploy/seed，没有重建 `_test` 数据库，因此单项与全量性能不可重复。

修复后：

- 集成启动器先验证数据库名以 `_test` 结尾，再执行 `migrate reset --force --skip-generate --skip-seed`、deploy 和 seed；非测试库仍在任何破坏性动作前拒绝。
- B8-03 清理先撤销仍活跃的测试 Worker 租约并等待对应 Promise 退出，再删除测试事实。
- 超时错误现在包含任务状态、处理进度、staging 记录数、attempt、lease 和错误摘要。
- 未延长 49,999 行的 180 秒业务性能断言；修复后定向和全量均通过。

## 6. 边界与未完成项

- `H01 awaiting_human_signoff`：需要匿名真实汇总行样例、稳定特征、例外和决策人姓名/角色/日期。
- `H02 pending_human_decision`：负数白名单、更正链和报表重述规则尚未完成。
- `H03 awaiting_human_signoff`：跨文件、OCR、工单和手工来源的正式重复指纹仍只提示，不自动合并或删除。
- `H10 awaiting_human_signoff`：当前工程默认第二财务批准；正式 MFA、自审批例外和职责分离矩阵仍待签字。
- `M6 not_started_in_this_commit`：canonical ReportSnapshot、逐项 sourcePath grounding 和 AI 叙述确定性校验尚未由本阶段实现。
- 真实 OCR 准确率、目标 Linux Staging、恢复/RPO/RTO、外部 Provider 和生产上线仍受对应 H 门禁阻断。

## 7. 下一步

M5.2 完成后进入 M6：复用现有 Reports 与 `AiFinancialClaim/sourcePath`，建立只读取 confirmed actual 数据、使用 Decimal 和一致性水位的不可变 ReportSnapshot；AI 只能叙述 Snapshot，不能查询或计算财务数字。

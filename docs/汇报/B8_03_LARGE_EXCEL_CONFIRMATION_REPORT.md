# B8-03 大批量 Excel 确认验收报告

更新日期：2026-07-15

## 结论

B8-03 工程门禁已通过。Excel 确认由同步长事务改为可恢复后台任务；5,001、30,196 和 49,999 行均完成最终经营记录、动态字段、金额、来源、审计、ledger 与日报闭环。测试只使用合成数据，未读取或提交真实业务文件。

跨文件、跨 Excel/OCR/手工来源的业务指纹仍依赖人工任务 H-03，本阶段不擅自定义业务去重规则。

## 实现边界

- 确认 API 在任务锁内将 `pending_confirm` 原子切换为 `confirming`，持久化总数、进度、尝试次数、lease 和操作者后立即返回。
- Worker 默认每批 500 行，允许通过 `IMPORT_CONFIRM_BATCH_SIZE` 配置为 100-500 行。
- 每行使用确定性 BusinessRecord ID，并由 `(import_task_id, source_id)` 唯一约束兜底；记录、动态值、行进度和行级 ledger 在同一短事务提交。
- Worker 每批续租；每次提交前同时校验任务状态和 lease token。接管后旧 Worker 无权继续写入。
- 恢复进度只读取 `confirmation_processed_at`、BusinessRecord 和 ImportRow 状态，不依赖内存游标。
- 批次记录保持 `pending_confirm`，报表只读取 `confirmed`。全部批次完成后，单个原子发布事务统一更新记录、行、任务、audit 和任务级 ledger。
- `confirming` 或 `confirmation_failed` 不允许取消；失败任务保留已完成批次，只允许安全续跑。
- 任务级 audit/ledger 只保存计数摘要，不保存数万个 recordId；记录通过 `importTaskId` 分页查询。

## 规模结果

测量环境：Windows、Node.js `v24.18.0`、PostgreSQL `17.10`、本地测试数据库。耗时从确认请求开始计至任务进入终态，不包含合成 ImportRow 准备和测试清理。

| 行数 | API 延迟 | 确认到终态 | 峰值 RSS 增量 | 数据库连接峰值 | 结果 |
| ---: | ---: | ---: | ---: | ---: | --- |
| 5,001 | `< 2,000 ms` 门禁 | 约 `3.4 s` | 受统一 1 GiB 门禁约束 | 有采样 | 通过 |
| 30,196 | `24 ms` | `17,551 ms` | `200.63 MiB` | `11` | 通过 |
| 49,999 | `37 ms` | `32,216 ms` | `327.44 MiB` | `10` | 通过 |

专用索引 `idx_import_rows_confirmation_queue(import_task_id, confirmation_processed_at, row_number)` 用于下一批选择和恢复扫描。49,999 行首次索引复测暴露最终原子发布超过 Prisma 默认 5 秒；最终发布事务单独配置 60 秒上限，批次事务仍保持默认短事务，随后同档复测通过。

每个规模档均核对：

- ImportRow 数量和全部确认状态；
- BusinessRecord 数量、全部 `confirmed` 状态和唯一 `sourceId`；
- RecordValue 数量为记录数的两倍；
- 金额总和严格按 PostgreSQL Decimal 对账；
- `sourceId` 与同任务 ImportRow ID 全量匹配；
- `import_task.confirm_completed` audit 和 `import_task_confirmed` ledger 各一条；
- 任务 ledger 不含 `recordIds` 数组；
- 指定日期项目日报金额和记录数与数据库一致。

## 故障与并发

| 场景 | 验证结果 |
| --- | --- |
| 过期 lease / 进程中断恢复 | 从数据库事实恢复，attempt 增加，最终无漏行 |
| 运行中 lease 接管 | 新 Worker 接管；旧 token 后续提交被拒绝；5,001 个来源唯一 |
| 最后一批系统失败 | 既有 1,000 条记录保持 `pending_confirm`，日报为 0；重试后 1,001 条一次发布 |
| PostgreSQL 短断 | 模拟 `P1001` 后释放 lease，恢复 attempt 完成且无重复 |
| 并发确认同一任务 | 两个请求均快速返回同一 `confirming` 任务，只产生一次 scheduled audit 和一套记录 |
| 相同幂等键重放 | 返回最初排队响应，终态后不重复生成记录 |
| 确认后取消 | API 返回统一 409，不回滚或作废已写批次 |

## 自动化入口

```powershell
cd backend
npm run build
npm test -- --runInBand
npm run test:integration
```

前端异步状态、进度和跳转由 `e2e/excel-import.spec.ts` 覆盖。完整项目门禁还包括根目录 `npm run build`、`npm run test:e2e` 和 `npm run check:hygiene`。

最终全量结果：21/21 migrations、17/17 Jest suites、184/184 tests、48/48 PostgreSQL integration、14/14 Playwright，前后端 production build 和 repository hygiene 均通过。

# R6.1 Excel 预览分页与响应预算验收报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

起始 HEAD：`f539d4af4b8f21fb20444e824d23f7c4e1afefa5`

状态：`passed`

## 失败复现

修改前，`GET /api/import-tasks/:id/preview?page=1&pageSize=2` 仍返回任务全部 5 行，测试得到 `expected 2 / received 5`。调用链确认 `previewInclude.rows` 在 PostgreSQL 查询中直接包含任务全部导入行，前端 Ant Table 随后只做浏览器内分页。

## 实现

- 删除预览的全量 `rows` include；业务行查询固定使用稳定的 `rowNumber,id` 排序、`skip/take` 和 `pageSize <= 100`。
- 首次精确摘要按 500 行 keyset 批次计算，任何单次查询和 Node 中间数组都不承载 5 万行；结果写入任务计数并以 `previewSummaryVersion == task.version` 缓存。
- 保存/自动修改映射时递增任务版本，旧摘要立即失效；并发变化会返回 409，不能把旧映射摘要冒充当前结果。
- API 返回 `page/pageSize/total/totalPages/hasNext`，序列化响应超过 1 MiB 时返回 413。
- 前端 API、Zustand store、Mock repository 和确认页统一使用服务端分页；Table 受控分页只保存当前页，页大小为 10/20/50/100。
- E2E fixture 新增 25 行合成工作簿，浏览器实际执行第一页 20 行和第二页 5 行的两次后端请求。
- 抽出解析器行数硬门禁，直接断言 49,999/50,000 接受、50,001 拒绝。

## 数据库

新增 migration：`20260718170000_import_preview_summary_version`

`import_tasks.preview_summary_version` 为可空整数。旧任务升级后首次访问会按受限批次重建摘要；不修改原始文件、导入行或正式经营记录。回退应用版本时该可空列可保留，不影响旧代码。

空库 25 条 migration 和上一版本 24→25 升级均通过；校验结果为 41 张业务表、27 个 enum、173 个 index、77 个 foreign key，无缺失或意外表。

## 测试证据

| 命令/场景 | 结果 |
| --- | --- |
| 修改前分页 PostgreSQL 红测 | `failed`，2 行请求实际返回 5 行 |
| 默认、1、100、101、page=0、深页、重复页、无 Token | `passed` |
| 5,001 行第一页/最深页及完整确认闭环 | `passed` |
| 50,000 行第 500 页、摘要缓存、响应/时间/RSS 预算 | `passed` |
| 49,999/50,000/50,001 解析边界 | `passed` |
| `npm test -- --runInBand`（backend） | 31/31 suites，286/286 tests，18.939 s |
| `npm run test:integration -- --runInBand` | 2/2 suites，62/62 tests，120.770 s |
| `npm run test:e2e` | 17/17，50.5 s；清理后文件残留 0 |
| `npm run db:migration-paths`（backend） | 25 条空库、24→25 升级通过，13.2 s |
| 前后端 build | 均 `passed`；前端 3,144 modules |
| repository hygiene / production audit | 585 个文件通过；根目录与后端均 0 vulnerabilities |

全量 PostgreSQL 首次两轮曾因共享 `integration_` 测试关键词造成各 2 项分页总数污染；改为每次运行唯一关键词后定向 2/2、全量 62/62 通过。一次 Excel 流式媒体单测在全量负载下失败，单独复测和随后全量 286/286 通过，未修改断言或业务逻辑。

## 预算与边界

| 边界 | 执行结果 |
| --- | --- |
| API page size | 默认 20，最小 1，最大 100，超过返回 400 |
| 单次摘要批次 | 500 行，稳定 keyset 顺序 |
| JSON 响应 | 服务端硬限制 1 MiB；50,000 行深页实测低于该限制 |
| Node 内存 | 50,000 行预览 RSS 增量断言小于 256 MiB |
| 首次 50,000 行摘要 | 断言小于 20 秒；后续缓存页断言小于 2 秒 |
| 浏览器 DOM | 当前页最多 100 行；E2E 实测 20→5 行 |
| 取消/失败任务 | 延续现有状态门禁，失败任务不能预览 |

## 未完成项

R6.1 只关闭预览全量响应风险。R6.2 项目模板并发锁、R6.3 重复时间窗、R6.4 Decimal 阈值、R6.5 幂等清单和 R6.6 H01/H02/H07 行为矩阵仍未完成。错误行下载继续沿用受认证的分页接口；AI 映射后的版本化错误文件与更完整审核工作台属于后续 M3/M5，不在本提交中伪装完成。

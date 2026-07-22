# R6.3 重复候选时间窗修复与验收报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

问题：`R6-DUPLICATE-WINDOW-001`

状态：`verified`（工程时间窗已关闭；正式重复政策仍为 H03 `pending_human_decision`）

## 红灯复现

修改前给 `duplicate_submission` 配置 `windowDays: 2`，规则查询仍只生成：

```text
occurredDate >= 2026-01-01T00:00:00.000Z
occurredDate <  2026-01-02T00:00:00.000Z
```

定向 Jest 红测收到上述单日范围，而期望范围为 `2025-12-30T00:00:00.000Z` 至 `2026-01-04T00:00:00.000Z`，证明配置虽然被 DTO/服务校验接受，却没有参与候选计算。

## 调用链

| 环节 | 修复后行为 |
| --- | --- |
| DTO/服务校验 | `windowDays` 只接受整数 `0..365`；未知参数仍拒绝 |
| 持久化 | 新建和更新规则均保存显式有效值；旧 `{}` 条件按保守默认补为 `0` |
| Seed | 默认重复规则显式使用 `{ "windowDays": 0 }` |
| 规则加载 | 从 `RiskRule.conditionJson` 解析 `duplicate-candidate-policy/1.0` |
| 日期语义 | UTC date-only，`windowDays` 是前后对称、包含两端日期的日历日半径 |
| Prisma 查询 | 日期范围成为所有候选信号的全局条件，拒绝状态工单继续排除 |
| 结果与审计 | 规则结果、异常、audit 和 ledger 均保存窗口、命中日期偏移、信号和候选 ID |

0 天仅覆盖参考 UTC 日；2 天覆盖 `[-2, +2]`，查询使用 `[startInclusive, endExclusive)` 表达。使用 UTC 是现有工单 `YYYY-MM-DD -> T00:00:00.000Z` 契约的延续，不从浏览器或系统本地时区推断日期。

## H03 安全边界

本阶段只修复配置空转，不制定正式重复业务规则：

- 结果名称统一为“重复候选”，`candidateOnly=true`，`automaticAction=none`；
- 当前工程信号只限同项目 `WorkOrder` 内的精确金额、附件 SHA-256 或业务引用精确匹配；
- 金额容差、正式指纹、员工范围、Excel/OCR/手工/工单跨来源归一化、自动阻断/合并/删除/驳回均未获 H03 批准；
- 策略证据显式保存 `H03_PENDING_*` 状态，候选工单不会被删除、改写或静默忽略；
- H03 获批后应新增版本化政策和迁移/回放方案，不得改变历史 `RuleRunResult` 的解释。

## 测试证据

| 命令/场景 | 结果 |
| --- | --- |
| 修改前 `windowDays=2` 红测 | `failed`，实际仍为单日范围 |
| 重复策略与服务定向单测 | 2/2 suites，8/8 tests `passed` |
| 定向 PostgreSQL 持久化/证据链 | 1/1 suite，3/3 tests `passed` |
| 后端全量 Jest | 33/33 suites，299/299 tests，19.644 s |
| PostgreSQL 全量 | 4/4 suites，71/71 tests，350.385 s |
| Playwright | 17/17，54.3 s；清理后文件残留 0 |
| 前端 runtime/build | 4/4；3,144 modules `passed` |
| 后端 build | Prisma Client、应用和脚本 TypeScript `passed` |
| Prisma 双路径 | 25 条空库安装、24→25 升级；41 表/27 enum/173 index/77 FK |
| Repository hygiene | 593 个 tracked/candidate 文件通过 |
| 根目录/后端生产依赖审计 | 均为 0 vulnerabilities |

边界自动断言覆盖 0 天、365 天、前后边界、边界外第一日、跨月、跨年、闰年和带偏移时间戳的 UTC 归一化。真实 PostgreSQL 还验证 0/365 的 API 持久化、366 的 400 拒绝、-2/+2 命中、+3 不命中，以及四类证据内容一致。

## 数据库与回滚

本阶段不修改 Prisma schema，不新增 migration。现有 25 条 migration 的空库和升级路径继续通过。

回滚只需回退策略 helper、规则查询、seed 和测试；没有数据结构回滚。已经产生的规则结果与异常保留其窗口证据，不应在回滚时删除。

## 下一步

R6.4 将处理金额/比例阈值经 JavaScript `number` 后再构造 Decimal 的精度风险。H03 在获得财务与业务负责人签字前继续保持 `pending_human_decision`，不阻塞 R6.4-R6.6 的独立工程工作。

# 周五演示验收记录

## 人工真值

| Excel 行 | 金额 | 证据 | 预期处置 |
| --- | ---: | --- | --- |
| 2 | `1250.25` | 普通数值单元格 | 正常纳入 |
| 3 | `8765.43` | `SUM(8000,765.43)` 的缓存结果 | 不执行公式；显示 warning；由另一财务确认 |
| 4 | `3406.53` | 普通数值单元格 | 正常纳入 |
| 合计 | `13422.21` | bigint 分币求和 | 报表与 Snapshot 增量必须逐分一致 |

## 批准前后差异

| 观察点 | 财务 B 批准前 | 最终确认后 |
| --- | --- | --- |
| 通用经营记录列表 | 找不到该任务的暂存记录 | 恰好新增 3 条 `confirmed/excel` 记录 |
| 通用记录详情/修改/确认/作废 | 对未来确定性 record ID 统一返回 404 | 仅能按正式记录权限读取/操作 |
| 项目结构 | record ID 集合、记录数、成本均不变 | 只新增上述 3 个 record ID；成本增加 `13422.21` |
| 老板经营日报 | 确认支出与记录数保持基线 | 确认支出增加 `13422.21`；记录数增加 3 |
| ReportSnapshot | 不含暂存记录 | sourceCount 增加 3；CNY cost 增加 `13422.21` |
| 审批身份 | 财务 A 按钮禁用 | 不同账号财务 B 才能批准 |
| 重复提交 | 不适用 | 相同 Idempotency-Key 返回相同结果，不重复入账 |

## 已执行自动化证据

| 门禁 | 实际结果 | 状态 |
| --- | --- | --- |
| 演示环境纯函数门禁 | `npm run demo:config:test`，6/6 通过 | `PASS` |
| 演示库重建 | `npm run demo:reset`，43 migrations，无待执行 migration，seed/fixture/核验通过 | `PASS` |
| 演示库只读核验 | `npm run demo:verify`，账号、项目、模板、当天 3 行、公式证据及 `13422.21` 均匹配 | `PASS` |
| 本地服务 smoke | `/api/health/ready` 返回 database/storage/models ok；Web 返回 200 且存在 root | `PASS` |
| 一键故事复验 | `npm run demo:test`，收紧前后连续两次均为 1/1；用例 15.1-15.2 秒、总耗时 21.5-21.7 秒；teardown 无文件残留 | `PASS` |
| 周五单条 E2E | 真实 API/数据库，1/1，最终 21.6 秒 | `PASS` |
| 完整 Playwright | 18/18，64.9 秒 | `PASS` |
| 后端单元 | CR-012 最终复验 50 suites / 464 tests | `PASS` |
| PostgreSQL + 强制 Redis | 14 suites / 124 tests | `PASS` |
| migration 双路径 | CR-012 最终复验空库 43 条及 42 -> 43 升级 | `PASS` |
| 构建/runtime/docs/hygiene/audit | 双端 build、runtime 4/4、96 docs/167 links、768 candidates、双端 0 vulnerabilities | `PASS` |
| CR-010 远端 Build/CodeQL | 两项均成功 | `PASS` |
| CR-011/CR-012 新 SHA 远端 CI | SHA `66749b3`：Build `29828098638`、CodeQL `29828098718` | `PASS` |
| CR-013 新 SHA 远端 CI | SHA `7d363f6`：Build `29831004356`、CodeQL `29831004341` | `PASS` |

详细 E2E 断言见 [CR-011 提交审查](../../commit-reviews/CR-011_friday-excel-report-demo-e2e.md)。CR-011 与本交付包均已包含在远端 SHA `66749b3`，上表链接是该 SHA 的直接证据。

## 三次连续人工演练

自动化通过不等于人工演练。每次必须先 `demo:reset`，按 [Runbook](DEMO_RUNBOOK.md) 完整走完，再填写真实开始/结束时间与偏差。

| 演练 | 日期/操作者 | reset/verify | 5-8 分钟主线 | +3 条 / +13422.21 | 偏差与证据 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 未执行 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | 无 | `NOT_RUN` |
| 2 | 未执行 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | 无 | `NOT_RUN` |
| 3 | 未执行 | `NOT_RUN` | `NOT_RUN` | `NOT_RUN` | 无 | `NOT_RUN` |

## GO / NO-GO 门禁

现场演示标记 `GO` 前必须同时满足：

1. 当前候选提交的 Build 与 CodeQL 均为绿色，或项目负责人明确接受已记录的纯外部网络阻塞。
2. 同一候选代码连续三次人工演练通过，且每次从独立 reset 开始。
3. 现场机器已提前验证 PostgreSQL、`3101`/`4173` 端口和浏览器。
4. 演示只使用合成 fixture、Mock Provider 和非生产账号。
5. 演示者明确说明 [能力限制](LIMITATIONS.md)，不把工程验证说成真实准确率或生产就绪。

当前结论：`CONDITIONAL_NO_GO`。自动化、本机 smoke 和远端 CI 已通过，但三次人工演练仍为 `NOT_RUN`。

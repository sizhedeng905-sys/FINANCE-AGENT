# B8-05 老板 AI Claim Grounding 验收报告

更新日期：2026-07-16

## 结论

B8-05 工程门禁已通过。模型不再以自然语言中的“某个数字曾在上下文出现”为可信依据，而只允许输出结构化 Claim；后端逐项校验 scope、期间、指标、值、单位、工具和字段路径，再由确定性 renderer 生成中文。所有错位数字攻击均被拒绝或进入安全 fallback，正式 API 建立的 PostgreSQL 黄金账与 Reports API、排行工具和 AI Claim 完全一致。

H-08（老板/授权人审核标准问题和答案）与 H-12（外部 AI 数据政策）仍为 `blocked_external`。本阶段证明本地工程约束和合成黄金数据一致性，不代替老板业务口径签字，也不批准真实数据发送给外部 Provider。

## Claim 契约

每个财务 Claim 必须包含：

```json
{
  "scopeType": "company|project|customer|work_order",
  "scopeId": "stable-id",
  "period": "2038-05",
  "metric": "income|expense|profit|record_count|risk",
  "value": "750.00",
  "unit": "CNY|count",
  "sourceTool": "get_project_summary",
  "sourcePath": "data.profit"
}
```

- Provider 只能返回 `{"claims": [...]}`，不能返回最终可信中文。
- 后端从已授权工具上下文和当前问题生成唯一候选 Claim，Provider 不得补算、换值或交换语义。
- JSON Schema 禁止附加字段，并限制 scope、period、metric、value、unit、tool 和 path 格式。
- 校验器按完整元组匹配候选事实；只出现相同数字不足以通过。
- 无数据时唯一合法结果为 `{"claims":[]}`；任何编造数字都会进入 `no_data_claim` 拒绝路径。
- 验证通过后，中文答案只由后端确定性 renderer 使用已验证 Claim 和受控工具元数据生成。

## 攻击门禁

| 攻击 | 结果 |
| --- | --- |
| 收入与成本互换 | `metric/sourcePath/value` 不匹配，拒绝 |
| 项目甲与项目乙互换 | `scopeType/scopeId` 不匹配，拒绝 |
| 本月与上月互换 | `period` 不匹配，拒绝 |
| 记录数、日期或工单号冒充金额 | 非允许 `sourcePath`，拒绝 |
| 最高项目回答为最低项目 | 必须引用排序后 `data.items[0]`，拒绝其他索引 |
| 项目排行冒充客户排行 | `groupBy` 决定 scopeType 和稳定 scopeId，拒绝 |
| Prompt Injection、网址、命令、假系统提示 | 不进入 Claim Schema；确定性 renderer 不复述不可信指令 |
| 工具无数据时编造数字 | `no_data_claim`，拒绝 |

攻击测试只报告错误分类，不在失败报告中保存问题全文或业务值。

## 排行工具

- 新增 `GET /api/reports/ranking`，强制显式提交 `groupBy=project|customer` 和 `direction=highest|lowest`。
- `metric` 支持 `income|expense|profit`，期间沿用日报、周报和月报的北京时间边界。
- 项目按 projectId 聚合；客户按规范化 customerName 聚合并生成稳定的哈希 scopeId。
- 排序使用 Prisma Decimal，不经过 JavaScript 浮点数；同值按稳定 scopeId 排序。
- AI 使用独立 `get_finance_ranking` 工具，不能再把默认降序项目排行复用成客户或最低排行。

## PostgreSQL 黄金数据

集成测试通过正式 HTTP API 完成以下步骤，不直接插入经营记录：

1. 财务创建 3 个项目，归属 2 个客户。
2. 财务给每个项目启用系统收入和报销模板。
3. 财务创建并确认 6 条 2038-05 收支记录。
4. 分别调用项目月报、项目最高/最低排行和客户最高/最低排行。
5. 老板通过 AI API 查询三个项目的收入、支出、利润，以及项目/客户排行。
6. 按 scope、period、metric、value、unit、sourceTool、sourcePath 逐字段核对 Reports 与 Claim。

黄金断言失败只输出匿名 `caseId`、字段路径和 `mismatch` 分类。测试数据全部为合成值，清理后不保留项目、记录、会话或调用日志。

## 72 条快速基准

既有 72 条内存基准继续作为快速工具选择、Schema、无数据和注入回归，不再被描述为真实数据库证明。

| Provider | 工具选择 | 原始 Claim 通过 | 有效 Grounding | 事实/无数据/注入/Schema | fallback | Provider 错误 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mock | 100% | 100% | 100% | 100% | 0 | 0 |
| 本地 Qwen3-14B-AWQ | 100% | 98.61% | 100% | 100% | 1 | 0 |

本地 Qwen 72 条总耗时约 50.6 秒，推理延迟 p50 `487 ms`、p95 `1,351 ms`、最大 `1,539 ms`。唯一一次原始偏移是 Claim 数量不符，后端拒绝后使用确定性 fallback；最终失败 case 为 0。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| Claim 攻击单测 | 13/13 |
| 后端单元测试 | 18/18 suites，199/199 tests |
| PostgreSQL 集成 | 54/54 tests；22 migrations；无 pending migration |
| 标准 Playwright | 14/14 tests；teardown 文件残留 0 |
| 72 条 Mock/本地 Qwen | 两组均通过；本地 Provider 错误 0 |
| 权限与所有权 | finance/employee/reviewer 调用 AI 为 403；两个 boss 的会话和调用日志互不可见 |
| 构建 | 前端与后端 production build 通过 |
| Prisma / 仓库卫生 | schema validate 通过；439 个 tracked/candidate files 通过 |
| 生产依赖审计 | 根目录与后端均为 0 vulnerabilities |

测试未读取或提交公司真实问题、业务值、模型原始回答或密钥。详细本地基准仅写入 Git 忽略的 `.realdata-test/reports/`。

## 自动化入口

```powershell
npm test --prefix backend -- --runInBand
npm run test:integration --prefix backend
npm run realdata:ai-benchmark --prefix backend -- --provider mock
npm run realdata:ai-benchmark --prefix backend -- --provider local
npm run build --prefix backend
npm run build
npm run test:e2e
```

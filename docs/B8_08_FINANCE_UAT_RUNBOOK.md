# B8-08 人工财务 UAT 运行手册

更新日期：2026-07-17

## 当前状态

- 工程工具：已准备。
- 人工业务验收：`blocked_external`。
- 允许结论：可开始隔离 UAT，不得描述为财务验收通过或 production-ready。
- 数据边界：工具不读取原始业务文件，只按人工填入的匿名 `sampleId` 和数据库证据 ID 查询 `_test` PostgreSQL。

Codex 只提供模板、校验、自动对账和问题追踪。金额真值、入账粒度、重复/冲销政策、OCR 标签、公司政策和签字必须由指定人员完成。

## 隐私与环境

1. 只允许使用数据库名以 `_test` 结尾的 PostgreSQL；CLI 对其他数据库失败关闭。
2. 原始文件保持只读，不移动、改名、覆盖或提交 Git。
3. 原文件名、客户/个人身份、OCR 原文、业务明细、完整哈希和生产密钥不得进入 manifest、Markdown、截图或 CI artifact。
4. UAT 工作区固定在 Git 忽略的 `.realdata-test/uat/`；公开文档只记录场景状态、匿名审批编号和 Issue 编号。
5. manifest 的金额期望必须是固定两位小数字符串；脚本按整数分计算，不使用 JavaScript 浮点数。
6. OCR 始终人工确认后入账；老板 AI 的自然语言不得替代结构化报表和财务真值。

## 初始化

```powershell
cd backend
npm run uat:init
npm run uat:validate
```

首次执行会创建且不会覆盖：

```text
.realdata-test/uat/b8-08/
  manifest.local.json
  issue-log.local.md
  signoff.local.md
```

可提交的空白结构见：

- `docs/templates/B8_08_UAT_MANIFEST.example.json`
- `docs/templates/B8_08_UAT_ISSUE_LOG_TEMPLATE.md`
- `docs/templates/B8_08_UAT_SIGNOFF_TEMPLATE.md`

## Manifest 填写

每个 `UAT-01` 至 `UAT-08` 必须恰好出现一次：

- `sampleIds`：只填 `sample-...` 匿名编号。
- `recordIds`：本次人工真值对应的经营记录 ID。
- `importTaskIds`：需要核对行数/状态的导入任务 ID。
- `ocrTaskIds`：需要核对纠错和入账关系的 OCR 任务 ID。
- `expected`：人工真值；未知项保持 `null`，禁止让脚本反向生成“人工期望”。
- `humanDecisionRefs`：关联 H-01 至 H-12。
- `issueRefs`：自动或人工失败对应的 `UAT-ISSUE-NNN`。
- `status`：由人工更新；脚本不会把人工状态改为通过。

`expected` 可核对：confirmed actual 记录数、非报表状态数、收入/成本/利润、audit/ledger 覆盖数、精确来源重复组、导入任务/行数、OCR 任务/纠错/生成记录数。

## 自动对账

确认 `backend/.env` 指向隔离 `_test` 数据库后执行：

```powershell
cd backend
npm run uat:validate
npm run uat:reconcile
```

输出写入忽略文件：

```text
.realdata-test/uat/b8-08/reconciliation-report.local.json
```

结果解释：

- `automaticStatus=passed`：八个场景中已填写的自动期望全部匹配，不代表人工签字。
- `partial`：部分场景自动核对通过，其余仍待输入。
- `awaiting_input`：没有足够人工期望，不能形成自动结论。
- `failed`：至少一项金额、数量或证据不一致；命令退出码为 2。
- `humanGateStatus` 始终为 `external_unverified`，脚本不会认证真实签名。
- `untrackedFailures` 非空时，必须先在问题台账登记并关联开放 Issue。

报告只输出聚合金额/数量、状态分布、短哈希和审批状态，不输出项目、客户、描述、动态字段、OCR 文本或原文件信息。

## 八个场景

### UAT-01 Excel 运输账单

1. 人工检查 Sheet、隐藏状态、1-3 行表头、字段、公式缓存和媒体提示。
2. 将日期、金额、车牌、司机、起止点、票数/吨数映射与人工真值逐项核对。
3. 填写记录数、收入/成本/利润、导入任务数/行数及 audit/ledger 期望。
4. 运行对账并逐分比较；完成 H-01、H-06。

### UAT-02 考勤/劳务

1. 财务决定每日明细、人员月汇总或结算单汇总。
2. 明确明细与汇总互斥，budget/reconciliation 不计 actual。
3. 验证工时、人员、岗位、单价、金额和期间。
4. 完成 H-01、H-02；未决定前不得自动阻断或合并业务。

### UAT-03 报销与凭证

1. 人工核对主表与内嵌凭证归属；图片只作为证据，不成为普通字段。
2. 决定缺凭证是阻断、警告还是例外审批。
3. 公式默认不执行，只有财务显式授权才使用有限缓存值。
4. 完成 H-07、H-11。

### UAT-04 OCR

1. 使用电子票据、长图和多页匿名样本核对 evidence、页码、置信度和冲突。
2. 人工修正金额、日期、主体，核对 before/after、操作者、时间、audit。
3. 确认前经营记录为 0；确认后恰好一条；重复确认不重复入账。
4. 非开发人员冻结盲测后再运行真实准确率；完成 H-04、H-05。

### UAT-05 报表

1. 用财务已确认的 L3 真值按日、月、项目核对收入、成本和利润。
2. 检查北京时间边界、零金额、空分类以及人工批准的负数政策。
3. 确认只统计 confirmed actual，不统计 budget/reconciliation 或作废记录。
4. 完成 H-06；差异必须逐分定位并登记 Issue。

### UAT-06 老板 AI

1. 老板/授权人审核标准问题及答案，覆盖期间、口径、项目、排行、无数据和下钻。
2. 每个数字与相同参数的结构化工具逐项核对。
3. 保持 Claim 校验和确定性 renderer；不以原始模型文字作为财务结论。
4. 完成 H-08、H-12。

### UAT-07 重复业务

1. 分别测试同文件、不同文件、Excel/OCR/手工跨来源重复。
2. SHA-256 与任务幂等只证明技术重复，不能代替业务指纹。
3. 财务＋业务定义字段、时间窗、金额容差和阻断/警告/放行策略。
4. 完成 H-03；政策签字前继续人工复核，不扩大自动去重。

### UAT-08 冲销、更正、作废

1. 核对原记录、作废时间/操作者、来源任务、audit、ledger 和历史报表。
2. 测试负数、反向记录、原记录软作废和关账期后的更正候选流程。
3. 当前系统已提供软作废与不可变审计证据，但不会自行定义正式会计冲销模型。
4. 财务完成 H-02 后，任何新增状态/反向分录规则返回对应工程阶段实现并补回归。

## 问题与签字

- P0/P1 必须创建正式 GitHub Issue 或公司缺陷单，并在本地问题台账记录匿名引用。
- P2/P3 也需登记，不得只保留在聊天记录。
- `closed` 问题必须有修复提交和独立复验引用。
- 四类签字：财务、业务、老板/授权人、安全/系统负责人。
- 任一签字为不通过，B8-08 保持 blocked；有条件通过必须列出未关闭问题和限制。
- H-16 最终 UAT 签字不能由 Codex、测试脚本或开发人员代替。

## 完成门禁

B8-08 只有在 H-01 至 H-12 中适用项和 H-16 完成、八个场景有证据、所有 P0/P1 关闭、自动对账无未登记失败时，才能由授权人员标记为 `passed` 或 `conditional`。在此之前，工程状态只能写“工具准备完成，人工门禁 blocked_external”。

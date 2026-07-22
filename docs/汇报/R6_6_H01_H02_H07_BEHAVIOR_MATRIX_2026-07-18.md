# R6.6 H01/H02/H07 现有行为矩阵

更新日期：2026-07-18
执行分支：`agent/b8-stable-hardening`
状态：工程盘点与保守基线已完成；业务决定仍为 `pending_human_decision`

## 1. 决策基线

唯一决策文件 [`FINANCE_AGENT_HUMAN_DECISIONS_UAT_SIGNOFF_2026-07-18.md`](../FINANCE_AGENT_HUMAN_DECISIONS_UAT_SIGNOFF_2026-07-18.md) 已建立，但 H01-H16 全部为 `Pending`，没有决策人、签字、业务样例或批准证据。因此本阶段只做以下工作：

- 记录当前代码真实行为和隐含假设；
- 将 H01/H02/H07 的 pending 状态写入版本化基线，并冻结到新模板/确认快照；
- 修正“软作废等于冲销”的错误文案，不改变正数门禁或作废状态机；
- 复用现有合成测试证明保守边界；
- 写 migration 草案但不执行，不迁移或改写现有业务数据。

## 2. 当前记录链

```text
手工请求 --------> 一次显式确认 --------> BusinessRecord
Excel ImportRow --> 财务确认/Worker -----> BusinessRecord（每个映射行一条）
OCR Task --------> 财务人工确认 --------> BusinessRecord（每个任务至多一条）
完成工单 --------> 老板终审/补生成 -----> BusinessRecord（每个工单至多一条）

Template: recordType + accountingDirection + dataLayer
BusinessRecord: sourceSnapshot + templateSnapshot + confirmationSnapshot
RawFile/附件: 受权限、安全扫描、项目归属和删除保护约束
```

正式报告只读取 `status=confirmed AND dataLayer=actual`。这能阻止草稿、待确认、作废、预算和对账层进入当前经营汇总，但不能替代 H01 的明细/汇总业务互斥，也不能提供 H02 的历史报告冻结或冲销重述。

## 3. H01 入账粒度矩阵

| 当前代码实际行为 | 对应人工决定 | 冲突/缺口 | 当前保守行为 | 需要的测试/迁移 |
| --- | --- | --- | --- | --- |
| 手工补录一次请求生成一条记录 | 每类业务按明细、日汇总、月汇总还是结算单入账 | API 不知道该请求代表明细还是汇总 | 必须由 finance 显式选择项目和已启用模板；不自动分类为正式粒度 | H01 批准后增加粒度枚举、业务键和正常/拒绝/报表样例 |
| Excel 每个有效 `ImportRow` 生成一条记录 | 哪个 Sheet/表头/行集合是正式入账层 | 当前只确认选中的 Sheet，但重新上传同文件可另选汇总 Sheet | 财务选择 Sheet/表头；失败批次不发布；不自动把其他 Sheet 入账 | 增加 approved source scope、granularity group 和明细/汇总互斥唯一策略 |
| OCR 每个确认任务至多生成一条记录 | 多页/多票/一图多业务如何拆分 | 当前任务粒度不等于正式会计粒度 | OCR 不自动确认；空值/冲突进入人工处理 | H01/H07 批准后增加 document-to-record split revision |
| 每个完成工单至多生成一条记录 | 工单是否是申请、结算还是实际业务事实 | 当前终审会按模板生成 actual 记录 | 只允许已启用 actual 模板，老板终审且项目锁内生成 | H01 批准后为工单类型绑定正式粒度和例外审批 |
| 模板决定 `actual/reconciliation/budget` | 哪些模板可产生 actual | finance 当前可创建/启用 actual 模板 | 客户端不能覆盖模板数据层；报告只读 confirmed actual | H01/H10 批准后增加模板发布审批和粒度版本 |
| 报表按记录求和 | 汇总源与明细源如何互斥 | 如果两者被分别确认为 actual，系统会双计 | 不自动猜测或删除；H03 前只提示重复候选 | H01/H03 后增加 granularity group 唯一/阻断政策和迁移回填 |

### H01 当前隐含假设

1. “一行等于一条可入账事实”只对当前合成流程成立，没有人工签字证明适用于运输、劳务和报销全部真实文件。
2. `dataLayer=actual` 由模板配置表达，但模板本身没有“明细/汇总/结算”元数据。
3. `rawFileId` 对 ImportTask 唯一只能阻止同一上传对象建立两个 Excel 任务；重新上传同内容、跨来源或 OCR/手工重录仍受 H03。
4. 当前不执行自动粒度选择、自动双计阻断、合并或删除。

## 4. H02 金额、冲销、更正、作废与关账矩阵

| 当前代码实际行为 | 对应人工决定 | 冲突/缺口 | 当前保守行为 | 需要的测试/迁移 |
| --- | --- | --- | --- | --- |
| 正式主金额必须大于 0 | 是否允许负数、退款、红字和零金额 | H02 尚无批准；旧文案错误暗示“作废就是冲销” | 继续拒绝零/负数；错误明确引用 H02 pending | 批准后按业务类型测试符号、方向、期间和 Decimal 边界 |
| `accountingDirection` 由不可由客户端覆盖的模板决定 | 负数与收入/支出方向如何组合 | 当前没有 signed amount 语义 | 保持模板方向，不用负号猜收入/支出 | 增加 adjustment direction/version，禁止双重反向 |
| confirmed 记录不能 PATCH | 更正是覆盖、版本还是新记录 | 没有 correction/supersedes/reversal 关系 | 保留原记录，只允许另建草稿或软作废；不称为正式更正 | H02 后增加不可变关联和成对 ledger 事件 |
| DELETE 是软作废：状态变 `rejected`，清除 confirmed 标记，保留值/来源/快照/附件 | 作废与会计冲销是否等价 | 当前没有反向分录，不能抵消历史金额 | 报表排除作废记录；audit/ledger 只写一次 | 决定历史重述后增加报表快照和作废/冲销不同命令 |
| 当前报表每次查询当前 confirmed actual | 作废后历史日报是否重述 | 没有不可变 ReportSnapshot | 不宣称历史报告已冻结或正式对账 | M6 建 canonical Snapshot；H02/H06/H08 决定重述政策 |
| 没有 accounting period/close/reopen | 关账日、跨期更正和重开权限 | 任何日期仍可创建记录 | 权限、项目和模板校验仍执行；不伪造“已关账” | H02/H10 后增加期间表、状态、双人审批和并发测试 |

### H02 本阶段代码修正

- 新增 `financial-policy-baseline/1.0`，H02 明确为 `pending_human_decision`；`automaticReversal=false`、`correctionRelation=not_configured`、`periodClose=not_configured`。
- 正式金额仍为正数。负数 DTO 错误和零金额服务错误都明确引用 H02；零金额返回稳定 `FINANCIAL_POLICY_H02_PENDING`。
- 新确认快照保存 H01/H02/H07 的 pending 状态，旧记录不回填、不改写。
- “冲销请使用显式作废流程”已删除，因为软作废不产生反向会计事实。

## 5. H07 报销主表与证据矩阵

| 当前代码实际行为 | 对应人工决定 | 冲突/缺口 | 当前保守行为 | 需要的测试/迁移 |
| --- | --- | --- | --- | --- |
| 工单附件使用 `work_order_attachments` 关系和唯一约束 | 哪些附件是必填凭证、主表或补充材料 | 没有 evidence role | 仅允许本人可编辑工单上传；提交后锁定；安全扫描失败关闭 | H07/H11 后增加角色、页码、主从和替换 revision |
| 手工记录附件保存在顶层 JSON 与 file RecordValue | 一张凭证属于哪条/哪些记录 | 没有数据库 FK/不可变证据关系表 | 项目归属、无工单占用和 clean scan 校验；被记录引用后禁止删除 | 增加 `business_record_evidences`，先可空回填再收紧 |
| Excel 记录把任务原文件作为附件 | 工作簿主表与内嵌票据如何关联到行 | 当前只关联整份 rawFile，不能定位内嵌凭证到行 | 财务确认前不发布；原文件和 ImportRow 来源保留 | H07 后增加 sheet/row/media evidence ref 与 review revision |
| OCR 记录只允许 file 字段引用当前 OCR 原文件 | OCR 值与人工主数据冲突时谁优先 | OCR candidate 不是正式主数据，但尚无 approved role enum | OCR 只生成候选；finance 人工纠错/确认后才入账 | 增加 token/bbox evidence ref、MANUAL_OVERRIDE 和批准快照（M4/M5） |
| 作废记录仍保留附件引用 | 作废后证据保留多久、谁可下载 | H14/H11 未批准 | 不物理删除被引用原件；访问继续鉴权并审计 | H11/H14 后实现保留/净化/下载政策 |
| 同一 rawFile 可建立多个 OCR 任务 | 一票多记录、重复扫描如何处理 | H03/H07 未决定，可能形成重复候选 | 每个任务须财务确认；不自动合并或删除 | H03/H07 后增加允许复用范围与唯一/审批政策 |

## 6. Migration 草案（未执行）

以下只记录最小演进方向，不是已批准 schema，也不创建 migration：

```text
record_granularity_metadata
  business_record_id (unique FK)
  granularity_kind: DETAIL | DAILY_SUMMARY | MONTHLY_SUMMARY | SETTLEMENT | OTHER
  granularity_group_key
  policy_version
  approved_by / approved_at

business_record_adjustments
  original_record_id
  adjustment_record_id
  relation_type: CORRECTION | REVERSAL | SUPERSEDES
  policy_version
  approved_by / approved_at
  unique(original_record_id, adjustment_record_id)

accounting_periods
  project_scope / period_start / period_end
  status: OPEN | CLOSED | REOPENED
  policy_version / approved_by / approved_at

business_record_evidences
  business_record_id / raw_file_id
  evidence_role / source_ref / page / bbox
  review_revision / content_hash
  created_by / created_at
  immutable after formal confirmation
```

执行前必须取得对应 H 决定，定义唯一性、回填、旧 JSON 兼容、删除权限、历史报表和回滚方案。不得根据本草案自动生成生产 migration。

## 7. 自动化证据映射

| 边界 | 现有/新增证据 |
| --- | --- |
| pending 决策不会开启自动行为 | 新单元测试断言 H01/H02/H07 均 pending，自动粒度、自动冲销、附件主数据和 OCR 自动提交均关闭 |
| 零/负数 | 新单元和 PostgreSQL API 断言；负数 400 引用 H02，零金额返回稳定 policy reason |
| 作废保留 | PostgreSQL 断言状态变更后金额、动态值、模板/来源快照和附件引用不变，audit/ledger 各一次 |
| 报表边界 | 既有 PostgreSQL 黄金账断言只统计 confirmed actual；draft、pending、rejected、reconciliation 和 budget 均排除 |
| Excel 粒度 | 既有多 Sheet、Sheet/表头选择、5,001/30,196/49,999 行确认和失败原子发布测试 |
| OCR 证据 | 既有确认前记录差值 0、file 字段只能引用当前原件、纠错/确认/并发/lease 恢复测试 |
| 工单附件 | 既有项目归属、上传者、状态、安全扫描、提交后锁定和终审单记录测试 |

## 8. 关闭结论

R6.6 的工程关闭条件是“现有行为可见、未决假设有 H 编号、保守默认可测试、没有擅自固化正式业务结论”。它不表示 H01/H02/H07 已批准。

当前能力声明：

- `passed`：合成数据上的正数门禁、来源/模板快照、软作废保留、confirmed actual 报表过滤和附件安全关系；
- `pending_human_decision`：入账粒度、汇总/明细互斥、负数、冲销、更正、关账和附件主从；
- `not_implemented_by_design`：自动冲销、自动关账、自动把票据当主数据、自动跨来源合并；
- `not_production_ready`：真实业务口径、真实对账和最终签字仍未完成。

## 9. 实际回归结果

| 门禁 | 结果 |
| --- | --- |
| 后端单元 | 36/36 suites，329/329 tests，passed |
| PostgreSQL 集成 | 5/5 suites，75/75 tests，passed |
| 大批量抽样 | 30,196 行约 20.3 秒、RSS 增量 63.21 MiB；49,999 行约 37.1 秒、RSS 增量 317.07 MiB；连接峰值均为 10 |
| Playwright | 17/17 tests，passed；清理后文件残留 0 |
| 前端 runtime/build | 4/4；显式 API build 3,144 modules，passed |
| 后端 build | passed |
| Prisma | 空库 25/25、上一基线 24→25；41 tables、27 enums、173 indexes、77 foreign keys |
| Repository hygiene | 603 tracked/candidate files，passed |
| 依赖审计 | 根目录与 backend 均为 0 vulnerabilities |

这些是本机合成数据工程证据，不是生产 SLA、真实财务口径或人工 UAT 签字。

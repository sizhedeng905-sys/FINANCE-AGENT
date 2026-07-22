# FINANCE-AGENT H01-H16 历史决策与 UAT 索引

文档版本：`0.5-historical`
最近更新：2026-07-21
状态：历史索引，不再是人工输入或多角色签字入口

## 治理变更说明

项目只有当前用户一名项目负责人。自 2026-07-21 起，不再要求财务、业务、老板、安全、运维或独立审查人分别填写姓名、日期和签字，也不能以缺少多方签字阻塞可自动完成的工程工作。

这项治理变更不改变产品内四角色、后端权限、职责分离和不同财务账号审批规则。Excel/OCR 上传者仍不能批准自己的导入；真实样本、外部资源、独立审计和项目负责人亲自 UAT 仍须提供真实证据。

当前唯一入口：

- 已确认决定：[`owner-input/OWNER_DECISIONS.md`](owner-input/OWNER_DECISIONS.md)
- 最多十个开放问题：[`owner-input/OPEN_QUESTIONS.md`](owner-input/OPEN_QUESTIONS.md)
- 原始问卷：[`FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md`](FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md)

旧状态统一翻译如下：

| 旧术语 | 当前术语 |
| --- | --- |
| `Pending formal signoff` / `pending_human_decision` | `OWNER_CONFIRMATION_NEEDED` 或 `SAFE_DEFAULT_ACTIVE` |
| `Awaiting real evidence` / `awaiting_labels` | `REAL_SAMPLE_NEEDED` |
| `Blocked external` | `EXTERNAL_RESOURCE_NEEDED` |
| 工程/合成测试通过 | `ENGINEERING_VERIFIED` |
| 最终人工验收 | `OWNER_UAT_VERIFIED` |

## 已导入决定

- 2026-07-20 的负责人问卷按“方框内写入 `1` 为选中”解析。
- H01 后续澄清“按照每行明细”覆盖问卷 Q01 的旧勾选：每个有效明细行一条记录，汇总由程序计算，汇总与明细不得双计。
- 重复候选只提示，窗口前后 3 天且金额逐分一致；不自动删除、合并或拒绝。
- 费用明细为主记录并可关联多附件；缺少模板声明的必填附件时阻断。
- 对账按项目、日期、币种和收入/成本方向逐分一致；混合币种不相加。
- 老板 AI 先给确定性数字，证据不足明确拒答，并显示 Snapshot、来源和 warning。
- 四角色保持不变；最新任务书要求 Excel/OCR 继续由不同财务账号审批，覆盖问卷中自审批选项的宽松解释。
- 本地模型不可用时转人工；真实数据外发必须先稳定匿名并命中服务端 Provider 白名单。
- legal hold 禁止删除；全部真实门禁通过后才允许有限试运行。

完整决策及当前失败关闭行为见 [`owner-input/OWNER_DECISIONS.md`](owner-input/OWNER_DECISIONS.md)。

## H01-H16 当前索引

| 编号 | 主题 | 当前状态 | 当前证据或缺口 |
| --- | --- | --- | --- |
| H01 | 入账粒度、汇总与明细互斥 | `OWNER_CONFIRMED / REAL_SAMPLE_NEEDED` | 每个有效明细行入账，汇总不双计；仍需真实汇总行样例。 |
| H02 | 负数、冲销、更正、作废、关账 | `OWNER_CONFIRMATION_NEEDED` | 第一版不关账；负数白名单与更正后的报表语义仍需选择。 |
| H03 | 跨来源重复 | `OWNER_CONFIRMED / REAL_SAMPLE_NEEDED` | A-E 信号、前后 3 天、金额逐分一致且只提示；仍需真实正反样例。 |
| H04 | 17 份 OCR 字段真值 | `REAL_SAMPLE_NEEDED` | 需要冻结标签。 |
| H05 | 5 份 OCR 盲测 | `REAL_SAMPLE_NEEDED` | 需要未参与调参者完成盲测。 |
| H06 | 分币逐分对账 | `OWNER_CONFIRMED / REAL_SAMPLE_NEEDED` | Decimal 与分币框架已实现；周期和真实真值未关闭。 |
| H07 | 报销主数据与附件 | `OWNER_CONFIRMATION_NEEDED` | 主记录与冲突处理已确认；必填模板清单未确认。 |
| H08 | 老板问题与正确答案 | `OWNER_CONFIRMATION_NEEDED / REAL_SAMPLE_NEEDED` | 回答风格已确认；合理性规则、标准问题和真值未关闭。 |
| H09 | 出站脱敏 | `OWNER_CONFIRMED / REAL_SAMPLE_NEEDED` | 离开本机必须稳定匿名；仍需真实出站复核。 |
| H10 | 权限、职责分离、step-up | `OWNER_CONFIRMATION_NEEDED` | 四角色和第二财务已确认；step-up 方式未选择。 |
| H11 | 文件准入、下载、扫描 | `OWNER_CONFIRMATION_NEEDED` | 类型和下载角色已确认；扫描 break-glass 未确认，当前失败关闭。 |
| H12 | 外部 AI 数据政策 | `OWNER_CONFIRMATION_NEEDED / EXTERNAL_RESOURCE_NEEDED` | 外发需脱敏和白名单；Provider 详情未提供，当前 disabled。 |
| H13 | 服务器、域名、GPU、监控 | `EXTERNAL_RESOURCE_NEEDED` | 目标为授权云服务器；具体资源未提供。 |
| H14 | RPO/RTO、保留、删除、备份 | `OWNER_CONFIRMATION_NEEDED / EXTERNAL_RESOURCE_NEEDED` | legal hold 已确认；目标值、期限和云资源未提供。 |
| H15 | 独立代码与安全复核 | `EXTERNAL_RESOURCE_NEEDED` | 已选择外部审计服务，尚未提供服务与报告。 |
| H16 | 最终 UAT 与有限试运行 | `OWNER_CONFIRMED`，尚未 `OWNER_UAT_VERIFIED` | 已确认全部门禁通过后才试运行；当前不允许上线。 |

## 工程证据边界

- [`M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md`](汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md)：每行明细、汇总处置、第二财务和整批原子发布。
- [`M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md`](汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md)：confirmed actual、Decimal、分币种、不可变 Snapshot 和 Claim grounding。
- 工程证据只能标记 `ENGINEERING_VERIFIED`，不能替代 `REAL_SAMPLE_NEEDED`、`EXTERNAL_RESOURCE_NEEDED` 或 `OWNER_UAT_VERIFIED`。

## 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 0.1-0.4 draft | 2026-07-18 至 2026-07-20 | 建立旧 H01-H16 多角色签字模板并导入问卷与工程证据。 |
| 0.5 historical | 2026-07-21 | 依据唯一负责人治理要求降为历史索引，移除多角色签字门禁，链接当前 owner-input 台账。 |

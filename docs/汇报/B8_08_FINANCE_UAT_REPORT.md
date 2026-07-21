# B8-08 人工财务 UAT 工具与门禁报告

更新日期：2026-07-17

## 阶段结果：B8-08

- 状态：blocked_external（工程工具完成，人工 UAT 未签字）
- 基线提交：`8735528`
- 新提交：本报告所在 B8-08 提交
- 修改范围：八场景 UAT 运行手册、匿名 manifest、问题/签字模板、`_test` 数据库保护、整数分自动对账、audit/ledger/OCR/导入证据核对和未登记失败门禁
- 数据库迁移：无
- 新增测试：manifest/签字/Issue 失败关闭、非测试数据库拒绝、超大金额逐分精度、隐私输出、证据缺失、开放 Issue 关联，以及真实 PostgreSQL 记录/audit/ledger 对账
- 实际执行测试及结果：24/24 Jest suites、240/240 tests；2/2 PostgreSQL suites、59/59 tests；14/14 Playwright；前后端 build；UAT init/validate/reconcile CLI 通过
- 未执行测试及原因：八类真实业务场景、17 份 OCR 真值、5 份盲测、L3 人工总额、老板标准答案、重复/冲销政策和四方签字必须由授权人员完成，Codex 不得代填
- 新发现风险：跨来源重复策略仍按用户要求采用人工复核；正式冲销/更正/关账期模型必须等待 H-02，当前只能验证软作废、audit、ledger 和报表排除；没有人工真值时自动报告只能是 `awaiting_input`
- 真实数据源文件哈希：未接触
- 需要人工决定：H-01、H-02、H-03、H-04、H-05、H-06、H-07、H-08、H-09、H-10、H-11、H-12、H-16
- 下一阶段：B8-09（仅推进工程部署准备；真实 Staging 和发布门禁继续受人工/基础设施阻断）

## 工具边界

- `npm run uat:init` 在 Git 忽略的 `.realdata-test/uat/b8-08/` 创建 manifest、问题台账和签字文件；重复执行不覆盖人工内容。
- `npm run uat:validate` 要求 UAT-01 至 UAT-08 和 finance/business/boss/security 四类签字角色恰好各出现一次。
- manifest 不提供文件路径、客户/人员字段或 OCR 原文入口，只接受匿名 `sampleId` 和数据库证据 ID。
- 非 awaiting 签字必须提供外部审批编号和 UTC 时间；脚本只检查结构，不能认证真实签名。
- `npm run uat:reconcile` 只允许 PostgreSQL 且数据库名必须以 `_test` 结尾；输出只写 Git 忽略目录。
- 自动报告的 `humanGateStatus` 固定为 `external_unverified`，不会因自动测试通过而变为人工通过。

## 自动对账

- 金额固定为两位小数字符串并转换为 `bigint` 分币求和，已验证 `90071992547409.91 - 0.09 = 90071992547409.82`。
- 只将 selected、confirmed、actual 记录计入收入/成本/利润；其他状态和 data layer 单独计为无效记录事实。
- 可核对记录数、收入、成本、利润、audit/ledger 覆盖、精确来源重复组、导入任务/行数、OCR 任务/纠错/生成记录数。
- 缺失记录/导入/OCR 证据使用 12 位短哈希报告，不泄露原 ID；输出不含项目、客户、描述、动态字段、OCR 文本或原文件信息。
- 自动失败若没有关联 `open` 或 `in_progress` 的正式问题，会进入 `untrackedFailures` 并以退出码 2 失败。
- 空白人工输入烟测结果为 `automatic=awaiting_input`、`human=external_unverified`，符合“不伪造通过”的要求。

## 场景覆盖

| 场景 | 工具支持 | 人工门禁 |
| --- | --- | --- |
| UAT-01 Excel 运输账单 | Sheet/公式/导入行、记录金额和 audit/ledger 对账 | H-01、H-06 |
| UAT-02 考勤/劳务 | actual/budget/reconciliation 状态和金额事实 | H-01、H-02 |
| UAT-03 报销/凭证 | 导入、记录和附件归属操作手册 | H-07、H-11 |
| UAT-04 OCR | 任务、纠错次数、生成记录和人工确认检查 | H-04、H-05 |
| UAT-05 报表 | confirmed actual 收入/成本/利润逐分对账 | H-06 |
| UAT-06 老板 AI | Claim/工具对照步骤和签字模板 | H-08、H-12 |
| UAT-07 重复业务 | 精确来源重复事实、正式 Issue 记录 | H-03 |
| UAT-08 冲销/更正 | 软作废、状态分布、audit/ledger/报表核对步骤 | H-02 |

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端 build / Prisma | build 通过；24 migrations，无 pending migration |
| 后端单元测试 | 24/24 suites，240/240 tests |
| PostgreSQL 集成 | 2/2 suites，59/59 tests；新增真实 UAT 对账测试通过 |
| 大表回归 | 30,196 行 19.095 s、API 27 ms；49,999 行 33.191 s、API 77 ms |
| 资源峰值 | 30,196 行 RSS 增量 182.76 MiB；49,999 行 282.93 MiB；连接峰值 11 |
| 浏览器 E2E | 14/14 tests；teardown 文件残留 0 |
| UAT CLI | init 首次 3 个文件、重复 0 个覆盖；validate 8 场景/4 角色；空白 reconcile 安全等待输入 |
| 隐私 | 真实源文件未读取；本地 manifest/report 被 Git 忽略；敏感业务字段输出测试通过 |

## 外部阻断

- 财务负责人：H-01/H-02/H-03/H-06，金额、粒度、重复、冲销和关账期。
- 财务标注/非开发标注人员：H-04/H-05，17 份 OCR 真值和 5 份盲测冻结。
- 财务＋业务：H-07，报销主表与凭证归属。
- 老板/授权审批人：H-08，标准问题与答案。
- 公司授权/管理/安全人员：H-09/H-10/H-11/H-12，脱敏、职责分离、文件和外部 AI 政策。
- 财务、业务、老板和安全负责人：H-16 最终 UAT 签字。

上述项目完成前，B8-08 不得改为 passed，也不得作为进入生产的批准。B8-09 只能继续准备可复验部署工具和本地合成演练。

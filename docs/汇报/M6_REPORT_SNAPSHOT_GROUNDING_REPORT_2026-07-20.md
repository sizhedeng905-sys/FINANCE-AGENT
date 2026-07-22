# M6 不可变报告快照与 AI Claim Grounding 验收报告

> 日期：2026-07-20
> 分支：`agent/b8-stable-hardening`
> 起始 HEAD：`26412a0d66a86699e9d0dc9c44fb84d340c16c4d`
> 状态：`engineering_passed / pending_human_decision H06/H08`

## 1. 阶段结论

M6 已完成 canonical ReportSnapshot 与 AI 报告叙述的工程闭环：

1. 报告事实由固定后端查询生成，AI 不查数据库、不计算金额、不写 `BusinessRecord`。
2. 快照只读取 `confirmed + actual`，在 PostgreSQL `REPEATABLE READ` 事务中使用 `Prisma.Decimal` 计算。
3. 不同币种分别统计；存在多币种时顶层收入、成本和利润保持 `null`，不隐式换算或相加。
4. 每个来源记录冻结 `recordId + version + recordHash`，并形成稳定 `sourceDigest`；相同事实和口径复用同一个核心快照。
5. Snapshot、来源行、Narrative 和 Claim 由数据库触发器拒绝更新/普通删除；测试清理只能在事务内显式打开维护删除门。
6. 报告 AI 使用独立 `AI_REPORT_MODE` 和全局 kill switch；禁用、失败或非法输出均明确失败关闭，确定性快照仍可查看。
7. 模型只能从服务端生成的 Claim Catalog 中逐字选择，不得改写文字、值、类型、ID 或 `sourcePath`；所有 Snapshot warning 必须完整出现。
8. 叙述始终为 `NEEDS_FINANCE_REVIEW`，不能批准、提交或改变财务事实。

该结论仅证明非生产工程框架和合成数据验收。H06 的真实逐分对账、H08 的正式指标口径/老板标准答案与授权签字仍未完成，因此不能声明真实报表正确、真实 AI 有效或可生产上线。

## 2. 确定性快照

### 2.1 数据与一致性边界

- 支持 `DAILY/WEEKLY/MONTHLY`，日期边界固定为 `Asia/Shanghai`。
- 查询条件固定为 `BusinessRecord.status=confirmed` 与 `dataLayer=actual`。
- draft、`pending_confirm`、void、reconciliation 和 budget 均不进入 canonical actual Snapshot。
- 来源记录按稳定 ID 排序；金额以十进制字符串进入 canonical JSON。
- 核心 `snapshotHash` 排除随机 `snapshotId`、生成时间和数据库水位，但包含期间、范围、数据政策、指标、breakdown、warning、查询版本和来源 digest。
- `dataWatermark` 保存 PostgreSQL snapshot token 与来源 digest；同一事实重复请求通过 advisory transaction lock 返回同一快照。
- 所有 Snapshot 固定加入 `FORMAL_METRIC_POLICY_PENDING`，直到 H06/H08 正式关闭。

### 2.2 来源审计

`report_snapshot_sources` 保存：

- 业务记录 ID、版本、内容哈希；
- 项目、记录日期、币种、会计方向和精确金额；
- Snapshot 内唯一来源约束和原记录外键。

来源 API 使用服务端分页，单页上限 100，不把大量来源一次返回浏览器。

## 3. AI 叙述防线

### 3.1 Provider 输入

Provider 只接收最小化的 `report-narrative-input/1.0`：Snapshot ID/hash、报告类型、期间、数据政策、指标、warning、query/source 版本，以及服务端生成的 `allowedClaims` 和 `requiredWarningPaths`。原始业务记录、附件、完整公司文件和任意数据库工具均不提供。

Prompt Registry 使用 `report_narrative:v3`，并组合不可变 `finance_core_guard`。调用继续复用现有 `AiPromptVersion`、`AiModelConfig`、`AiTask`、`AiCallAttempt` 和 `AiCallLog`，完整冻结 Prompt/Schema/Provider/模型/转换/校验/脱敏/授权策略版本向量。

### 3.2 确定性校验

服务端拒绝：

- 未在 Claim Catalog 的 JSON Pointer、claim ID、类型、值或文字；
- 修改金额、数量、日期或 warning；
- 新增无依据数字，即使同一 Claim 也包含一个真实数字；
- 虚构客户、项目或其他实体，即使金额来自 Snapshot；
- 中文或英文的原因、预测、建议和无显式比较事实的比较语言；
- warning 路径缺失、多余、重复或 warning 文本未逐字复制；
- summary 不是某一条非 warning grounded Claim 的完整原文；
- 非严格 JSON、未知属性、非法状态和其他既有 Schema 攻击。

相同 Snapshot 和文字由新 Prompt/模型生成时，唯一性包含 `versionVectorHash`，新旧生成证据可并存；相同 AI task 的重放仍返回同一个 Narrative。

## 4. API 与前端

新增接口：

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| POST | `/api/reports/snapshots` | finance/boss | 创建或复用 canonical Snapshot |
| GET | `/api/reports/snapshots/:id` | finance/boss | 查看不可变 Snapshot |
| GET | `/api/reports/snapshots/:id/sources` | finance/boss | 分页查看来源证据 |
| POST | `/api/ai/report-snapshots/:id/narrative` | boss | 生成需财务复核的 grounded narrative |
| GET | `/api/ai/report-narratives/:id` | boss | 查看 Narrative、版本与 Claims |

老板报告页已增加：

- “生成审计快照”和“生成 AI 叙述”分离；
- Snapshot hash、source digest、来源数、数据政策、币种和 warning；
- Provider、Prompt 版本、`NEEDS_FINANCE_REVIEW`；
- 每条 Claim 的文字、确定性值和 `sourcePath`。

显式 Mock 模式使用独立内存仓库并标记 `provider=mock`，不请求后端，也不会冒充本地/外部模型。

## 5. 数据库迁移

本阶段追加 4 条迁移，未修改已发布 migration：

1. `20260720233000_report_snapshots_and_grounded_narratives`
   - 为业务记录增加规范三字母币种；
   - 新增 Snapshot、source、Narrative 和 `AiFinancialClaim` 表、约束、关系与不可变触发器。
2. `20260720234000_report_audit_maintenance_guard`
   - 普通更新/删除继续拒绝；只允许事务内显式维护删除，供受控测试清理和未来 H14 流程使用。
3. `20260720235000_remove_unused_currency_write_index`
   - 性能复核后移除未改善固定查询、反而增加大批写入成本的 currency-leading 索引。
4. `20260720235500_report_narrative_version_identity`
   - Narrative 唯一身份改为 Snapshot + 内容 hash + 完整版本向量，避免新模型/Prompt 的相同文字覆盖历史生成证据。

空库 41 条安装和 40→41 升级均通过；最终结构为 222 个索引、89 个外键。

## 6. 测试证据

| 门禁 | 结果 | 实际证据 |
| --- | --- | --- |
| 后端 Jest | `passed` | 47/47 suites，410/410 tests，21.160 s |
| 报告攻击定向 | `passed` | 2/2 suites，9/9 tests；值篡改、额外数字、虚构实体、中英文归因、比较绕过、warning 遗漏和 AI 写边界 |
| PostgreSQL 报告定向 | `passed` | 1/1；权限、confirmed actual、多币种、hash 复用、AI disabled、Mock grounding、重放、版本并存、DB 不可变和恶意模型输出 |
| PostgreSQL 全量 | `passed` | 10/10 suites，97/97 tests，289.209 s |
| Playwright | `passed` | 17/17，52.9 s；真实 API 创建 Snapshot/Narrative、展示 sourcePath 并完整清理 |
| Prisma/migration | `passed` | generate/validate；空库 41 条；40→41 升级；222 indexes、89 foreign keys |
| 前端运行时 | `passed` | 4/4；显式 API/Mock 与 URL 边界 |
| 前后端 build | `passed` | NestJS/Prisma/scripts；Vite 3,147 modules |
| 生产依赖审计 | `passed` | 根目录与后端均 0 vulnerabilities |
| Repository hygiene | `passed` | 用户资产、真实数据、模型、secret、构建产物和本机测试证据未进入提交范围 |

主要命令：

```text
cd backend && npm test -- --runInBand
cd backend && npm run test:integration
cd backend && npm run db:migration-paths
cd backend && npx prisma validate
npm run test:e2e
npm run test:runtime
npm run build
cd backend && npm run build
npm run check:hygiene
npm audit --omit=dev
cd backend && npm audit --omit=dev
```

## 7. 性能与已知风险

本次 PostgreSQL 全量容量采样：

| 行数 | 重新校验 | 确认 API | Worker 到终态 | RSS 增量 | 数据库连接峰值 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30,196 | 2.941 s | 26 ms | 25.161 s | 267.85 MiB | 11 |
| 49,999 | 5.880 s | 52 ms | 143.488 s | 120.21 MiB | 13 |

49,999 行同一代码在独立定向测试中曾约 45 秒，而全量两次约 143 秒；均未超过既有 180 秒断言，但抖动显著。移除新增 currency-leading 索引后没有观察到 Snapshot 对固定查询的必要收益。M7 必须继续定位数据库/Worker 抖动并建立更明确的 p95/资源预算，不能把单次较快结果写成稳定性能。

## 8. 未关闭门禁

- `H06 pending_human_decision`：需要明确真实对账周期、项目/日期/币种/方向范围、人工真值来源、逐分结果和财务签字。
- `H08 pending_human_decision`：需要正式收入/成本/利润/记录数定义、期间、老板问题集、标准答案、合理性规则和签字。
- `H12 pending_human_decision`：外部 Provider 白名单、字段、地域、用途和保留未批准；真实数据外发继续失败关闭。
- `H14 pending_human_decision`：Snapshot/Narrative/Claim 的正式保留与删除期限未批准；当前只提供不可变事实和显式维护边界。
- 真实模型准确率、真实业务报表、目标 Linux Staging、独立安全复核和生产上线均未由 M6 证明。

## 9. 下一步

进入 M7：补齐报告/导入攻击矩阵、kill switch 与 Provider 降级、权限撤销、混合币种、并发报告生成、大文件资源预算、日志泄露和现有 staging/CI 门禁联合回归；之后 M8 汇总迁移、运行手册、问题台账和 Draft PR 证据。

# FINANCE-AGENT B8 阻断问题矩阵

更新日期：2026-07-17

## 冻结基线

| 项目 | 结果 |
| --- | --- |
| B8 基线分支 | `agent/real-business-data-validation` |
| B8 基线提交 | `888a0b9638b61f0b63ed728ef4f1517b0eb788f4` |
| 执行分支 | `agent/b8-stable-hardening` |
| Draft PR #3 | 基线提交对应的 PostgreSQL/E2E、CodeQL 均通过；开放 CodeQL 告警为 0 |
| 工作树 | 基线无已跟踪修改；用户 IDE 配置、规划文档、模型下载脚本和 B8 需求文档保持未跟踪、未暂存 |
| 远端复核 | 创建分支前一次 `git fetch` 因 GitHub 连接超时失败；本地 HEAD 与此前已验证的远端缓存 SHA 一致，发布前必须重试 |
| 真实业务文件 | 本阶段未读取或修改原件；详细文件名、路径、业务值和完整哈希不进入本文件 |

## B8-00 基线证据

| 命令/门禁 | 结果 |
| --- | --- |
| 根目录 `npm ci` | 通过；146 packages；0 vulnerabilities |
| `backend/npm ci` | 通过；589 packages；0 vulnerabilities；仅有既有 deprecated/allow-scripts 提醒 |
| 前端 production build | 通过；3142 modules |
| 后端 production build | 通过 |
| 后端单元测试 | 17/17 suites，184/184 tests |
| PostgreSQL integration | 30/30 tests；18 migrations，无 pending migration |
| Playwright | 14/14 tests；teardown 后文件残留 0 |
| Repository hygiene | 通过；425 tracked/candidate files |
| 根目录/后端生产依赖审计 | 0 vulnerabilities / 0 vulnerabilities |
| 测试配置污染复现 | 调用者设置 `NODE_ENV=production` 后，`app.spec.ts` 在测试配置生效前加载 `AppModule`，16/16 用例失败 |

后端 build 与 unit 不得在 Windows 上同时执行，因为两者都会运行 `prisma generate` 并争用同一 Prisma DLL。B8 后续验收固定串行运行这两个命令；该编排约束不计为产品缺陷。

## B8-01 验证证据

| 门禁 | 结果 |
| --- | --- |
| 状态矩阵红灯 | 修复前 `parsing -> confirm` 返回 201；取消先取得任务锁后，后续确认仍返回 201 |
| 字段建议旁路红灯 | 修复前 cancelled 任务仍可通过字段建议 map/reject 写入映射并离开取消终态 |
| 定向 PostgreSQL 回归 | 2/2 tests；覆盖 `pending_confirm`、幂等 confirmed、六种非法状态、取消终态和两种确定锁顺序 |
| 后端构建 | 通过；Prisma generate、应用 TypeScript 和脚本 TypeScript 均通过 |
| 后端单元测试 | 17/17 suites，184/184 tests |
| PostgreSQL integration | 32/32 tests；18 migrations，无 pending migration |
| Playwright | 14/14 tests；teardown 后文件残留 0 |
| 数据库迁移 | 无 |
| 真实业务文件 | 未读取、未修改 |

## B8-02 验证证据

| 门禁 | 结果 |
| --- | --- |
| 金额可见性 | Playwright 断言确认页显示 `¥8,765.43` |
| 默认值与边界矩阵 | typed default 同时进入预览、RecordValue 和 confirmationSnapshot；零、负数、精度、日期、隐藏/停用/非模板字段在预览阻断 |
| 请求级幂等 | `idempotency_keys` 持久化操作者、稳定接口、请求哈希和原响应；相同、改体、并发请求均有 PostgreSQL 用例 |
| 资金入口覆盖 | 手工、Excel、OCR、老板终审及工单补生成均接入统一幂等服务 |
| 后端构建/单元 | build 通过；17/17 suites，184/184 tests |
| PostgreSQL integration | 40/40 tests；19 migrations，无 pending migration |
| Playwright | 14/14 tests；包含真实金额断言，teardown 后文件残留 0 |
| 真实业务文件 | 未读取、未修改；测试仅使用合成工作簿和 PDF |

## B8-03 验证证据

| 门禁 | 结果 |
| --- | --- |
| 后台确认状态机 | `pending_confirm -> confirming -> confirmed/confirmation_failed`；确认后明确拒绝取消 |
| 分批与幂等 | 500 行短事务；确定性记录 ID；`(import_task_id, source_id)` 唯一约束 |
| 恢复与接管 | 过期 lease、运行中接管、旧 Worker 失权、最后一批失败续跑和模拟数据库短断通过 |
| 原子发布 | 失败批次的 `pending_confirm` 记录不进入报表；最终事务统一发布 |
| 规模闭环 | 5,001/30,196/49,999 行的记录、字段值、金额、来源、audit、ledger 和日报一致 |
| 性能采样 | 最终全量运行中，30,196/49,999 行 API 24/37 ms，确认到终态 17.551/32.216 s，RSS 增量 200.63/327.44 MiB，连接峰值 11/10 |
| 完整回归 | 21 migrations；184/184 unit；48/48 PostgreSQL；14/14 Playwright；前后端 build 与 hygiene 通过 |
| 真实业务文件 | 未读取、未修改；仅使用合成 ImportRow |

## B8-04 验证证据

| 门禁 | 结果 |
| --- | --- |
| Decimal 契约 | Python `Decimal` 与后端字符串 Schema 覆盖 `.01/.09/.99`、2^53 附近、最大金额、负号和千分位；JSON number 被阻断 |
| 异步状态机 | run 快速排队；真实槽后 processing/lease；heartbeat、超时、retry、queued/processing 取消和重启恢复通过 |
| Provider 快照 | attempt 保存实际 provider/model/version/endpoint/config hash/input hash/secretRef；BusinessRecord 引用成功 attempt |
| Mock/真实 UI | 标准 Playwright 14/14；本地 Paddle 专用 Playwright 1/1；确认前数据库记录差值为 0 |
| 完整回归 | 22 migrations；186/186 unit；53/53 PostgreSQL；Python 5/5；前后端 build、Prisma、437-file hygiene 与依赖审计通过 |
| 真实业务文件 | 未读取、未修改；测试仅使用合成 PDF；真实标签与冻结标记保持在 Git 忽略目录 |

## B8-05 验证证据

| 门禁 | 结果 |
| --- | --- |
| 结构化 Claim | scope/period/metric/value/unit/sourceTool/sourcePath 严格 Schema 与完整元组校验；后端确定性渲染 |
| 错位攻击 | 收支、scope、月份、记录数/日期/工单号、最高/最低、项目/客户、注入和无数据攻击全部拒绝或 fallback |
| 工具正确性 | `get_finance_ranking` 强制显式 groupBy/direction；3 项目、2 客户、不同利润的 PostgreSQL 排序通过 |
| PostgreSQL 黄金账 | 正式 API 创建 6 条已确认记录；Reports 与 AI Claim 每个字段一致；失败只报匿名 caseId/path/category |
| 本地模型 | Qwen 72 条：原始 Claim 98.61%，有效 grounding/事实/无数据/注入/Schema 100%，1 fallback，0 Provider 错误 |
| 完整回归 | 22 migrations；199/199 unit；54/54 PostgreSQL；14/14 Playwright；前后端 build、Prisma、439-file hygiene 与依赖审计通过 |
| 真实业务数据 | 未读取、未修改；测试只使用合成黄金数据；本地明细报告位于 Git 忽略目录 |

## 问题矩阵

| 编号 | 严重性 | 阶段 | 文件/边界 | 失败复现 | 修复要求 | 验收测试 | 状态 | 人工决策 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B8-ENV-001 | P1 | B8-00 | `backend/test/app.spec.ts` | 调用者 `NODE_ENV=production` 时，静态 `AppModule` 导入先触发生产配置校验 | 测试环境在导入 `AppModule` 前设置，使用通过熵校验的测试密钥，关闭钩子容忍初始化失败并恢复调用者环境 | 污染环境 16/16、完整 unit 184/184 | verified | 无 |
| B8-EXCEL-001 | P0 | B8-01 | `ImportTasksService.confirm()` 与映射入口 | `cancelled/failed/parsing/mapping` 任务仍可越过状态门禁；字段建议可改写 cancelled 任务 | 首次确认只接受 `pending_confirm`；`confirmed` 仅幂等返回；所有映射入口锁内校验终态 | 真实 PostgreSQL 非法状态矩阵与字段建议旁路 | verified | 无 |
| B8-EXCEL-002 | P0 | B8-01 | `confirm()` / `cancel()` | 取消和确认缺少已证明的同锁终态测试 | 共用任务事务锁，终态互斥，audit/ledger/记录一致 | 真实 PostgreSQL 两种锁顺序与并发请求 | verified | 无 |
| B8-EXCEL-003 | P1 | B8-02 | Excel preview/confirm | 金额显示、默认值、边界值和统一幂等尚未按 B8 门禁证明 | canonical values 与统一幂等策略 | E2E、PostgreSQL 边界矩阵 | verified | H-02 保留为冲销业务政策输入；当前正数规则已一致实现 |
| B8-EXCEL-004 | P0 | B8-03 | 大批量确认 | 30,196 行只证明解析，未证明最终入账 | 短事务确认 Worker、lease、恢复和原子发布 | 5,001/30,196/49,999 完整闭环 | verified | H-03 仍作为跨来源业务去重政策输入，不阻断本阶段工程门禁 |
| B8-OCR-001 | P0 | B8-04 | OCR 金额与执行任务 | Provider 精度和长同步 HTTP 尚未满足 B8 要求 | Decimal 字符串、异步队列、续租、恢复和 attempt 快照 | Mock/真实 Provider 并发与恢复 | verified | 无 |
| B8-OCR-002 | P0 | B8-04/08 | 真实 OCR 准确率 | 17 份字段真值及盲测冻结需要独立人工复核 | 完成签名标签并冻结盲测后计算真实指标 | 金额/日期关键错误、高置信错误率和未确认入账差值 | blocked_external | H-04/H-05 |
| B8-AI-001 | P0 | B8-05 | 老板 AI grounding | 仅验证数字出现，未绑定 scope/period/metric/sourcePath | 结构化 Claim、确定性 renderer、PostgreSQL 黄金数据 | 错位数字攻击与黄金测试 | verified | 无 |
| B8-AI-002 | P1 | B8-05/08/09 | 老板问题口径与外部 Provider | 标准答案和真实数据外发政策需要授权人决定 | 审核标准问题；决定脱敏、地域、保留和外发边界 | 人工标准答案与外部数据政策签字 | blocked_external | H-08/H-12 |
| B8-SEC-001 | P0 | B8-06 | AI 日志/Cookie/文件/DLP | 多项生产隔离与资源边界未按 B8 门禁证明 | 权限隔离、生产 Cookie、主动内容、资源上限和 CI DLP | 权限与攻击测试 | verified | H-10/H-11 仍为生产政策签字，不阻断工程门禁 |
| B8-MODEL-001 | P1 | B8-07 | 模型控制面/GPU/代理 | 路由配置快照、鉴权 ready、跨进程 GPU 锁和代理边界待收口 | 同一 resolved deployment、互斥锁、固定容器和代理错误契约 | 路由/GPU/代理测试 | verified | H-13 属于 B8-09 目标部署选择，不阻断本地工程门禁 |
| B8-UAT-001 | P0 | B8-08/09 | 财务 UAT 与 Staging | 匿名 UAT 工具和自动对账已完成；财务/OCR/重复/冲销、部署和恢复仍无人工签字 | 授权人员完成八场景结论，目标环境完成恢复/回退演练 | UAT 签字、RPO/RTO、回退记录 | blocked_external | H-01 至 H-16 |

## 状态规则

- `open`：已复现且尚未修复。
- `in_progress`：当前唯一正在处理的问题。
- `queued`：必须等待前序阶段门禁。
- `blocked_external`：需要文档列明的人工输入、签字或基础设施。
- `fixed`：实现完成但尚未跑完本阶段门禁。
- `verified`：失败测试、实现和本阶段完整回归均通过。

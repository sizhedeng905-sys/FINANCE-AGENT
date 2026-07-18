# FINANCE-AGENT B8 阻断问题矩阵

更新日期：2026-07-18

## 冻结基线

| 项目 | 结果 |
| --- | --- |
| B8 基线分支 | `agent/real-business-data-validation` |
| B8 基线提交 | `888a0b9` |
| 执行分支 | `agent/b8-stable-hardening` |
| Draft PR #3 | 基线提交对应的 PostgreSQL/E2E、CodeQL 均通过；开放 CodeQL 告警为 0 |
| 工作树 | 基线无已跟踪修改；用户 IDE 配置、规划文档、模型下载脚本和 B8 需求文档保持未跟踪、未暂存 |
| 远端复核 | 分支已推送且与上游零分叉；PR #4 的 Build and acceptance 与 CodeQL 在审计代码 HEAD 均通过 |
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

## B8-09 验证证据

| 门禁 | 结果 |
| --- | --- |
| API/Worker | 生产角色拆分；PostgreSQL durable queue；Redis 共享限流和 heartbeat；无 Worker 时 readiness 失败 |
| 数据与文件 | PostgreSQL TLS、migrator/runtime/backup 分离；S3 private bucket/短签名 URL；ClamAV fail-closed |
| 不可变日志 | runtime 对 `audit_logs/ledger_events` 只有 INSERT/SELECT，UPDATE/DELETE/TRUNCATE 被 revoke |
| 观测 | Prometheus、Alertmanager、Loki、Alloy、Tempo、Grafana；W3C trace 与 OTLP bounded exporter；错误/容量/备份告警；不挂载 Docker socket |
| 备份/回退 | logical/base/WAL、对象快照、SHA-256 manifest、临时 restore drill、应用/数据/模型回退脚本完成 |
| 配置门禁 | 18 services；证书链、固定版本 tag、仅 TLS gateway 发布端口、只读应用容器、secret 未跟踪断言通过 |
| 完整回归 | backend build；264/264 unit；60/60 PostgreSQL；16/16 Playwright；frontend build；runtime 4/4 |
| 容器/恢复 | 本机隔离 18 服务 `up`、Node/browser smoke 及清理通过；目标 Linux Staging、restore、rollback 和实测 RPO/RTO 为 `blocked_external` |
| 真实业务数据 | 未读取、未修改；Staging seed 仅使用随机密码合成账号 |

## 问题矩阵

### 2026-07-18 R0 重新审计基线

| 核验项 | 实际结果 |
| --- | --- |
| 仓库/分支 | `C:\Users\ASUS\Desktop\Financial agent` / `agent/b8-stable-hardening` |
| R0 开始时 HEAD | `fb557f1a678cd2b931ae7a4407eec6867c9380e4`，与 `origin/agent/b8-stable-hardening` 一致 |
| 已跟踪工作树 | `git diff --stat` 与 `git diff --cached --stat` 均为空 |
| 受保护本地资产 | 11 个未跟踪文件，包含 IDE 配置、用户规划/需求文档、模型下载脚本和空白人工复核文件；全部未暂存、未修改 |
| Git 忽略边界 | `backend/.env`、`model/`、`.realdata-test/`、`数据文件/`、`backend/uploads/` 均由实际 `git check-ignore -v` 证明被忽略 |
| Draft PR #4 | `main <- agent/b8-stable-hardening`；69 commits；open、Draft、mergeable；3/3 review threads resolved 且 outdated |
| GitHub checks | HEAD 的 Build and acceptance `29634353327` 与 CodeQL `29634353299` 均为 `success` |
| 人工决策 | 指定文件 `FINANCE_AGENT_HUMAN_DECISIONS_UAT_SIGNOFF_2026-07-18.md` 不存在；空白 `人工复核.md` 不构成批准，H01-H16 全部保持未决 |
| 本机资源快照 | C 盘可用 798.6 GiB；空闲内存 65.4 GiB；RTX 5090 空闲显存约 7.4 GiB，真实模型任务前必须重新检查 |

此前“锁定单 API/单 Worker 拓扑内没有开放代码 P0/P1”的结论已被本轮审计取代。下列条目在完成先失败复现、最小修复和对应回归前一律保持开放；仅凭静态阅读不得关闭。

### R 系列开放问题

| 编号 | 严重性 | 边界 | 负责人 | R0 复现/风险证据 | 修复提交 | 验收证据 | 状态 | 人工门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1-FRONTEND-001 | P0 | Staging frontend runtime/build/CSP | 工程执行者 | 红灯：相对 `/api` 抛出 URL 异常；缺失模式回退 Mock；镜像没有模式证明；仅 HTTP smoke | 本提交（R1） | runtime 4/4；静态部署 8/8；显式 API build；本机 18 服务 Node/browser smoke；Playwright 16/16 | verified | 无 |
| R2-LOG-001 | P1 | Gateway/application access log | 工程执行者 | 红灯证明 `$request` 会记录完整 request line/query，且缺少安全 method/path/upstream 字段 | 本提交（R2） | 静态/应用日志 16/16；全量 unit 267/267；实际 29 条网关 JSON、15 个伪敏感标记泄露 0、200/400/503 与注入探针通过 | verified | H09/H14 仍约束 IP 保留 |
| R3-STORAGE-001 | P1 | S3 capacity/readiness | 工程执行者 | 红灯证明 `HeadBucket` 后固定返回 1 TiB，无法区分物理容量未知 | 本提交（R3） | 结构化来源/新鲜度；79/79 定向；跨账号/项目 PostgreSQL 并发单赢家；写满零 DB 写入；MinIO v3/Prometheus/Nginx 实测 | verified | H13/H14 约束正式逻辑配额、保留水位、告警阈值/接收人；当前 `pending_human_decision` |
| R4-RECOVERY-001 | P1 | Database/object backup restore | 工程执行者 | 红灯：同数量错 key/内容可通过；恢复先覆盖 live DB；migrator 无 CREATEDB 导致旧 drill 实际不可运行 | 本提交（R4） | `backup-manifest/1.0`；自测 9/9；有对象/空对象隔离恢复；5 类对象故障、migration/DB 引用篡改均拒绝 | verified | H13/H14 仍决定目标环境、正式 RPO/RTO、加密/异地/保留并授权每次 live restore |
| R5-IMAGE-001 | P1 | Release/rollback image identity | 工程执行者 | 红灯证明发布前无完整锁，rollback 可接受漂移 tag，配置/扫描/migration 未与 manifest 形成自校验证据链 | 本提交（R5） | 17/17 攻击测试；22 镜像/66 证据完整扫描；部署前锁与计划、运行 image ID、全 migration ledger、配置证据和回退篡改拒绝；见 `R5_IMMUTABLE_IMAGE_ROLLBACK_REPORT_2026-07-18.md` | verified | H13 决定目标 registry、签名身份和风险接受；目标回退仍 `blocked_external` |
| R6-PREVIEW-001 | P1 | Excel preview API/browser | 工程执行者 | 红灯：`previewInclude.rows` 一次读取并返回全部行；`page=1&pageSize=2` 仍返回 5 行 | 本提交（R6.1） | 当前页查询、500 行摘要批次和版本缓存；1 MiB/pageSize 100 上限；5,001/50,000/50,001 边界；PostgreSQL 62/62、Playwright 17/17；见 `R6_1_EXCEL_PREVIEW_PAGINATION_REPORT_2026-07-18.md` | verified | 无 |
| R6-TEMPLATE-LOCK-001 | P1 | Project template vs record/import/OCR/work order | 工程执行者 | 红灯：持有项目 key 22 时模板停用仍提前完成；Excel Worker 实际写记录时未重新锁定/校验模板 | 本提交（R6.2） | 公共事务锁与稳定可重试 409；启用/停用对手工记录、Excel Worker、OCR、工单终审的真实 PostgreSQL 顺序矩阵 4/4；全量集成 68/68；见 `R6_2_PROJECT_TEMPLATE_CONCURRENCY_REPORT_2026-07-18.md` | verified | H01/H07 只约束业务口径 |
| R6-DUPLICATE-WINDOW-001 | P1 | Duplicate candidate calculation | 工程执行者 | 红灯：`windowDays=2` 仍只查询同一 UTC 日，配置未进入全局候选范围 | 本提交（R6.3） | 0/365 天、UTC、前后边界、跨月/年；结果/异常/audit/ledger 一致；4/4 PostgreSQL suites、71/71 tests；见 `R6_3_DUPLICATE_CANDIDATE_WINDOW_REPORT_2026-07-18.md` | verified | H03 仍决定正式指纹、容差、跨来源归一化和处置；自动动作固定为 none |
| R6-DECIMAL-001 | P1 | Rule threshold precision | 工程执行者 | 红灯：JSON numeric `99999999999999.99` 在构造 Decimal 前已变为 `99999999999999.98`，旧服务仍接受 | 本提交（R6.4） | `financial-threshold/1.0` 规范字符串；旧安全整数弃用告警；unsafe numeric/科学计数法字符串/超精度/越界拒绝；5/5 PostgreSQL suites、73/73 tests；见 `R6_4_FINANCIAL_THRESHOLD_DECIMAL_REPORT_2026-07-18.md` | verified | H01/H02/H06 仍决定正式币种、冲销和舍入政策 |
| R9-SCALE-001 | P1 条件风险 | Multi-instance login/upload/model gates | 工程执行者 | 登录、上传准入或模型并发仍可能依赖进程内状态；当前只能维持单 API/单 Worker | - | 待共享原子控制与多实例故障测试 | open | H13；未批准扩容前不得横向扩容 |
| R6-IDEMPOTENCY-001 | P1 | Finance write endpoint inventory | 工程执行者/财务负责人 | 红灯：公共表虽按 actor 隔离，但工单/Import/OCR 全局唯一业务列保存原始 key，两个操作者使用同 key 会错误冲突；编辑与文件上传缺少响应重放 | 本提交（R6.5） | 端点矩阵、`idem-v1` 作用域指纹、请求哈希/响应重放/改体 409/并发单事实/回滚重试；35/35 unit、75/75 PostgreSQL；见 `R6_5_FINANCIAL_WRITE_IDEMPOTENCY_AUDIT_2026-07-18.md` | verified | H01/H02/H03/H07/H14 决定强制范围、跨来源重复和保留；当前 `pending_human_decision` |
| R6-H-POLICY-001 | P1 | H01/H02/H07 current behavior and decision boundary | 工程执行者/财务/业务 | 红灯：指定决策文件不存在；代码文案把软作废称为冲销，且 pending 决策未进入快照 | 本提交（R6.6） | `financial-policy-baseline/1.0`、唯一 Pending 签字模板、行为/迁移草案矩阵；36/36 unit、75/75 PostgreSQL、17/17 Playwright；见 `R6_6_H01_H02_H07_BEHAVIOR_MATRIX_2026-07-18.md` | verified | H01/H02/H07 仍为 `pending_human_decision`；没有固化正式粒度、冲销、关账或附件主从 |
| R7-RETENTION-001 | P1 | AI/audit/data retention and deletion | 工程执行者/安全/合规负责人 | 红灯：新增 `AiCallLog` 在读取时脱敏但数据库仍保存完整问题、工具上下文和 Provider 原始响应；真实保留、删除、hold 和备份传播未批准 | 本提交（R7.1） | `ai-call-audit/1.0` 元数据分离；9 类 dry-run、DB 强制零删除、legal hold、双实例 lease/恢复、匿名计数；37/37 unit、78/78 PostgreSQL；见 `R7_1_DATA_RETENTION_DRY_RUN_REPORT_2026-07-18.md` | engineering_verified | H09/H12/H14 仍决定实际天数、删除/hold 释放、备份与 Provider 传播；真实删除保持关闭 |
| R7-STEPUP-001 | P1 | Step-up/MFA/SoD | 工程执行者/安全/业务负责人 | 红灯：旧令牌只有 `sub/ver/typ`，未绑定 session/action/resource，无接口消费、单次使用或并发防重放 | 本提交（R7.2） | PostgreSQL 单次消费/并发单赢家、错误绑定/过期/伪造用户拒绝、角色/密码/停用/登出撤销；37/37 unit、84/84 PostgreSQL；见 `R7_2_STEP_UP_AND_SOD_FRAMEWORK_REPORT_2026-07-18.md` | engineering_verified | H10 仍决定 MFA、正式动作/TTL、自审批、跨账号同人、双人复核和 break-glass；默认关闭 |
| R10-ACCURACY-001 | 发布门禁 | Real models and real business truth | 授权标注/财务/老板 | 合成 L0 证据不能替代 OCR 标签、L3 分币对账或老板标准答案 | - | 待冻结 L1 数据集和人工签字 | awaiting_human_signoff | H04-H09/H12/H16 |

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
| B8-STAGING-001 | P1 | B8-09 | API/Worker、Redis、S3、TLS、观测 | 单进程、本地磁盘、内存限流和缺少集中观测不满足 Staging | 拆分运行角色，私有依赖、TLS、指标/日志/trace、不可变权限和回退脚本 | 单测、Compose JSON、安全配置、shell syntax、全量回归 | verified | 无 |
| B8-STAGING-002 | P0 发布门禁 | B8-09 | 目标镜像、真实备份恢复与回退 | 本机固定镜像、18 服务启动和 smoke 已通过；尚无 H-13 指定服务器/registry，未执行目标 restore/RPO/RTO/rollback | 在 H-13 指定服务器/registry 锁定 digest，运行 release、smoke、backup/restore 和 rollback | 目标镜像 lock、TLS smoke、RPO/RTO、对象/DB 恢复和回退证据 | blocked_external | H-13/H-14 |
| B8-PILOT-001 | P0 | B8-09 | 小范围试运行与最终批准 | 尚无目标用户/项目清单、外部 AI 政策、独立 Review 和最终 UAT 签字 | 使用日检表和正式 Issue 完成受控试运行，关闭 P0/P1 后签字 | H-12 至 H-16 文档、每日证据、Issue 关闭记录 | blocked_external | H-12/H-13/H-14/H-15/H-16 |
| B8-STAGING-003 | P1 | B8-09/RC | 多实例登录、上传与模型闸门 | 全局请求限流已共享，但登录、上传准入和模型并发仍为进程内状态 | Staging 保持单 API/单 Worker；横向扩容前迁移到共享原子控制并验证故障恢复 | 拓扑断言、多实例并发和 Redis 故障测试 | open | H-13 若要求横向扩容则阻断 |
| RC-MIGRATION-001 | P1 | RC-03 | 空库与升级 migration | 原门禁只验证已有测试库，无法单独证明空库和上一版本升级 | 创建随机 `_test` 临时库并分别验证 24 条空库和 23→24 升级，最后强制清理 | `npm run db:migration-paths --prefix backend` | verified | 无 |
| RC-MODEL-001 | P2 | RC-03 | 模型韧性/soak 探针 | 脚本仍访问废弃的匿名 OCR `/health` | 使用 Bearer 认证 `/ready`；真实文本重启、VL 切换、文本恢复和并发推理 | 432 次 OCR readiness 0 失败；最终常驻状态正确 | verified | 无 |
| RC-DASHBOARD-001 | P1 | RC-02 | 角色首页统计 | 首页只根据客户端前 100 条工单估算 | 后端按 token 角色范围 groupBy，全状态/风险补零；前端只消费服务端 summary | 125 条聚合单测、四角色 Playwright | verified | 无 |

## 状态规则

- `open`：已复现且尚未修复。
- `in_progress`：当前唯一正在处理的问题。
- `queued`：必须等待前序阶段门禁。
- `blocked_external`：需要文档列明的人工输入、签字或基础设施。
- `fixed`：实现完成但尚未跑完本阶段门禁。
- `verified`：失败测试、实现和本阶段完整回归均通过。

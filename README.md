# FINANCE-AGENT

面向物流企业的 AI 财务运营系统。项目把员工工单、财务审核、复核、规则与 AI 辅助检查、老板审批、经营数据、通知、日报和老板 AI 助手连接为一个可审计的业务闭环。

当前仓库已经从前端原型推进到 React 前端、NestJS 后端、PostgreSQL 数据库、异步 Excel/OCR、结构化 AI Claim、本地模型控制面和 Staging 工程。R1-R8.9 已完成前端真实性、日志、容量、恢复、镜像身份、财务并发/精度/幂等、数据生命周期、step-up 和分层 CI 的工程修复；R9.1-R9.3B 又把登录、上传和模型执行控制迁到 Redis 共享原子边界，并缩短大批量确认的最终发布事务。重新审计随后发现 Excel 暂存记录可被通用 API 提前读取/修改，以及最终发布缺少逐记录内容和实际更新行数围栏；CR-002 至 CR-005 已用先失败攻击测试、数据库约束/触发器、内容寻址和完整回归关闭这组本地工程 P0。CR-006 进一步让版本化 `userPromptTemplate` 经白名单变量和 canonical JSON 真正进入 Provider 请求，并把 system/template/schema/输入/Provider/模型/输出之间的哈希证据写入现有 AI 审计链。CR-007 将项目治理统一为一名项目负责人：已确认决定和最多十个开放问题分别集中到 `docs/owner-input/`，不再等待多角色姓名、日期或签字，但产品四角色、第二财务审批和真实证据门禁不变。CR-008 将结果材料和计划材料分别归档到 `docs/汇报/` 与 `docs/计划/`，并增加可重复的 Markdown 本地链接门禁。M0-M8 的其余非生产工程与合成验收保持有效：AI 只生成受控建议，财务批准前没有正式可见记录，报告数字只来自 canonical ReportSnapshot、Decimal 和固定查询。当前本地候选通过 435 个后端单测；P0 基线仍为 119 个强制 Redis 的 PostgreSQL 集成测试和 17 个 Playwright，本次 Prompt 专项另通过 7 个 PostgreSQL/Redis 用例。R10 L0 的常驻 Qwen/Paddle 合成推理与鉴权也已验证。受保护的空白 Prompt Catalog 不由 Codex 伪造，运行时继续使用已审计 registry；production-safe 空库 bootstrap 尚未完成。目标 Linux Staging 为 `EXTERNAL_RESOURCE_NEEDED`，财务/OCR/AI 真值为 `REAL_SAMPLE_NEEDED`，项目负责人 UAT 尚未达到 `OWNER_UAT_VERIFIED`，因此本项目**不是 production-ready**。

## 项目状态

状态快照：2026-07-21

| 项目 | 当前状态 | 人工判断依据 |
| --- | --- | --- |
| 第一版业务闭环 | `engineering_complete` | 登录、工单、附件、四级审核、经营记录、通知、日报和 AI 助手均已接真实 API |
| 后端阶段 0-10 | `engineering_complete` | NestJS/PostgreSQL/Prisma、业务模块、Excel 和 OCR 均已实现 |
| B0-B7 真实数据工程 | `engineering_complete` | 大文件、四来源记录、模型、并发与故障恢复已有自动化证据 |
| B8-01 至 B8-07 | `historically_verified / reopened` | 历史门禁通过；R 系列又发现前端真实性、日志、容量、恢复、并发和精度边界 |
| B8-08 财务 UAT | `REAL_SAMPLE_NEEDED / OWNER_UAT_VERIFIED pending` | 匿名工具和逐分对账脚本已交付；仍需真实真值和项目负责人亲自 UAT，不需要多角色签字 |
| B8-09 Staging | `ENGINEERING_VERIFIED / EXTERNAL_RESOURCE_NEEDED` | 本机隔离 18 服务已真实 `up` 并完成 TLS/API/浏览器 smoke；目标 Linux Staging、restore、RPO/RTO 和 rollback 未验收 |
| RC-00 至 RC-04 | `historical_baseline_passed / reopened` | 原门禁通过，但“无开放 P0/P1”结论已由 R0 撤回 |
| R0-R10 修复与再验收 | `ENGINEERING_VERIFIED / EXTERNAL_RESOURCE_NEEDED` | R8.9 分层 CI、M8.1 Nginx Critical、R9 共享控制、Excel 暂存完整性重审和 R10 本地模型 L0 均有工程证据；L1 真值与目标 release 仍开放 |
| R11 最终交接 | `in_progress` | Excel P0、P1-1 Prompt 真执行/provenance、单一负责人治理和文档目录已收口；production-safe bootstrap 仍在推进；不 merge、不转 Ready |
| AI 映射补充 M0-M8 | `ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED` | OCR/Excel 审核入账、canonical ReportSnapshot、严格 Claim grounding、攻击/资源/降级和最终证据已通过；真实口径/准确率和目标 Staging 尚未关闭 |
| 发布结论 | `SAFE_DEFAULT_ACTIVE` | 目标环境、真实 Staging、恢复演练、独立安全复核、财务/OCR/AI 真值和 owner UAT 均未完成，发布失败关闭 |

R0 开始时实际核验的 HEAD：`fb557f1a678cd2b931ae7a4407eec6867c9380e4`

- 工作分支：`agent/b8-stable-hardening`
- Draft PR：[PR #4: B8 stable hardening through model control plane](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 当前 Build and acceptance：[run 29755386892](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29755386892)，成功
- 当前 CodeQL：[run 29755387035](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29755387035)，成功
- PR 安全 review thread：3/3 已解决且已过期，未解决数量为 0

上述绿色检查是重新审计前的历史工程基线，不能覆盖新登记问题，也不能替代真实环境、真实样本、独立复核和 owner UAT。

### R0-R8.9 重新审计进展

- 已实查分支、HEAD、最近提交、已暂存/未暂存差异、未跟踪资产、Git 忽略边界和 PR #4 状态。
- 用户未跟踪资产继续保持未暂存、未修改；`.env`、模型、真实数据、上传目录和本地测试输出均被 Git 忽略。
- PR #4 仍为 open Draft，`main <- agent/b8-stable-hardening`，69 commits，mergeable；未执行 merge、Ready、rebase、force push 或关闭旧 PR。
- 项目负责人已填写 [`docs/FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md`](docs/FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md)。当前已确认决定集中到 [`docs/owner-input/OWNER_DECISIONS.md`](docs/owner-input/OWNER_DECISIONS.md)，开放口径集中到 [`docs/owner-input/OPEN_QUESTIONS.md`](docs/owner-input/OPEN_QUESTIONS.md)，旧 H01-H16 文档只保留为历史索引。
- H01 已明确为“每个有效明细行一条记录，汇总由程序计算”；重复仅提示、逐分分币对账、费用明细为主记录、保守老板回答、四角色边界、本地失败转人工、legal hold 和全门禁后试用也已记录为 `OWNER_CONFIRMED`。汇总行真值、OCR/财务样本为 `REAL_SAMPLE_NEEDED`；负数白名单、必填附件模板、对账周期、外部 Provider 清单、RPO/RTO 和保留期限采用 `SAFE_DEFAULT_ACTIVE` 并等待负责人选择；目标云资源为 `EXTERNAL_RESOURCE_NEEDED`。
- R1 红灯证明了相对 `/api` 解析、隐式 Mock、镜像模式和浏览器 smoke 缺口；现已强制显式 `api` 构建、产物清单核验、同源 URL 约束、CSP 和真实浏览器写读清理。
- 本机隔离的 18 服务栈已真实启动并通过 TLS、readiness、四角色登录、错误登录、Metrics 和浏览器 CSP/API smoke；合成项目经 API 软归档，测试容器和卷已删除。该证据不替代 H13/H14 指定的目标环境与恢复演练。
- R2 已将网关日志从完整 `$request` 改为 `$request_method + $uri`，保留状态/上游状态/耗时/requestId/traceId；应用日志与 trace 的伪签名、Token、Cookie 和换行注入回归通过。
- R3 已删除“`HeadBucket` 成功等于固定 1 TiB 可用”的错误语义；S3 物理容量明确为未知，上传使用 PostgreSQL 可信用量、显式逻辑配额、保留水位和事务级全局锁，MinIO 物理容量由私网 Prometheus 独立采集。
- R3 的跨账号/跨项目 PostgreSQL 并发测试证明配额只允许一个赢家，失败对象被清理；Provider、陈旧/未知/估算/矛盾容量和写满故障均失败关闭。H13/H14 仍决定正式配额、阈值、接收人和保留政策。
- R4 将备份清单升级为 `backup-manifest/1.0`：数据库 dump/schema/migration、`raw_files` 引用、对象 key/size/version/metadata 与逐对象流式 SHA-256 均进入自校验清单；ETag 明确不作为强哈希，旧数量清单按未验证对象数拒绝恢复。
- R4 的恢复演练先恢复到唯一临时数据库和临时桶，再核对 schema、migration、对象强哈希与数据库引用；有对象和空对象两条本机隔离路径均通过。5 类对象篡改、migration 篡改、悬空引用和清单篡改均有自动拒绝断言。
- 正式数据恢复仍需 H13/H14 目标绑定的一次性授权、应用停写和补偿快照。PostgreSQL 与 S3 不存在跨系统原子事务，当前只声明“应用级分阶段切换并补偿”，没有执行或宣称生产恢复通过。
- R5 将 release/rollback 升级为自校验的镜像锁、发布计划、供应链索引和最终 manifest；部署前冻结全部服务身份、配置与 migration ledger，部署/回退后复核运行容器 image ID，tag 漂移、证据篡改和 migration 不一致均失败关闭。
- R5 固定第三方构建输入 digest，并以固定源码/包版本构建 PostgreSQL、MinIO、Prometheus、Alertmanager、node-exporter、Alloy 和 Tempo；Promtail 已迁移到不挂载 Docker socket 的 Alloy。22 镜像完整扫描通过“无可修复 Critical”门禁，但仍有 53 High、88 Medium、38 Low，目标 registry/签名仍受 H13 阻断。
- R6.1 删除 `previewInclude.rows` 全量读取；预览只查询当前页，首次精确统计按 500 行批次扫描并绑定任务版本缓存，映射变化自动失效。JSON 响应硬上限 1 MiB，页面最多 100 行且前端不缓存全表。
- R6.1 已验证默认/最小/最大/超限/深页/无权限、5,001 与 50,000 行预览、50,001 行拒绝和真实浏览器 20→5 行翻页；25 条 migration 空库及 24→25 升级通过。
- R6.2 将项目、模板、手工记录、Excel、OCR、工单和项目文件写入统一到 PostgreSQL 事务级项目锁；2 秒锁超时返回稳定可重试 409，成功后恢复原 `lock_timeout`。
- R6.2 的真实竞争矩阵证明启用后记录可写、停用后 OCR 不入账、终审先完成则历史记录保留；Excel 确认调度后若模板停用，后台批次会失败关闭且正式记录为 0。
- R6.3 将 `duplicate_submission.windowDays` 定义为 UTC date-only 的对称闭区间半径，支持 0-365 天；默认 0 天只查当天，候选查询、规则结果、异常、audit 和 ledger 使用同一窗口证据。
- R6.3 只生成重复候选，自动动作固定为 `none`。负责人已确认 A-E 信号、前后 3 天、金额逐分一致且只提示；当前实现仍只使用同项目工单的精确金额、附件 SHA-256 或业务引用信号，跨来源真实校准为 `REAL_SAMPLE_NEEDED`。
- R6.4 将金额类风险阈值固定为 `financial-threshold/1.0` 规范十进制字符串，最大值与现有 `Decimal(14,2)` 对齐为 `999999999999.99`；验证、持久化、比较、结果和审计均不再经过 JavaScript 浮点数。
- R6.4 仅兼容非负安全整数旧 numeric 输入，规范化后写弃用警告；小数 numeric、科学计数法字符串、多余小数位、前导零、负数、空值和越界值稳定 400，禁止静默舍入。H01/H02/H06 的币种、冲销和舍入政策仍未由工程代码代决。
- R6.5 完成文件、工单审批、手工记录、Excel、OCR、通知与报告写边界盘点；公共契约按 JWT 用户、method、稳定 route 和 key 隔离，持久化请求哈希与首次响应，并用 PostgreSQL 事务锁和唯一约束处理并发、回滚、重启和多实例重放。
- R6.5 修复工单/ImportTask/OcrTask 全局唯一列保存原始 key 导致的跨操作者冲突；业务列现保存 `idem-v1` 作用域指纹。记录/工单编辑和文件上传新增可选精确响应重放，并发文件上传只保留一份文件事实、绑定、audit 和 ledger。
- 正式强制 key 范围、跨来源重复和幂等记录保留仍分别受 H01/H02/H03/H07/H14 约束；工程代码不会把相似业务自动合并或删除。详细矩阵见 [`docs/汇报/R6_5_FINANCIAL_WRITE_IDEMPOTENCY_AUDIT_2026-07-18.md`](docs/汇报/R6_5_FINANCIAL_WRITE_IDEMPOTENCY_AUDIT_2026-07-18.md)。
- R6.6 建立 `financial-policy-baseline/1.0`：自动粒度选择、自动冲销/更正、附件主数据和 OCR 自动提交均关闭；新模板/确认快照保存 H01/H02/H07 决策状态，旧记录不回填。H01 已 `OWNER_CONFIRMED`；H02/H07 未确认执行清单前继续 `SAFE_DEFAULT_ACTIVE`。
- R6.6 保持正式金额只接受正数，但错误明确引用 H02；软作废只改变状态并保留金额、动态值、来源、模板快照和附件，不再把它描述为会计冲销。当前没有更正链、反向分录、关账期或不可变历史 ReportSnapshot。
- H01 已决定每个有效明细行一条记录、汇总由程序计算且汇总/明细不得双计；M5.2 已实现普通错误明细不可排除、疑似汇总行必须财务处置、重新校验和整批原子发布，真实汇总行样例仍为 `REAL_SAMPLE_NEEDED`。H02 决定白名单负数、保留历史的财务更正和第一版不关账，但白名单与报表重述仍为 `OWNER_CONFIRMATION_NEEDED`；H07 决定每个费用明细为主记录、多附件、缺必填附件阻断和人工覆盖留痕，但必填模板清单仍开放。详见 [`docs/汇报/R6_6_H01_H02_H07_BEHAVIOR_MATRIX_2026-07-18.md`](docs/汇报/R6_6_H01_H02_H07_BEHAVIOR_MATRIX_2026-07-18.md) 和 [`docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md`](docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md)。
- R7.1 修复了新增 `AiCallLog` 在数据库中保存完整问题、工具上下文和原始 Provider 响应的风险；现只保存 `ai-call-audit/1.0` 哈希、大小、工具/字段名、版本和 grounding 计数，完整对话仍留在独立内容区。
- 新增按 9 类数据盘点的 retention dry-run、PostgreSQL lease/重试/耗尽恢复、active legal hold、匿名证据和 Prometheus queue depth。配置只接受 `disabled|dry-run`，数据库约束强制 `dry_run=true`、`deleted_count=0`；实际天数、删除、hold 释放和备份/Provider 传播继续由 H12/H14 阻断。
- R7.1 全量门禁为后端 37/37 suites、335/335 tests，PostgreSQL 6/6 suites、78/78 tests，Playwright 17/17，Prisma 空库 26 条和 25→26 升级、前后端 build、615 文件卫生及两套 0 vulnerability 审计。详细证据见 [`docs/汇报/R7_1_DATA_RETENTION_DRY_RUN_REPORT_2026-07-18.md`](docs/汇报/R7_1_DATA_RETENTION_DRY_RUN_REPORT_2026-07-18.md)。
- R7.2 将 step-up 绑定用户、登录会话、角色/Token 版本、动作和资源，并以 PostgreSQL grant 实现单次消费、并发防重放和角色/密码/停用/登出撤销；高风险接口统一接入守卫，但全局默认关闭。
- R7.2 全量门禁为后端 37/37 suites、342/342 tests，PostgreSQL 7/7 suites、84/84 tests，Playwright 17/17，Prisma 空库 28 条并分别验证 26→27、27→28 升级、624 文件卫生及两套 0 vulnerability 审计。详细证据见 [`docs/汇报/R7_2_STEP_UP_AND_SOD_FRAMEWORK_REPORT_2026-07-18.md`](docs/汇报/R7_2_STEP_UP_AND_SOD_FRAMEWORK_REPORT_2026-07-18.md)。
- R8.1 将 CI 与部署镜像统一到 Node 24.18.0；每次 PR/push 会真实构建后端和显式 API 前端镜像，核对非 root 用户与 Git revision，并生成两份 SBOM、执行固定 Grype 数据库的可修复 Critical 门禁。本机实际构建同时发现并修复了 10.23GB 前端上下文泄漏，收紧后仅 24.09KB。
- R8.1 应用镜像 workflow 已在 GitHub run `29752263099` 真正执行；前后端镜像构建、非 root/revision、SBOM 生成和全部业务测试通过，随后由可修复 Critical 门禁阻止旧 Nginx 进入候选。详细证据见 [`docs/汇报/R8_1_APPLICATION_CONTAINER_CI_REPORT_2026-07-18.md`](docs/汇报/R8_1_APPLICATION_CONTAINER_CI_REPORT_2026-07-18.md)。
- R8.2 新增 scheduled/manual Staging release workflow，串联资源预检、完整 release、运行日志泄露检查、同 manifest rollback、API/浏览器 smoke、资源清理和受限证据上传；真实模型另设仅手工触发的 GPU L0 workflow，结束时恢复文本与 OCR 常驻。
- R8.2 在 Python 3.10.19 隔离容器中完成 OCR 适配器全依赖安装、`pip check` 与 8/8 契约测试；这不代表真实 Paddle 推理或准确率通过。旧 Staging `.env` 的 19 个仓库管理项已安全升级，第二次初始化更新 0 项且不改 secret。完整本地 release 将在干净提交后执行；详见 [`docs/汇报/R8_2_CONDITIONAL_ACCEPTANCE_AUTOMATION_REPORT_2026-07-18.md`](docs/汇报/R8_2_CONDITIONAL_ACCEPTANCE_AUTOMATION_REPORT_2026-07-18.md)。
- R8.2 首次完整 release 在构建前暴露 Compose 共享镜像误拉取：`minio-init` 复用本地 backup 镜像却被当作 registry 镜像。现已改为只拉取 5 个固定第三方运行服务，且失败现场无容器/数据写入；该项修复已进入后续重跑验证。
- R8.2 后续两次构建均被 Docker Hub 的 mutable BuildKit SBOM scanner 认证端点超时阻断，当时按纪律标记外部阻断并停止重试。审计确认该重复产物从未进入发布清单；现保留 BuildKit max provenance，正式 SBOM 由固定版本与固定发布包哈希的 Syft 生成、封存并交给固定 Grype 门禁。
- R8.5 第三次完整 release 已成功构建、锁定并扫描 18 个镜像，生成 57 份供应链产物和 sealed index；随后真实暴露 PostgreSQL 只监听 `localhost`，本地 socket 健康检查误报就绪，迁移容器以 P1001 失败。现改为监听私有 Compose 网络，并以 migrator 角色、`verify-full` CA 校验和真实 `SELECT 1` 作为健康条件；泛化 host HBA 被移除且非 TLS 明确拒绝。
- 同次失败栈的日志门禁检出一个 exact secret，但旧证据只含类别，无法在清理后可靠归因。现新增只报告 secret 文件名、服务和次数的安全定位证据；策略单测 4/4，证据不保留值或原日志。失败栈已 `down -v --remove-orphans`，容器、网络和卷残留均为 0；完整 release/restore/rollback 仍待本修复提交后重跑。
- R8.6 对 R8.5 commit 的 1001.3 秒完整发布已动态证明：18 镜像构建/锁定/扫描、PostgreSQL 远程 TLS、28 条 migration、全部服务健康、API smoke 与浏览器 smoke 均通过；随后因备份进程的 `mc` 默认配置目录不可写，首轮备份失败，restore drill 正确拒绝在没有完整备份时运行。
- R8.6 干净提交的完整 release 已在 1010.9 秒内通过，sealed manifest 的 config/image identity/SBOM/CVE/migration/smoke/restore drill 七项 gate 全绿；运行日志 718,592 bytes/3,393 行、19 个 secret 为 0 finding。同 manifest rollback 55.6 秒通过保护性备份、四角色登录、readiness/worker、metrics 和二次 smoke，未恢复 live 数据；由于没有更早的合法 manifest，这不冒充跨版本回退。详见 [`docs/汇报/R8_6_BACKUP_RELEASE_GATE_REPORT_2026-07-18.md`](docs/汇报/R8_6_BACKUP_RELEASE_GATE_REPORT_2026-07-18.md)。
- rollback 暴露后端镜像缺少 OpenSSL CLI，Prisma 会猜测旧 binary target。R8.7 新增 build/runtime OpenSSL 3 依赖及 CI 最终镜像探针；本机构建确认 Prisma 6.19.3 选择 `debian-openssl-3.0.x` 且无告警。完整 release 两次均在 node-exporter 获取 Debian security 索引时遇到 502，按规则停止重试并记录外部阻断；未把 migration/rollback 重验写成通过。Compose 清场后本项目容器、网络和卷均为 0。详见 [`docs/汇报/R8_7_PRISMA_OPENSSL_RUNTIME_REPORT_2026-07-18.md`](docs/汇报/R8_7_PRISMA_OPENSSL_RUNTIME_REPORT_2026-07-18.md)。
- R8.9 复现 GitHub Build run `29666837943` 的 Docker Scout entitlement 失败后，已改为固定 Syft `1.44.0`、校验发布包 SHA-256，并把业务门禁移到扫描之前。run `29752263099` 证明这条替代链可在 Linux runner 生成 SPDX 并调用固定 Grype，且业务门禁不再被提前跳过；它随后按设计拒绝了旧 Nginx 的可修复 Critical。详见 [`docs/汇报/R8_9_CI_SBOM_ENTITLEMENT_HARDENING_REPORT_2026-07-20.md`](docs/汇报/R8_9_CI_SBOM_ENTITLEMENT_HARDENING_REPORT_2026-07-20.md)。
- M8.1 没有降低 `--only-fixed --fail-on critical`：第一次候选 `1.28.3-alpine` 仍被当前漏洞库拒绝，最终选择 2026-07-18 更新的官方稳定版 `1.30.4-alpine3.24`。本地与远端真实前端镜像、R5 夹具的 Syft/Grype 门禁均通过；远端 Build run `29755386892` 完整成功。Nginx 19/50 MiB 接受、50 MiB + 1 拒绝和无临时残留也通过。详见 [`docs/汇报/M8_1_NGINX_CI_SECURITY_REFRESH_2026-07-20.md`](docs/汇报/M8_1_NGINX_CI_SECURITY_REFRESH_2026-07-20.md)。
- R9.1 已把登录口令限流从单进程状态升级为 Redis Lua 原子共享控制：用户名/IP 只以 SHA-256 键出现，租约使用 Redis 时钟，实例崩溃可自动回收，断连失败关闭且不签发 JWT。双实例 100 路并发、重启保持、租约恢复和断连攻击 4/4 通过；后端 419/419 unit、PostgreSQL/Redis 101/101 integration 和 build 通过。详见 [`docs/汇报/R9_1_SHARED_LOGIN_RATE_LIMIT_REPORT_2026-07-21.md`](docs/汇报/R9_1_SHARED_LOGIN_RATE_LIMIT_REPORT_2026-07-21.md)。
- R9.1A 修复一次 Excel 嵌入媒体回归中观察到的 shared-string 未解析风险：有界 ZIP/XML 元数据阶段现在确定性提取并预加载共享字符串，残留内部 token 会失败关闭，不再被转成伪表头。定向 15/15、连续 10 轮 0 失败、4 路并发一致、真实 PostgreSQL XLSX API 场景和全量 419/419 unit 通过。详见 [`docs/汇报/R9_1A_XLSX_SHARED_STRING_HARDENING_REPORT_2026-07-21.md`](docs/汇报/R9_1A_XLSX_SHARED_STRING_HARDENING_REPORT_2026-07-21.md)。
- R9.2 已把上传并发数、在途字节和速率窗口迁移为 Redis Lua 原子共享准入：用户标识只以 SHA-256 键出现，活跃上传使用 Redis 时钟租约并在请求期间续租，崩溃可回收，断连失败关闭，健康释放在响应完成前落地。双实例 100 路竞争、重启保持、续租/崩溃恢复、断连攻击 4/4 通过；后端 422/422 unit、PostgreSQL/Redis 105/105 integration 和 build 通过。该阶段留下的模型子项已由后续 R9.3 关闭。详见 [`docs/汇报/R9_2_SHARED_UPLOAD_ADMISSION_REPORT_2026-07-21.md`](docs/汇报/R9_2_SHARED_UPLOAD_ADMISSION_REPORT_2026-07-21.md)。
- R9.3 已把 AI、OCR 和真实推理型健康探针统一迁移到 Redis Lua 共享 FIFO 执行门：全局并发/排队预算、Redis 时钟租约、续租、实例崩溃回收、等待超时和断连失败关闭均有双实例证据；原始部署键只以 SHA-256 摘要进入 Redis 和指标标签。专项 Redis 6/6、后端 47 suites / 428 tests、最终 PostgreSQL/Redis 13 suites / 113 tests 和 build 本地通过。代码层三类共享闸门已关闭，但提供的 Compose 仍保持单 API/单 Worker，目标服务器多实例 release/restore/rollback 继续受 H13/H14 阻断。详见 [`docs/汇报/R9_3_SHARED_MODEL_EXECUTION_GATE_REPORT_2026-07-21.md`](docs/汇报/R9_3_SHARED_MODEL_EXECUTION_GATE_REPORT_2026-07-21.md)。
- R9.3A 在全量回归中复现 PostgreSQL WAL checkpoint 令 30,196 行最终发布事务触发 Prisma `P2028`；旧逻辑错误进入终态 `confirmation_failed`。现在 `P2028/P2034` 与短断、连接池超时一样释放租约并由 Worker 有界恢复，暂存记录保持不可见，最终仍只发布一次。P1001/P2028/P2034 定向 3/3、最终 13 suites / 113 integration 通过；30,196 行在真实超时恢复后 167.004 秒完成，距 180 秒预算余量较小，目标磁盘与 PostgreSQL 参数仍须 H13 容量验收。详见 [`docs/汇报/R9_3A_IMPORT_CONFIRMATION_TRANSIENT_RECOVERY_REPORT_2026-07-21.md`](docs/汇报/R9_3A_IMPORT_CONFIRMATION_TRANSIENT_RECOVERY_REPORT_2026-07-21.md)。
- R9.3B 针对远端 run `29768468874` 中“30,196 行已全部暂存但 180 秒内未完成发布”的红灯，把重复全表计数改为租约围栏增量，并将全量哈希重算移到带心跳的发布预检。该阶段的 114 个测试是历史性能证据，尚未覆盖通用 API 提前可见、暂存内容篡改和最终少更新一行；这些缺口后来由 CR-002 至 CR-005 重新打开并关闭。详见 [`docs/汇报/R9_3B_IMPORT_PUBLICATION_TRANSACTION_HARDENING_REPORT_2026-07-21.md`](docs/汇报/R9_3B_IMPORT_PUBLICATION_TRANSACTION_HARDENING_REPORT_2026-07-21.md)。
- Excel 暂存完整性重审先用攻击测试证明未发布记录可被列表/详情/修改/确认/作废路径触达，随后引入显式 `unpublished|published` 可见性、逐记录 canonical SHA-256、来源镜像、数据库失效触发器、最终精确 affected-row 断言和失败后全量清理。强制 Redis 全量现为 13/13 suites、119/119 tests；30,196/49,999 行确认分别为 60.627/151.716 秒，仍低于 180 秒产品断言，但 49,999 行余量不足以替代 H13 目标容量验收。完整证据见 [`docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md`](docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md)。
- CR-006 修复了 Prompt Registry 只校验/哈希 `userPromptTemplate`、但 Provider 仍收到通用包装文本的执行偏差。模板现在只接受唯一的 `input_json` 白名单变量，先把 Date、Prisma Decimal、bigint 和普通 JSON 规范化，再 canonical 渲染；任意类实例、循环、非有限数、原型污染键、未知/重复变量、Schema 漂移和预算溢出均失败关闭。`AiTask/AiCallLog` 冻结 Prompt 组件、system/template/rendered/schema/input 哈希、Provider/模型向量和输出哈希，不保存渲染后的业务正文。老板助手、Excel/OCR 建议和 ReportSnapshot 叙述 PostgreSQL/Redis 专项 7/7 通过。空白正式 Catalog 与 production bootstrap 仍未关闭。
- H10 已选择沿用四角色；最新任务书明确保留不同财务账号审批，因此 Excel/OCR 上传者继续禁止自审批。批量批准入账及用户停用/重置/权限变更需要 step-up；具体身份方式仍为 `OWNER_CONFIRMATION_NEEDED`，不能由 CI 绿色替代。

逐项编号、负责人、状态和验收门禁见 [`docs/汇报/B8_BLOCKER_MATRIX.md`](docs/汇报/B8_BLOCKER_MATRIX.md)。R1 工程 P0 与 R9.1-R9.3 三类共享控制的本地工程子项已关闭，但目标 Staging、正式恢复和人工门禁未完成，仍不进入真实用户试运行。

M0 没有另建平行 Excel/OCR/Provider/Worker：`ImportTask/Sheet/Column/Row`、`OcrTask/Attempt/Correction`、`AiPromptVersion/AiTask/AiCallAttempt/AiCallLog`、项目锁、幂等、audit/ledger 和现有 Reports/Claim 都作为首选扩展点。审计同时确认现有 Excel 会在错误行存在时按 `valid_rows_only` 部分入账、Import/OCR 上传者可自确认、缺少不可变 review/validation/approval/commit 与 canonical ReportSnapshot；这些已登记为 M1-M6 P0/P1，不能沿用旧 B8 绿色结论。详见 [`docs/汇报/M0_AI_MAPPING_REUSE_AUDIT_2026-07-18.md`](docs/汇报/M0_AI_MAPPING_REUSE_AUDIT_2026-07-18.md)。

M1 已在现有解析链上补齐 `excel-ir/1.0` 与 `ocr-ir/1.0`：Excel 保存 Sheet/表头/地址/lexical/display/公式缓存/合并锚点证据，OCR 保存页尺寸、真实预处理、稳定 block/token/candidate ref 和 bbox 坐标版本；任务冻结来源、解析输入、Provider 与 IR 哈希。29 条 migration 的空库和 28→29 升级、40/40 后端 suites、4 条 PostgreSQL Excel/OCR/Worker 链及构建均通过。真实 OCR 准确率、财务 review revision 和 AI 建议仍未宣称完成。详见 [`docs/汇报/M1_INGESTION_IR_EVIDENCE_REPORT_2026-07-18.md`](docs/汇报/M1_INGESTION_IR_EVIDENCE_REPORT_2026-07-18.md)。

M2.1 已禁止从 Markdown code fence 宽松提取 JSON，并拒绝重复键、原型污染键、指数数字、超预算结构、控制字符、零宽字符和双向控制字符。分类、字段映射和报告叙述只能返回严格版本化 Schema 与 `NEEDS_FINANCE_REVIEW`；服务端再次核对本次请求的模板版本、字段、evidence ref、转换键和 Snapshot 白名单。定向 TypeScript 检查及 3/3 suites、34/34 tests 已通过；模式、kill switch、Prompt Registry 和 Provider 失败关闭仍在 M2 后续小块中推进。

M2.2 新增服务端 `AI_INGESTION_MODE`、`AI_REPORT_MODE`、`AI_GLOBAL_KILL_SWITCH`、`AI_EXTERNAL_PROVIDER_MODE` 和 Provider class 校验。缺失模式默认 `disabled`，非法值拒绝启动，组织/项目/模板策略取最保守值，kill switch 优先阻断所有新调用；H12 未批准时外部 Provider 默认关闭，即使显式设为 `synthetic-only` 也拒绝真实或未知数据。grounding 失败只会明确转人工并记录原 Provider 失败，不再静默调用 Mock。定向 TypeScript 检查及 6/6 suites、100/100 tests 已通过。

M2.3 基于现有 `AiPromptVersion` 落地固定 9 项 manifest、`finance_core_guard` 和兼容老板助手 V2；每个不可变版本保存用途、输入/输出 Schema、Provider class、输入预算、超时、脱敏版本、组件引用和内容 SHA-256。运行时同时核对代码定义、数据库内容和核心 guard 哈希，退役版本可历史读取但不能发起新调用；seed 遇到同版本漂移会失败并要求新增版本。第 30 条 migration 的空库及 29→30 升级、7/7 suites 106/106 tests、Registry PostgreSQL 3/3 及真实老板 AI PostgreSQL 链路 1/1 已通过。受保护的 Prompt Catalog 文件仍为空，因此仅声明固定 manifest 来自任务书，不声明完成目录逐字核对。

M2.4 新增 `ai-invocation-vector/1.0`，一次冻结 source/IR、模板/候选集、Prompt/Schema、Provider/模型、转换器、校验规则、mapping profile、脱敏、授权、feature policy 与输入哈希，并为输出生成独立 completion hash；任一版本变化都会改变向量哈希。显式 Mock Provider 覆盖成功、无映射、非法 JSON、超时和注入输出，所有 raw 元数据标明 `mock: true`。Prompt 的输入预算、超时和最大尝试次数已进入真实 HTTP 执行参数。M2 全量证据为后端 44/44 suites、390/390 tests，PostgreSQL 8/8 suites、87/87 tests，后端 build、30 条 migration 空库及 29→30 升级通过；详见 [`docs/汇报/M2_AI_GUARDRAILS_AND_PROMPT_REGISTRY_REPORT_2026-07-18.md`](docs/汇报/M2_AI_GUARDRAILS_AND_PROMPT_REGISTRY_REPORT_2026-07-18.md)。

M3.1 将既有 `MappingProfile` 原地升级为项目级、内容寻址的结构配置：指纹只包含工作簿格式、解析器主版本、Sheet/多行表头/合并结构、列顺序与推断类型、模板版本和转换注册表版本，不包含整表业务值。Profile 保存版本、审批快照哈希、策略版本、使用次数和 `active/stale/revoked` 状态；只在项目和结构完全匹配时复用，跨项目或结构变化不会模糊匹配。新结构获财务保存会令旧结构失效，撤销会清除未提交任务中的 Profile 决定并写 audit/ledger；数据库还拒绝未知转换键和状态/活动标志矛盾。第 32 条 migration 的空库及 31→32 升级、后端 45/45 suites 398/398 tests、PostgreSQL Profile 与历史 Excel 定向回归各 1/1 和后端 build 已通过；详见 [`docs/汇报/M3_1_MAPPING_PROFILE_STRUCTURE_SCOPE_REPORT_2026-07-18.md`](docs/汇报/M3_1_MAPPING_PROFILE_STRUCTURE_SCOPE_REPORT_2026-07-18.md)。

M3.2 在现有导入链加入财务专用 Excel AI 建议接口：每个任务只发送有预算限制的列摘要和当前项目启用模板白名单，分类与映射各调用一次，不发送全量行或原文件。服务端严格核对来源完整覆盖、必填字段、evidence ref 和字段类型转换；AI 只能返回待财务复核建议。`AiTask` 以请求/输入/版本向量/输出哈希内容寻址，并使用 UUID 租约、advisory lock、3 次重试预算和 Provider 发送前 kill switch 复核；过期执行的迟到响应不能覆盖新结果。分类期间来源、文件、项目模板或任务状态变化会在映射前失败关闭。Profile 哈希篡改、非法输出、模型失败均转人工，正式记录始终为 0。后端 46/46 suites、401/401 tests，PostgreSQL 9/9 suites、92/92 tests，34 条 migration 空库及 33→34 升级、前后端 build 和 680 文件卫生通过；详见 [`docs/汇报/M3_2_EXCEL_AI_SUGGESTION_REPORT_2026-07-20.md`](docs/汇报/M3_2_EXCEL_AI_SUGGESTION_REPORT_2026-07-20.md)。

M4.1 已复用同一 `AiTask/AiCallAttempt/AiCallLog` 执行链，为 OCR 增加财务专用分类与字段映射建议。模型只看到页面几何、被候选字段实际引用的有界 OCR 片段和项目启用模板版本；服务端验证 IR 内容哈希、source/evidence 绑定、字段/转换白名单和全量 source 覆盖。无证据值、越界引用及跨页冲突失败关闭或保持未映射，AI 仍不能批准或创建业务记录。针对性后端 2 suites/16 tests、PostgreSQL 1 suite/5 tests 和后端 build 已通过；M4 尚未关闭，下一小块是 review revision、确定性重新校验和 bbox 复核 UI。

M4.2 新增第 35 条向后兼容 migration：每次 OCR 人工修正形成新的 `reviewRevision`，保存 `MANUAL_OVERRIDE`、理由和 evidence refs，并原子清除旧 ValidationSnapshot。`POST /api/ocr-tasks/:id/revalidate` 以 expected task/review version 防旧页面覆盖，重新校验来源 IR 哈希、模板字段、类型、必填项、证据归属和跨页冲突，再保存内容寻址快照；重复候选不再静默择一。OCR 定向 PostgreSQL 场景和模型路由场景通过，migration 空库 35/35 与 34→35 升级通过；长 PostgreSQL 回归 65/66 初次通过，唯一失败为新增 4 条模型路由后的旧固定计数，更新为 13 后已定向复验通过。M4 的剩余项是前端 bbox 证据复核和人工 evidence 选择。

M4.3 已完成财务 OCR 证据复核工作台：使用固定 `pdfjs-dist 6.1.200` 和本地 Worker 解析经鉴权预览接口取得的 PDF 字节，不依赖 CDN；图片/PDF 均按原页码叠加 bbox，未知旋转变换保守关闭高亮。界面区分原值、人工 `MANUAL_OVERRIDE`、修订版本、冲突候选、AI 建议与确定性校验，修正原因和 evidence ref 必填，旧校验失效后确认按钮保持禁用。真实 API Playwright 已验证 Mock AI 只建议且创建记录数为 0、PDF 画布/bbox、390px 移动视口、修订、重新校验和确认链；详见 [`docs/汇报/M4_OCR_AI_EVIDENCE_REVIEW_REPORT_2026-07-20.md`](docs/汇报/M4_OCR_AI_EVIDENCE_REVIEW_REPORT_2026-07-20.md)。该阶段当时保留的直接确认风险已由下述 M5.1 OCR 子任务关闭。

M5.1 已关闭 OCR 直接确认 API 的工程 P0：批准命令必须携带 expected task/review/validation/payload hash 和逐项 warning ID；最终事务重新读取账号与角色，拒绝上传者自审批，并重验文件安全状态、source/IR、模板、候选值和 evidence。批准快照冻结 Provider/模型、规则/策略、批准人、幂等请求和规范输出哈希，`BusinessRecord/RecordValue`、任务、audit 与 ledger 同事务提交。PostgreSQL 已验证文件作废、账号停用、角色撤销、两名财务并发、同键重放和改体冲突；详见 [`docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md`](docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md)。

M5.2 当时关闭了 Excel `valid_rows_only` 部分发布问题：每个有效明细行独立入账，普通错误明细不可通过排除绕过，疑似汇总行必须财务明确处置，任何修改使旧校验失效。第 37 条 migration、403 个 unit、96 个 PostgreSQL 和 17 个 Playwright 是该阶段的历史证据；它们不覆盖后来发现的通用 API 暂存隔离与逐记录完整性问题。现行 P0 结论以 CR-002 至 CR-005 和 [`docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md`](docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md) 为准。

M6 已在现有 Reports、`AiPromptVersion/AiTask/AiCallAttempt/AiCallLog` 和 `AiFinancialClaim/sourcePath` 上落地不可变报告证据链。固定查询只读取 `confirmed + actual`，在 PostgreSQL repeatable-read 水位内以 Decimal 分币种计算并冻结来源记录版本/hash；相同事实复用相同核心快照。AI 报告使用独立 `AI_REPORT_MODE`，只能逐字选择服务端生成的 Claim 白名单，不能自由添加客户、原因、比较、预测或数字；Snapshot、Narrative 和 Claim 由数据库触发器防修改。工程与合成验收通过，但 H06/H08 的真实逐分对账、正式指标口径为 `REAL_SAMPLE_NEEDED`，报告复核角色为 `OWNER_CONFIRMATION_NEEDED`；详见 [`docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md`](docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md)。

M7 完成任务书第 12 节的攻击、资源和 Provider 降级联合回归，并用红灯复现了相同 ReportSnapshot 并发请求偶发 409。修复只对 Prisma `P2002/P2034` 执行最多三次新事务重试；六个并发请求现复用同一不可变快照。报告 AI 并发最多调用一次 Provider，kill switch、无 Token/越权、超时、截断 JSON、值篡改和 warning 隐藏均失败关闭。47/47 后端 suites、10/10 PostgreSQL suites、17/17 Playwright、迁移双路径、构建、依赖审计、模型健康及 Staging 静态门禁通过；49,999 行仍存在约 45-143 秒性能波动并保留风险。详见 [`docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md`](docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md)。

M8 已完成最终工程收口：架构、API、E2E、本地运行、PR review/准备、README、进度和阻塞矩阵统一到 M5-M7 真实边界；Prompt manifest/guard 4/4 单测与空库 41 migration 后 registry/seed/Schema/hash 3/3 PostgreSQL 测试通过；前后端构建、runtime 4/4、空库 41 和 40→41、708 文件卫生及两套 0 vulnerability 审计再次通过。受保护 Prompt Catalog 仍为 0 字节，不能宣称逐字核对完成；GitHub 推送、目标环境和 H 门禁保持诚实阻塞。最终证据见 [`docs/汇报/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md`](docs/汇报/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md)。

## 已实现闭环

```text
员工登录
  -> 创建工单并上传附件
  -> 财务审核
  -> 复核员复核
  -> 规则/AI 基础检查
  -> 老板最终审批
  -> 生成 confirmed 经营记录和动态字段值
  -> 通知、审计时间线、财务/老板/项目日报
  -> 老板 AI 助手基于结构化 PostgreSQL 数据回答问题
```

关键不变量：

- 后端从 JWT/Cookie 解析当前用户，不信任前端传入的 `role`、`creatorId` 或目标用户身份。
- 关键业务动作写入 `audit_logs`；经营记录、文件和审批链路写入 `ledger_events` 或对应不可变事件。
- 正式金额通过固定两位小数字符串传输，数据库和聚合使用 `Prisma.Decimal`，避免 JavaScript 浮点损失。
- 报表只统计已经确认和正式发布的 `actual` 记录，不统计草稿、处理中、待确认或作废数据。
- Excel 与 OCR 使用持久化后台任务、lease、heartbeat、重试和取消边界，不依赖超长同步 HTTP 请求。
- OCR 永远需要另一名财务在当前确定性校验快照上批准；未经批准、上传者自审批或快照陈旧时不会生成正式经营记录。
- AI Provider 只能返回受约束的 Claim；后端验证 metric、entity、period、value 和 sourcePath 后确定性渲染答案。
- 原始文件先鉴权、隔离和 fail-closed 扫描，再允许预览、下载、Excel 解析或 OCR。

## 阶段进展

| 阶段 | 状态 | 已实现内容 |
| --- | --- | --- |
| 0 | 已完成 | NestJS、TypeScript、统一响应/错误、配置、Swagger、Health、Prisma/PostgreSQL |
| 1 | 已完成 | 用户、角色、bcrypt 密码、JWT、登录/退出、权限守卫、用户审计 |
| 2 | 已完成 | 项目、模板、字段字典、模板字段、项目启用模板、项目结构聚合 |
| 3 | 已完成 | BusinessRecord、RecordValue、手工补录、确认、软作废、经营事件 |
| 4 | 已完成 | 工单创建、提交、财务审核、复核、规则检查、老板审批和时间线 |
| 5 | 已完成 | 附件上传、隔离、预览、下载、删除、通知和逐用户已读状态 |
| 6 | 已完成 | 风险规则、异常生成、处置、追踪和审批闭环 |
| 7 | 已完成 | 审批后经营记录、财务日报、老板日报、项目日/月报 |
| 8 | 已完成 | 老板 AI 会话、结构化工具、Claim grounding、调用日志和审计隔离 |
| 9 | 已完成 | `.xlsx` 检查、映射、预览、错误行、字段建议和异步确认入账 |
| 10 | 程序完成 | OCR Task、Paddle 适配、证据/置信度、纠错、重试、取消和人工确认；真实准确率待标注 |

## B8、RC 与 R 系列加固进展

以下是 B8/RC 已验证的历史工程能力，不表示 R 系列新问题已经关闭：

- Excel 首次确认只接受正确状态；取消、确认、重试和并发请求具备数据库终态断言。
- 5,001、30,196 和 49,999 行 Excel 完成后台分块确认、短事务写入、原子发布、审计、ledger 和报表闭环。
- OCR 金额保持 Decimal 字符串；1/3/5 并发、排队、续租、取消、重试、恢复和实际 Provider 快照已有测试。
- 四种记录来源共用会计方向、主金额和主日期策略，模板版本不可变。
- 文件链路覆盖伪扩展名、主动内容、公式注入、EICAR、PDF/图片资源上限、配额、水位和 DLP。
- 认证边界覆盖固定 JWT 算法/issuer/audience/purpose、双提交 CSRF、生产 Cookie 家族和职责分离。
- 老板 AI 具备 owner 隔离、结构化 Claim、错位数字防护、输出边界和 Provider 降级语义。
- 模型控制面覆盖配置快照、鉴权 readiness、GPU 跨进程互斥、固定镜像、SBOM/CVE 和代理上传边界。
- API/Worker 已拆分；Redis 提供共享请求限流和 Worker heartbeat；文件可使用私有 S3/MinIO。
- Staging 已提供 TLS、PostgreSQL 账号分离、ClamAV、Prometheus/Loki/Tempo、关联备份恢复和应用/数据/模型回退。
- RC 审计修复了 ReDoS、路径越界、Redis 重连、对象误清理、跨账号缓存、OCR 连接池死锁、shutdown drain、金额分值、客户端统计和 migration 路径等问题。

详细问题状态见 [`docs/汇报/B8_BLOCKER_MATRIX.md`](docs/汇报/B8_BLOCKER_MATRIX.md) 和 [`docs/汇报/RELEASE_CANDIDATE_AUDIT.md`](docs/汇报/RELEASE_CANDIDATE_AUDIT.md)。

## 自动化证据

以下是截至 2026-07-21 的最近工程基线：

| 门禁 | 结果 | 证据摘要 |
| --- | --- | --- |
| 前端 production build | `passed` | 显式 `api + /api`；Vite 构建 3,147 modules；产物清单复核通过 |
| 后端 build | `passed` | Prisma Client、NestJS 应用和脚本 TypeScript |
| 后端 Jest | `passed` | 本地全量 47/47 suites，428/428 tests |
| PostgreSQL 集成 | `passed` | 强制 Redis 全量 13/13 suites，119/119 tests；含 ReportSnapshot/Claim、AI 租约、step-up、retention、Excel/OCR 严格批准、Redis 共享控制、暂存攻击和大表 Worker 恢复 |
| 浏览器 E2E | `passed` | Playwright 17/17；含真实 API 服务端翻页 20→5 行 |
| 前端运行时配置 | `passed` | 4/4；缺失/非法模式、危险 URL 和路径逃逸均失败关闭 |
| Prisma | `passed` | generate/validate/build 与隔离 `_test` 库 43/43 migrations |
| Migration 路径 | `passed` | 空库 43 条及 42→43 升级；Excel 发布隔离与完整性 migration 已覆盖 |
| Excel 预览预算 | `passed` | 当前页查询；摘要批次 500；pageSize 1-100；响应上限 1 MiB；50,000 行深页和缓存回访通过 |
| 项目模板并发 | `passed` | 统一 key 22 事务锁；启用/停用与记录、Excel Worker、OCR、工单终审两种顺序均有 PostgreSQL 断言；锁超时稳定 409 |
| 重复候选窗口 | `passed` | 0/365 天、UTC、前后边界、跨月/跨年和越界拒绝；结果、异常、audit、ledger 一致，H03 前不自动处置 |
| 财务阈值 Decimal | `passed` | 规范字符串、按分精确比较、最大值、旧安全整数告警，以及 unsafe numeric/科学计数法字符串/超精度/越界稳定拒绝；全链路不静默舍入 |
| 财务写入口幂等 | `passed` | 作用域指纹、请求哈希、首次响应重放、改体 409、并发单事实和事务回滚均有单元/PostgreSQL 断言；正式强制范围与保留期仍待 H 门禁 |
| H01/H02/H07 保守基线 | `ENGINEERING_VERIFIED` | H01 已 `OWNER_CONFIRMED`：按有效明细行入账且汇总不双计；精确标签汇总候选需财务处置，普通错误明细不可排除，整批失败关闭。H02/H07 未决参数继续 `SAFE_DEFAULT_ACTIVE` |
| Excel AI 分类/映射 | `engineering_passed` | 项目模板/字段/证据/转换白名单、严格 Schema、kill switch、调用租约、重试耗尽、旧响应竞争和状态变化失败关闭均有自动断言；只生成建议，不批准或入账 |
| Prompt 执行与 provenance | `engineering_verified_locally` | 版本化用户模板真实进入请求；受控 JSON 规范化、输出 Schema 哈希绑定、执行向量 1.1 和脱敏调用台账已覆盖老板助手、Excel/OCR 与报告；正式 Catalog 正文和 production bootstrap 仍开放 |
| OCR AI 分类/映射 | `engineering_passed` | M4.1-M4.3 已验证受限证据摘要、source/evidence 绑定、跨页冲突、review revision、旧快照失效、重新校验和 PDF/图片 bbox 人工复核；真实准确率仍待 H04/H05 |
| OCR 财务批准事务 | `ENGINEERING_VERIFIED` | expected version/hash、稳定 warning ID、最终账号/角色/文件/模板/证据重验、禁止上传者自审批、不可变批准快照和同事务唯一记录；两名财务并发与重放攻击已有 PostgreSQL/Playwright 断言 |
| Excel 财务批准事务 | `ENGINEERING_VERIFIED` | review revision、第二财务、显式未发布隔离、逐记录内容哈希、数据库失效触发器、最终重鉴权和精确更新行数围栏；普通错误明细不能绕过 |
| ReportSnapshot/AI 叙述 | `ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED` | repeatable-read、confirmed actual、Decimal、分币种、来源 digest、不可变快照、精确 Claim 白名单、warning 全覆盖、独立 report kill switch；H06/H08 真实真值仍开放 |
| Retention dry-run | `engineering_passed` | 新 AI 调用日志只留元数据；9 类盘点、legal hold、双实例 lease、匿名证据和耗尽恢复通过；真实删除由 H12/H14 禁止 |
| Step-up/SoD 基础设施 | `engineering_passed` | 一次性 action/resource/session grant、并发防重放、身份变化撤销和高风险接口守卫通过；默认关闭，MFA/正式职责分离待 H10 |
| 大批量 Excel | `engineering_passed / target_capacity_pending` | 完整暂存围栏下强制 Redis 全量中 30,196/49,999 行为 60.627/151.716 s；最终记录、动态值、金额、audit、ledger 和日报闭环，目标磁盘/WAL/p95/p99 仍待 H13 |
| OCR 并发 | `passed` | 1/3/5 精确并发门禁；最新 GitHub 集成 60/60 |
| Repository hygiene | `passed` | 真实数据、模型、secret、构建产物和本机供应链证据排除；提交前全量与 staged 门禁均执行 |
| 生产依赖审计 | `passed` | 根目录与后端均为 0 vulnerabilities |
| Paddle adapter | `passed` | 运行镜像内 8/8；合成 PDF 实际 OCR 接受测试通过 |
| 模型韧性 | `passed` | 文本重启、VL 切换、文本恢复；432 次 OCR readiness 采样零失败 |
| Staging 静态门禁 | `passed` | 18 services、19 secrets、TLS、仓库自建服务、第三方 digest、私网和只读应用容器 |
| R5 镜像身份与供应链 | `engineering_passed` | 17/17 篡改/漂移测试；22 个锁定镜像、66 份证据、无可修复 Critical；53 High/88 Medium/38 Low 仍在风险台账，签名与目标 registry 待 H13 |
| R8.1 应用镜像 CI | `engineering_verified_ci` | run `29752263099` 完成真实前后端镜像构建、非 root/revision、两份 SBOM 和扫描；旧 Nginx 被安全门禁正确阻止 |
| R8.2-R8.7 条件验收自动化 | `ENGINEERING_VERIFIED / EXTERNAL_RESOURCE_NEEDED` | scheduled/manual Staging、恢复、回滚、Python adapter 与 GPU L0 workflow 已建立；本机 release/日志/同 manifest rollback、Python 8/8 和真实模型 L0 通过；目标 self-hosted 环境尚未提供 |
| R8.9 CI SBOM | `verified` | 固定 Syft 版本与发布包哈希，移除 Scout entitlement；run `29752263099` 已证明 Linux runner 的 SPDX/Grype 链真实执行并在业务门禁后阻断漏洞 |
| M8.1 Nginx Critical 修复 | `verified_ci` | 官方稳定镜像固定 tag+digest；本地真实前端与 R5 夹具各 72 包、可修复 Critical 0；远端 Build 两个 jobs 全绿；供应链攻击 17/17、上传边界和非 root 行为通过 |
| R9.1 共享登录限流 | `engineering_verified_locally` | Redis 原子四层预算、摘要键、服务器时钟租约、幂等完成和失败关闭；4/4 双实例攻击、419/419 unit、101/101 integration |
| R9.1A XLSX shared string | `engineering_verified_locally` | 确定性预加载与残留 token 失败关闭；15/15 定向、10 轮压力 0 失败、真实 PostgreSQL API 场景通过 |
| R9.2 共享上传准入 | `engineering_verified_locally` | Redis 原子并发/字节/速率预算、摘要键、续租与崩溃回收、失败关闭；4/4 双实例攻击、422/422 unit、105/105 integration |
| R9.3 共享模型执行门 | `engineering_verified_locally` | AI/OCR/推理健康探针共用 Redis FIFO 并发预算；6/6 双实例/租约/超时/故障测试，当前候选 428/428 unit、119/119 integration；目标多实例 Staging 仍待 H13 |
| R9.3A/R9.3B 导入恢复与发布收敛 | `historical_engineering_evidence` | P2028/P2034 有界恢复和预检外移仍有效；旧 114-test 结论不再单独代表暂存完整性关闭 |
| Excel 暂存完整性重审 | `engineering_verified_locally` | CR-002 至 CR-005 覆盖提前可见/写入、记录和值篡改、来源竞态、少更新一行、慢批次和重试；119/119 integration，最新远端状态以 Draft PR #4 为准 |
| R10 本地模型 L0 | `engineering_verified_l0` | 四套资产完整；Qwen/Paddle 认证合成推理、未授权 401、容器配置、锁与镜像内 Python contract 8/8 通过；L1 准确率仍待 H04-H13/H15/H16 |
| 本机隔离 Staging smoke | `passed` | 18 服务真实启动；Node/TLS smoke 与浏览器 API/CSP/合成写读软归档通过；容器和卷残留 0 |
| 日志泄露门禁 | `passed` | 实际 18 服务生成 200/400/503 日志；29 条网关 JSON 可解析，15 个合成敏感标记泄露 0，容器和卷残留 0 |
| 存储容量真实性 | `ENGINEERING_VERIFIED / EXTERNAL_RESOURCE_NEEDED` | S3 不再伪报固定容量；79/79 定向测试与 PostgreSQL 跨账号/项目并发通过；MinIO v3 物理指标实测存在；目标配额和保留策略仍开放 |
| Shell/Compose | `passed` | 10/10 shell、1/1 PowerShell syntax、两份 Compose config |
| 最新 GitHub Build | `passed` | run `29755386892`；应用镜像供应链 job 2m37s，PostgreSQL/E2E/R5 job 12m30s，全部成功 |
| 最新 GitHub CodeQL | `passed` | run `29755387035`；JavaScript/TypeScript 分析成功 |
| 目标 Staging release | `EXTERNAL_RESOURCE_NEEDED` | 本机隔离启动不等于 H13 目标环境；尚未执行目标 Linux release、真实 restore/RPO/RTO 或 rollback drill |

测试数量下降必须解释，不得通过删除测试、放宽安全断言或静默回退 Mock 制造绿色结果。

## 尚未完成的门禁

| 状态 | 事项 | 最小输入或证据 |
| --- | --- | --- |
| `OWNER_CONFIRMATION_NEEDED` | 负数/更正、必填附件、报告复核、合理性规则、step-up、扫描绕过、对账周期、RPO/RTO、保留期和外部 Provider | 在 [`docs/owner-input/OPEN_QUESTIONS.md`](docs/owner-input/OPEN_QUESTIONS.md) 选择；未回答时采用失败关闭默认 |
| `REAL_SAMPLE_NEEDED` | 汇总/重复样例、财务逐分对账、17 份 OCR 标签与 5 份盲测、老板 AI 标准问题与答案 | 冻结真值、样本哈希、差异/准确率报告；敏感原文不进入 Git |
| `EXTERNAL_RESOURCE_NEEDED` | 目标服务器、域名、registry、正式 secret、真实 Staging、备份存储、告警、外部 Provider 和独立审计 | 目标环境 release manifest、TLS/readiness/smoke、恢复/回退记录、审计报告 |
| `OWNER_UAT_VERIFIED` 尚未达到 | 最终 UAT 和有限试运行决定 | 项目负责人亲自执行用例、确认已知限制和试运行范围；不需要多角色签字 |

跨来源重复当前仍依赖人工复核，不得描述为已经自动解决。真实 Staging 未启动前，也不得把 Compose 静态校验写成部署成功。

## 角色与权限

| 角色 | 主要能力 | 明确限制 |
| --- | --- | --- |
| `employee` | 创建和查看自己的工单、上传附件、补充材料、催办 | 不访问数据中心或用户管理 |
| `finance` | 财务审核、项目/模板/字段/记录、Excel/OCR、财务日报、员工管理 | 不能自行授予高权限角色 |
| `reviewer` | 查看复核队列并执行复核 | 不访问数据中心和用户管理 |
| `boss` | 最终审批、只读经营数据、老板日报、AI 助手、员工管理 | 不直接改写已确认经营数据 |
| `admin` | 管理高权限账号和角色 | API only，尚无独立前端入口 |
| `auditor` | 读取保留期内的脱敏 AI 审计日志 | 不参与财务审批和用户管理 |

开发 seed 账号：

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `员工` / `employee` | `123456` | `employee` |
| `财务` / `finance` | `123456` | `finance` |
| `复核员` / `reviewer` | `123456` | `reviewer` |
| `老板` / `boss` | `123456` | `boss` |
| `admin` | `123456` | `admin` |
| `auditor` | `123456` | `auditor` |

这些账号只用于开发和测试。生产环境不得执行开发 seed，也不得继续使用默认密码。

## 系统架构

```text
Browser / React
       |
       v
TLS Gateway / Nginx
       |
       +--> NestJS API ------> PostgreSQL
       |         |                  |
       |         +--> Redis         +--> audit_logs / ledger_events
       |         +--> S3/MinIO
       |         +--> ClamAV
       |
       +--> NestJS Worker ---> Excel / OCR durable jobs
                              |
                              +--> PaddleOCR-VL
                              +--> Qwen text / VL / embedding

Observability: Prometheus + Loki + Tempo
```

本地开发可用单进程 API 和本地文件存储。生产配置中的全局请求限流、登录限流、上传准入和模型并发/排队均使用 Redis 共享原子控制；AI、OCR 与推理型健康探针共享同一部署预算。提供的 Staging Compose 仍固定为单 API、单 Worker，只有在 H13 指定目标服务器并完成多实例 release、故障、恢复与回退实测后才能横向扩容。

## 技术栈

前端：

- React 18、TypeScript、Vite
- Ant Design、Zustand、React Router、dayjs
- Playwright

后端：

- Node.js 24.18.x、NestJS 11、TypeScript
- PostgreSQL、Prisma 6
- JWT、HttpOnly Cookie、CSRF、class-validator、Swagger/OpenAPI
- Redis、S3-compatible storage、ClamAV
- Prometheus、Loki、Tempo、W3C trace context

AI/OCR：

- 默认结构化 Mock Provider，不需要 GPU 或外部 API Key
- OpenAI-compatible text Provider
- Qwen3-14B-AWQ、Qwen3-VL-8B-Instruct、Qwen3-Embedding-8B
- PaddleOCR-VL

## 本地启动

### 前置条件

- Node.js 24.18.x（与 `.node-version`、CI 和部署镜像一致）
- npm
- PostgreSQL
- Docker/WSL2/GPU 仅在运行本地模型或完整依赖时需要

### 前端 Mock 模式

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

根目录 `.env.local` 使用：

```env
VITE_APP_DATA_MODE=mock
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_API_TIMEOUT_MS=15000
```

访问：`http://127.0.0.1:5173`

### 后端与数据库

```bash
cd backend
npm ci
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run dev
```

Windows PowerShell 可用 `Copy-Item .env.example .env` 替代 `cp`。启动前必须在本地 `.env` 中配置 `DATABASE_URL`、高熵 `JWT_SECRET`、`PORT` 和 `CORS_ORIGINS`。不要提交 `.env`。

- API：`http://127.0.0.1:3001/api`
- Swagger：`http://127.0.0.1:3001/api/docs`
- Health：`http://127.0.0.1:3001/api/health`
- Liveness：`http://127.0.0.1:3001/api/health/live`
- Readiness：`http://127.0.0.1:3001/api/health/ready`

### 前端 API 模式

```env
VITE_APP_DATA_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_API_TIMEOUT_MS=15000
```

API 模式请求失败时不会静默回退到 Mock。

## API 模块

所有成功和失败响应使用统一 envelope：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

| 模块 | 主要路径 |
| --- | --- |
| Health/metrics | `/api/health*`、`/api/metrics` |
| Auth/users | `/api/auth/*`、`/api/users/*` |
| Projects/templates/fields | `/api/projects/*`、`/api/templates/*`、`/api/fields/*` |
| Records | `/api/records/*`、`/api/projects/:id/records` |
| Work orders | `/api/work-orders/*`、`/api/work-orders/summary` |
| Files/notifications | `/api/files/*`、`/api/notifications/*` |
| Rules/reports | `/api/risk-rules/*`、`/api/reports/*`、`/api/reports/snapshots/*` |
| Boss AI | `/api/ai/chat`、`/api/ai/conversations/*`、`/api/ai/call-logs/*`、`/api/ai/report-snapshots/:id/narrative` |
| Excel | `/api/import-tasks/*`、`/api/field-suggestions/*` |
| OCR | `/api/ocr-tasks/*` |
| Model runtime | `/api/model-runtime/deployments`、`/routes`、`/health` |
| Retention inventory | `/api/retention/classes`、`/runs`、`/legal-holds` |

完整字段、状态码和权限以 Swagger 与后端 DTO/Guard 为准。

## 测试与验收

安装和构建：

```bash
npm ci
npm ci --prefix backend
npm run build
npm run build --prefix backend
```

前端构建必须显式设置 `VITE_APP_DATA_MODE` 和 `VITE_API_BASE_URL`。本地可复制 `.env.example` 为 `.env.local`；Staging/CI 固定使用 `api` 与 `/api`，缺失或非法值会让构建失败。

核心自动化：

```bash
npm test --prefix backend
npm run test:runtime
npm run test:integration --prefix backend
npm run test:e2e
npm run staging:frontend:check
npm run check:hygiene
npm run db:migration-paths --prefix backend
```

生产依赖审计：

```bash
npm audit --omit=dev --audit-level=high
npm audit --prefix backend --omit=dev --audit-level=high
```

集成和 E2E 必须使用数据库名以 `_test` 结尾的专用 PostgreSQL。集成启动器在确认后缀后重建专用测试库，避免大表反复插入/删除造成跨运行索引膨胀；测试准备、seed、清理和 restore 脚本都会拒绝非测试库，禁止通过修改保护逻辑在开发库或生产库运行破坏性测试。

## 本地模型

默认 Mock 模式不需要下载模型。使用本地模型时，预期策略为文本模型和 OCR 常驻，VL 与 Embedding 按需切换：

```bash
npm run model:check:all
npm run model:resident
npm run model:status
npm run model:on-demand -- vl
npm run model:restore
```

已完成的真实 GPU 证据包括：

- 四套模型资产完整性检查通过。
- 文本模型重启约 123.4 秒，VL 切换约 176.7 秒，文本恢复约 141.0 秒。
- 切换期间 OCR `/ready` 采样 432 次，失败 0 次。
- 最终文本与 OCR 恢复常驻；VL/Embedding 停止，未观察到 OOM。
- 文本与 OCR 并发请求均返回 HTTP 200。
- 2026-07-21 L0 刷新中，文本/OCR 已连续健康 3 天；Qwen 合成推理、Paddle 合成 PDF、未授权 401、镜像内 Python contract 8/8 再次通过，且没有切换或重启服务。

这些结果证明运行时控制和恢复链路，不代表 OCR 字段准确率或老板 AI 业务正确率已经通过真实样本和 owner UAT。

## Staging 与发布

```bash
npm run staging:init
npm run staging:check
npm run staging:release
```

`staging:init` 只在被 Git 忽略的目录生成随机 secret、CA 和证书。`staging:release` 要求干净工作树，并在启动候选服务前完成配置、镜像锁、SBOM/CVE、migration ledger 和 release plan 门禁，再执行权限、TLS/browser smoke、关联备份恢复与最终 manifest。已有 `.env` 不会被自动覆盖；旧镜像配置会失败关闭。

当前已完成：

- 18 服务 Compose 拓扑和静态安全断言。
- API/Worker 分离、Redis、MinIO、ClamAV、PostgreSQL TLS 和 Prometheus/Loki/Tempo/Alloy 可观测性链路。
- migrator/runtime/backup 数据库账号分离；runtime 不能更新或删除 audit/ledger。
- 应用回退、数据恢复和模型回退脚本及人工确认边界。
- 第三方构建输入已固定 digest；本机 22 镜像已锁定身份并生成 66 份 SBOM/扫描证据，发布/回退的配置、migration 和运行容器身份可自校验。
- 本机隔离 18 服务真实 `up`，Node smoke、浏览器 API/CSP smoke 和合成项目写读软归档通过；测试容器与卷已全部删除。
- 前端镜像只接受显式 `api`，构建后校验 `runtime-config.json`；Nginx CSP 阻断内联脚本、外部连接和外部 frame。

当前未完成：

- H13 指定的 Linux 服务器、域名、受控 registry、正式 secret 和监控接收人。
- 目标环境的 Alloy 日志采集、WAL archive、对象生命周期、告警送达和完整 release/rollback smoke。
- 真实备份/对象恢复、RPO/RTO、应用/数据/模型 rollback 和独立审计。

按 [`docs/B8_09_STAGING_RUNBOOK.md`](docs/B8_09_STAGING_RUNBOOK.md) 在获批目标环境重新运行 `npm run staging:release`，不得用本机隔离 smoke 替代 restore 或 rollback drill。

## 目录结构

```text
.
|-- src/                    # React 前端、路由、页面、store、API repository
|-- backend/
|   |-- src/                # NestJS API、Worker 和业务模块
|   |-- prisma/             # Schema、43 条 migration 和 seed
|   |-- scripts/            # 集成、数据、模型、UAT 与数据库工具
|   `-- test/               # 单元和 PostgreSQL 集成测试
|-- e2e/                    # Playwright 真实 API/Mock 验收
|-- deploy/
|   |-- model-services/     # 本地模型 Compose、锁和运行脚本
|   `-- staging/            # 18 服务 Staging、TLS、观测、备份和回退
|-- docs/
|   |-- 汇报/              # 阶段报告、审计、验收证据和收口材料
|   |-- 计划/              # 执行计划、检查清单和准备材料
|   |-- commit-reviews/    # 逐提交审查记录
|   `-- owner-input/       # 项目负责人决定和开放问题
`-- .github/workflows/      # Build/acceptance 与 CodeQL
```

模型权重、真实业务数据、`.realdata-test/`、上传目录、测试录像、`.env`、secret、证书和本地报告均不得提交。

## 关键文档

| 文档 | 用途 |
| --- | --- |
| [`docs/汇报/README.md`](docs/汇报/README.md) | 阶段报告、审计、验收与收口材料总索引 |
| [`docs/计划/README.md`](docs/计划/README.md) | 执行计划、检查清单与准备材料总索引 |
| [`docs/汇报/IMPLEMENTATION_PROGRESS.md`](docs/汇报/IMPLEMENTATION_PROGRESS.md) | 分阶段实现记录 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 系统架构与边界 |
| [`docs/汇报/RELEASE_CANDIDATE_AUDIT.md`](docs/汇报/RELEASE_CANDIDATE_AUDIT.md) | RC 问题、修复和发布判断 |
| [`docs/汇报/B8_OVERNIGHT_EXECUTION_REPORT.md`](docs/汇报/B8_OVERNIGHT_EXECUTION_REPORT.md) | B8-09 与 RC-00 至 RC-04 执行证据 |
| [`docs/汇报/B8_BLOCKER_MATRIX.md`](docs/汇报/B8_BLOCKER_MATRIX.md) | P0/P1、外部阻断和人工门禁 |
| [`docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md`](docs/汇报/M5_1_OCR_APPROVAL_COMMIT_REPORT_2026-07-20.md) | OCR 双人批准、不可变快照与事务入账验收 |
| [`docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md`](docs/汇报/M5_2_EXCEL_APPROVAL_COMMIT_REPORT_2026-07-20.md) | Excel 每行明细、整批失败关闭、双人批准与容量验收 |
| [`docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md`](docs/汇报/P0_EXCEL_STAGING_INTEGRITY_CLOSURE_2026-07-21.md) | Excel 未发布隔离、内容完整性、原子发布攻击回归与当前 P0 结论 |
| [`docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md`](docs/汇报/M6_REPORT_SNAPSHOT_GROUNDING_REPORT_2026-07-20.md) | 不可变报告快照、分币种 Decimal 与 AI Claim grounding 验收 |
| [`docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md`](docs/汇报/M7_ATTACK_RESOURCE_PROVIDER_ACCEPTANCE_2026-07-20.md) | 攻击、并发、资源预算、Provider 降级与模型健康联合验收 |
| [`docs/汇报/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md`](docs/汇报/M8_FINAL_EVIDENCE_AND_DRAFT_PR_HANDOFF_2026-07-20.md) | M0-M8 最终状态、测试、迁移、H 门禁和 Draft PR 交接 |
| [`docs/汇报/M8_1_NGINX_CI_SECURITY_REFRESH_2026-07-20.md`](docs/汇报/M8_1_NGINX_CI_SECURITY_REFRESH_2026-07-20.md) | GitHub Critical 门禁根因、Nginx 固定镜像升级和本地等价扫描证据 |
| [`docs/汇报/R9_1_SHARED_LOGIN_RATE_LIMIT_REPORT_2026-07-21.md`](docs/汇报/R9_1_SHARED_LOGIN_RATE_LIMIT_REPORT_2026-07-21.md) | 多实例登录限流、Redis 原子性、故障关闭和本地验收证据 |
| [`docs/汇报/R9_1A_XLSX_SHARED_STRING_HARDENING_REPORT_2026-07-21.md`](docs/汇报/R9_1A_XLSX_SHARED_STRING_HARDENING_REPORT_2026-07-21.md) | XLSX shared-string 确定性预加载、失败关闭与压力复现证据 |
| [`docs/汇报/R9_2_SHARED_UPLOAD_ADMISSION_REPORT_2026-07-21.md`](docs/汇报/R9_2_SHARED_UPLOAD_ADMISSION_REPORT_2026-07-21.md) | 多实例上传并发、在途字节、速率租约和故障关闭证据 |
| [`docs/汇报/R9_3_SHARED_MODEL_EXECUTION_GATE_REPORT_2026-07-21.md`](docs/汇报/R9_3_SHARED_MODEL_EXECUTION_GATE_REPORT_2026-07-21.md) | AI/OCR 共享 FIFO 执行门、租约恢复、等待边界和 Provider 中止证据 |
| [`docs/汇报/R9_3A_IMPORT_CONFIRMATION_TRANSIENT_RECOVERY_REPORT_2026-07-21.md`](docs/汇报/R9_3A_IMPORT_CONFIRMATION_TRANSIENT_RECOVERY_REPORT_2026-07-21.md) | 大批量确认事务超时、写冲突恢复与单次发布证据 |
| [`docs/汇报/R10_LOCAL_MODEL_L0_ACCEPTANCE_REPORT_2026-07-21.md`](docs/汇报/R10_LOCAL_MODEL_L0_ACCEPTANCE_REPORT_2026-07-21.md) | 本地 Qwen/Paddle 合成推理、鉴权、资产与容器内契约验收 |
| [`docs/FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md`](docs/FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md) | 项目负责人填写的功能、业务与风险决策问卷 |
| [`docs/owner-input/OWNER_DECISIONS.md`](docs/owner-input/OWNER_DECISIONS.md) | 当前项目负责人已确认的产品决定与安全默认 |
| [`docs/owner-input/OPEN_QUESTIONS.md`](docs/owner-input/OPEN_QUESTIONS.md) | 当前最多十个待负责人选择的功能口径 |
| [`docs/汇报/R8_9_CI_SBOM_ENTITLEMENT_HARDENING_REPORT_2026-07-20.md`](docs/汇报/R8_9_CI_SBOM_ENTITLEMENT_HARDENING_REPORT_2026-07-20.md) | R8.9 Scout entitlement 根因、Syft 修复和验收证据 |
| [`docs/PR4_REVIEW_GUIDE.md`](docs/PR4_REVIEW_GUIDE.md) | 独立 reviewer 检查顺序 |
| [`docs/B8_08_FINANCE_UAT_RUNBOOK.md`](docs/B8_08_FINANCE_UAT_RUNBOOK.md) | 财务八场景 UAT |
| [`docs/B8_09_STAGING_RUNBOOK.md`](docs/B8_09_STAGING_RUNBOOK.md) | Staging 发布、恢复和回退 |
| [`docs/汇报/R4_BACKUP_RESTORE_INTEGRITY_REPORT_2026-07-18.md`](docs/汇报/R4_BACKUP_RESTORE_INTEGRITY_REPORT_2026-07-18.md) | R4 强哈希备份、隔离恢复与故障注入证据 |
| [`docs/计划/B8_09_PILOT_DAILY_CHECKLIST.md`](docs/计划/B8_09_PILOT_DAILY_CHECKLIST.md) | 有限试运行每日检查 |
| [`docs/MODEL_DEPLOYMENT.md`](docs/MODEL_DEPLOYMENT.md) | 本地模型部署和常驻/按需策略 |
| [`docs/E2E_ACCEPTANCE.md`](docs/E2E_ACCEPTANCE.md) | 浏览器验收范围和失败诊断 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 安全边界与运行要求 |

## 项目负责人最短输入顺序

1. 在 [`docs/owner-input/OPEN_QUESTIONS.md`](docs/owner-input/OPEN_QUESTIONS.md) 回答当前最多十个功能口径；不需要填写姓名、角色、日期或多方签字。
2. 提供少量授权/脱敏样例：汇总行、重复正反例、报销附件、逐分对账和老板标准问题；敏感原文不提交 Git。
3. 准备 17 份 OCR 标签并冻结 5 份盲测，金额、日期、项目/客户作为关键字段。
4. 准备目标云资源、RPO/RTO、Provider 白名单与外部审计服务；缺失时系统继续失败关闭或仅 dry-run。
5. Codex 继续所有不依赖上述输入的工程实现与合成验收；项目负责人最终亲自完成 owner UAT。

任何一项未满足时，系统只能用于隔离开发、工程验收或人工辅助，不得用于无人监督的正式财务入账。

## 发布边界

只有同时满足以下条件，才能讨论有限试运行：

- 真实 Staging 容器全部启动并通过 TLS/readiness/smoke。
- 真实 PostgreSQL 与对象存储备份恢复、RPO/RTO 和 rollback 演练通过。
- 财务逐分对账完成，差异为 0 或全部形成已关闭的问题单。
- OCR 标签和盲测冻结，准确率、拒识率和人工复核阈值由授权人员确认。
- 老板 AI 标准问题、数据来源和外部数据政策验收通过。
- 跨来源重复、负数、冲销、更正、作废和关账规则已由 owner 确认且真实样例通过。
- 独立代码/安全 Review 完成，项目负责人 UAT 达到 `OWNER_UAT_VERIFIED`。

即使所有自动化测试和 GitHub CI 全绿，也不能宣布“已经生产就绪”。在真实 Staging、恢复演练、独立安全复核、财务真值、OCR/AI 真值和 owner UAT 全部完成前，发布状态保持 `SAFE_DEFAULT_ACTIVE`、`REAL_SAMPLE_NEEDED` 或 `EXTERNAL_RESOURCE_NEEDED`。

# 财务 Agent 实施进度

更新日期：2026-07-15
执行基准：`docs/财务Agent_真实化与阶段9-10推进总提示词.md`
当前分支：`agent/real-business-data-validation`
当前批次：真实业务数据 B0-B6 已完成，B7 财务 UAT 与最终回归进行中

## 完成口径

- “后端已实现”只表示接口和服务代码存在，不等于真实闭环完成。
- “真实闭环完成”必须同时具备真实 PostgreSQL、真实 API、后端权限、错误处理和自动化测试证据。
- `api` 模式失败时不得静默回退到 Mock；Mock 只能由显式环境变量启用。
- 本文件在每个执行批次结束后更新。

## 真实业务数据 B0/B1/B2 结论

2026-07-14 已对 Git 忽略的本地 `数据文件/` 完成只读 B0 扫描：112/112 个物理文件均建立匿名分类，扫描前后 SHA-256 一致，公开报告不含原始路径、文件名、完整哈希或业务值。聚合报告见 `docs/REAL_BUSINESS_DATA_TEST_REPORT.md`，原始映射只保存在被忽略的 `.realdata-test/`。

已实现和验证：

- 新增可复用 B0 扫描器和 CLI，覆盖格式签名、哈希重复组、XLSX Sheet/隐藏/公式/合并/媒体、PDF 页数、图片尺寸、DOCX 表格和 ZIP 条目镜像。
- 34 份 XLSX 共 298 个 Sheet；23 份为多 Sheet、22 份有多个非空 Sheet、30 份含合并单元格、29 份含公式、10 份含 998 个内嵌媒体对象。
- 发现 6 组独立文件完全重复，以及 ZIP 中 46 个与散文件完全一致的条目；当前只提示与验证幂等，不自动判断业务近似重复。
- B1 基线发现 PNG 结束块偏移、手机 JPEG 尾部元数据和 PDF 压缩流关键字导致误拒绝；已改为 PNG chunk/CRC、JPEG 结构与有限厂商尾部、PDF 对象语义校验，并保留 polyglot、脚本、Launch、嵌入文件和 Office 外链门禁。
- 修复后 `FileSecurityService` 接受 102 份当前支持格式；10 份按策略拒绝，其中 4 份 ZIP、6 份含外链/嵌入对象的 XLSX。另有 1 份 35 页 PDF 超过当前 OCR 20 页限制，进入拆分/页范围适配队列。
- B2 第一切片已新增授权工作簿检查接口、完整 Sheet 目录、隐藏状态、公式/合并统计、候选表头、显式 Sheet 与连续 1-3 行表头选择；多行合并表头按“分组 / 子字段”展开，隐藏 Sheet 默认拒绝且必须二次确认。
- 多表缺少选择时返回统一 400，任务和干净原文件恢复为 `uploaded`；检查与解析均写 audit/ledger。标准单表仍自动进入映射，API/Mock 前端均兼容。
- B2 公式政策已落地：默认不执行公式也不使用缓存；仅在财务显式勾选后接受日期或有限标量缓存结果，公式原文保留在 `ImportRow.rawData`，警告进入确认预览，选择同步写 audit/ledger；缺失、Excel 错误或非标量缓存继续拒绝。
- 数据区合并单元格只保留主单元格值，每个受影响行标记“确认前必须复核”；非主单元格保持空值，最终是否可入库由模板必填字段校验决定，不自动填充或复制。
- XLSX 有效边界不再误用 ExcelJS 的“非空行/列数量”：中间空行、空列后的真实尾部数据会被保留，只有样式或图片锚点的尾部单元格不会伪造字段和记录；由此找回旧路径漏掉的 9 行，并让 1 份首行留空样本进入明确的公式人工处理，而非静默跳过。
- 压缩文件大于 10 MiB 或含内嵌媒体时启用流式行读取。媒体只统计数量与展开大小，不进入单元格值或工作簿对象；共享公式由 OOXML 元数据还原并保留来源，不执行公式。已防护 ExcelJS 多工作表延迟读取竞态。
- 对 26 份小于等于 10 MiB 的安全匿名 XLSX 完成 512 MiB 堆限制复测：26/26 检查和解析通过，共 4087 行，显式允许缓存后为 3933 pending / 144 error / 10 ignored，1677 行公式和 1738 行合并数据保留人工复核警告，重复运行峰值 RSS 为 284.82-315.66 MiB。
- 19.67 MiB 多工作表样本与 46.35 MiB、含 28 个约 46.24 MiB 媒体对象的样本均通过检查和解析；分别解析 33/32 行，重复运行峰值 RSS 为 191.07-192.07 / 202.90-204.54 MiB，媒体未混入字段值。
- 新增仅供后台 worker 使用的强制流式批次接口，默认每批 500 行、硬上限 50,000 行；同步解析接口继续保持 5,000 行上限。4999/5000/5001/30196 行合成档位分别以 10/10/11/61 批完成，30,196 行约 617 ms、峰值 RSS 217.90 MiB，0 错误且生成文件哈希不变。
- 超过 5,000 行自动进入后台流式任务：解析配置、执行模式、进度、尝试次数和租约持久化；每 500 行事务写入并 heartbeat。取消清除半成品，过期 lease 从第 0 行重放，旧 worker 由令牌隔离，连续三次中断后停止自动恢复并写 audit/ledger。
- 真实 PostgreSQL 已验证 5,001 行取消后 0 残留、活动旧 worker 与新 lease 并存恢复后 5,001 个唯一行号/哈希，以及 30,196 行 61 批无重复无漏行；以上任务确认前 `BusinessRecord` 均为 0。前端任务列表和映射页可轮询查看进度并取消。
- 全量回归后的 B0 复扫仍为 112/112 份样本，和初始本地清单相比 0 新增、0 缺失、0 SHA-256/大小变化；复扫明细继续只保存在 Git 忽略目录。
- 15 份 `.xls` 已全部通过受限子进程转换和现有解析器：45 个 Sheet、9 个隐藏 Sheet、19,738 个有效输出单元格、2,351 个公式和 224 个合并区域往返计数一致；原文件 0 哈希变化。转换结果只存在内存，VBA、嵌入对象、外部引用和加密内容失败关闭。
- B2 已收口：第一版明确不开放超过 50 MiB 的独立通道。50 MiB 为含边界硬上限，Multer 与 `FilesService` 共用动态配置；真实 multipart 已验证上限下和恰好上限成功、上限加 1 字节返回统一 `41301`，且不残留数据库记录或隔离文件。文件服务仍会持有上限内的压缩 Buffer。

当前自动化证据：16/16 Prisma migrations；15/15 Jest suites、95/95 tests；29/29 真实 PostgreSQL；14/14 Playwright；前后端 build。以上只证明结构、安全和业务回归，真实 PaddleOCR/Qwen 推理准确率仍未验收。

## 真实业务数据 B3/B4/B5 结论

- B3：Qwen3-14B-AWQ 与 PaddleOCR-VL 已在 RTX 5090 上常驻；30 分钟共 61 次采样全部健康，容器无重启、OOM 或 fatal，显存峰值 28,911 MiB、最低空闲 3,277 MiB。35 页 PDF 已按 1-20 / 21-35 页范围完整覆盖且原件哈希不变。
- B3 准确率：17 份匿名 OCR 评估样本已准备，校准 10/10、验证 2/2 Provider 调用通过；5 份盲测保留。因人工字段标签尚未复核，准确率门禁标记 `awaiting_labels`，发布模式为人工辅助，不宣称自动 OCR 达标。
- B4：Excel、OCR、手工和工单四类来源统一写入模板、来源、确认快照；模板和经营记录增加 `actual/reconciliation/budget` 数据层，数据层只由后端模板推导。报表、风险趋势和 AI 工具只统计 confirmed `actual`，对账/预算记录可查询但不重复计入实绩。
- B4：18 个 migration 已部署到测试库；Decimal、日期边界、草稿/确认/作废、并发确认、audit、ledger 与四来源快照通过 29/29 PostgreSQL 集成测试。L3 会计真值仍等待财务抽样签字。
- B5：建立 72 条匿名老板问题，覆盖日/周/月、指定月份、上月、项目、排行、成本结构、环比/同比、异常、工单、空数据、权限和 Prompt Injection。工具选择、有效回答数字、空数据、注入和输出 Schema 均为 100%。
- B5：真实 Qwen 72 次请求 0 Provider 错误，P50 433 ms、P95 1,038 ms、最大 1,254 ms。原始模型仅 26.39% 直接通过严格 grounding；53 次由后端安全降级，其中 44 次包含工具外数字、5 次未引用结构化数字、3 次回显敏感指令词、1 次未说明无数据。因此当前明确采用“Qwen 理解 + 数字溯源 + 受控结构化 fallback”，模型不得自由生成财务数字。
- B6：后端重启和数据库 TCP 代理短断恢复通过；ClamAV 离线 503、磁盘低水位 507、lease 接管与 1/3/5 并发通过。Qwen 文本重启、VL 切换、文本恢复期间 272 次 OCR 健康采样 0 失败，最终文本/OCR 同时真实推理均为 200，0 OOM、0 自动重启。
- B6：修复 E2E teardown 错用通用 `UPLOAD_DIR` 且空库提前返回的问题，清理 50 个历史孤儿测试文件；专用 E2E 目录限制在 `backend/test-uploads` 子目录。
- 当前回归：17/17 Jest suites、183/183 tests、30/30 PostgreSQL integration、后端 production build 全部通过；B7 将运行前端、Playwright、hygiene 和依赖全量门禁。

## PR #2 审计修复结论

2026-07-14 已按审计报告完成除用户明确暂缓项之外的 P1/P2/P3 修复，并通过最终自动化回归。核心变化包括会计方向与主字段、Decimal 字符串契约、经营记录/工单并发锁和提交快照、不可变模板版本、文件 fail-closed 与 ClamAV 门禁、导入/OCR lease、原子 OCR 上传、AI 历史和输出边界、异常处置、Cookie/CSRF、真实项目结构页、路由拆包及 CI 供应链加固。

明确暂缓：

- P1-07：不同 Excel 上传、OCR 任务和手工重试之间的业务级去重与统一幂等政策。

P1-08 已于 2026-07-14 完成：5,000 行同步边界、50,000 行后台硬上限、500 行批次、进度、heartbeat、取消、租约接管、三次恢复上限和 30,196 行真实数据库门禁均已实现。

当前自动化证据：16/16 Prisma migrations；15/15 Jest suites、94/94 tests；28/28 真实 PostgreSQL；14/14 Playwright；前后端 build；根目录与后端 `npm audit` 均为 0 vulnerabilities。四套本地模型资产均完整，但真实 GPU 推理仍未验收。

## 当前状态矩阵

| 模块 | 前端 | 后端 | 数据库 | 测试 | 数据来源 | 当前结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 登录/用户 | 统一 HTTP client；显式 Mock/API；真实 login/me/logout 和分页用户管理；无密码持久化 | JWT、bcrypt、tokenVersion、真实 logout、限流、认证审计、boss 边界和软删除 | `users`、`audit_logs` 已通过第 9 个迁移升级并在 dev/test 验证 | 34 个普通测试、17 个真实 PostgreSQL 集成测试中的认证权限用例、浏览器网络验收 | 显式 Mock/API | 批次 B 真实闭环完成 |
| 项目 | 显式 Mock/API Repository；真实分页、搜索、详情、创建、编辑、归档、项目模板目录及结构记录 | 项目 CRUD、结构、汇总、审计和角色限制；汇总只计 confirmed；归档项目拒绝关系写入 | `projects`、`project_templates` 已在 dev/test PostgreSQL 验证 | 普通测试、15 个真实集成测试中的项目/关系权限审计用例、API/Mock 浏览器验收 | 显式 Mock/API | CRUD、ProjectTemplate 与结构聚合真实闭环 |
| 模板 | 显式 Mock/API Repository；分页、筛选、详情、创建、编辑、克隆、删除 | CRUD/clone、系统/引用删除保护、审计和 finance-only 权限 | `templates` 与克隆关系已在 dev/test PostgreSQL 验证 | 普通测试、11 个真实集成测试中的模板用例、浏览器 CRUD | 显式 Mock/API | 模板主表真实闭环完成 |
| 字段/模板字段 | 显式 Mock/API Repository；真实分页筛选、CRUD/停用、usage、模板字段增改排序移除；相关页面具备 loading/error/empty | finance-only 字段字典管理；boss 仅可读取项目已启用模板字段；严格 DTO、停用保护、连续排序、类型变更保护及审计 | `field_definitions`、`template_fields` 已在 dev/test PostgreSQL 验证 | 32 个普通测试、13 个真实集成测试中的字段不变量用例、API/Mock 浏览器验收 | 显式 Mock/API | C-3 真实闭环完成 |
| 业务记录/手工补录 | 显式 Mock/API Repository；真实创建、分页筛选、详情、编辑、确认、软作废和项目结构记录 | 动态值类型与必填校验、草稿边界、来源/状态防伪、状态专用动作、幂等、归档保护、审计和 ledger | `business_records`、`record_values`、`ledger_events` 已在 dev/test PostgreSQL 验证 | 32 个普通测试、15 个真实集成测试、API/Mock 浏览器完整补录验收 | 显式 Mock/API | C-5 与 C-6 真实闭环完成 |
| 工单/审批 | 显式 Mock/API Repository；真实分页、筛选、详情、草稿、提交、补充、各角色审核、规则/AI 复核、催办和终审归档 | 唯一状态机、角色资源范围、提交完整校验、死路恢复、并发状态保护、终审幂等事务和审计 | 工单、附件、时间线、审批及第 10 个迁移已在 dev/test PostgreSQL 验证 | 32 个普通测试、16 个真实 PostgreSQL 集成测试、API/Mock 全流程浏览器验收 | 显式 Mock/API | C-7 真实闭环完成 |
| 文件 | 显式 Mock/API Repository；工单与手工补录真实上传，元数据、预览、下载、作废及记录详情已接通 | 私有隔离区、SHA-256、结构解析、fail-closed 扫描、ClamAV 生产门禁、流式读写、配额/磁盘水位、角色与状态授权 | `raw_files`、附件关系已在 dev/test PostgreSQL 验证；上传目录与测试目录均忽略 | 文件攻击单测、真实 PostgreSQL 和 API/Mock 浏览器验收 | 显式 Mock/API | 本地文件闭环完成；对象存储和目标环境 ClamAV/备份待部署 |
| 通知 | 显式 Mock/API Repository；服务端分页、未读数、单条/全部已读、轮询和工作流跳转已接通 | 按 JWT 用户隔离目标用户/角色通知；用户级已读收据、幂等审计和参数校验 | `notifications`、`notification_receipts` 已通过第 11 个 migration 在 dev/test PostgreSQL 验证 | 34 个普通测试、18 个真实 PostgreSQL 集成测试中的通知隔离用例、API/Mock/移动端浏览器验收 | 显式 Mock/API | C-9 真实闭环完成 |
| 报表 | 显式 Mock/API Repository；财务日/周/月、老板日/周/月、老板首页和项目月报概览已接通 | 仅聚合 confirmed BusinessRecord；Decimal 金额、北京时间边界、分类、异常、排行及四角色权限 | 复用真实经营记录、审批和异常表；第一版实时聚合不新增报表快照表 | 35 个普通测试、19 个真实 PostgreSQL 集成测试中的固定数据/边界/AI 一致性用例、API/Mock/移动端浏览器验收 | 显式 Mock/API | C-10 真实闭环完成；历史快照未实现 |
| Excel | 显式 Mock/API Repository、真实上传、Sheet/表头/公式缓存选择、媒体隔离提示、后台进度/取消、任务列表、列映射、字段建议、错误预览和确认页 | 工作簿检查、多 Sheet/隐藏 Sheet门禁、合并表头、共享公式、媒体隔离；5000 行同步边界，5001-50000 行后台分批；旧 `.xls` 受限子进程转换；50 MiB 含边界上限 | ImportTask/Sheet/Column/Row、Profile/Decision/Suggestion；第 16 个 migration 新增后台配置、执行模式、进度和恢复字段 | 15 份 XLS、5001/30196 行和精确上传边界门禁通过 | API 模式读取真实文件；Mock 模式显式可选 | B2 XLS/XLSX 主闭环完成；超过 50 MiB 明确返回 413 |
| OCR | 显式 Mock/API Repository、票据上传、任务列表、页范围、原文/证据/置信度、人工纠错和确认页 | Mock/Local Paddle HTTP Provider、PDF 分段、任务状态机、重试、严格纠错、幂等确认 | 第 13 个 migration 新增 `ocr_tasks`、`ocr_attempts`、`ocr_corrections` 并关联原文件和生成记录 | 35 页分段、Provider 校准/验证及 30 分钟常驻通过 | PaddleOCR 常驻；未标注数据保持人工辅助 | 程序链与稳定性完成；字段准确率等待人工标签 |
| AI/模型运行时 | 显式 Mock/API 聊天；会话和消息分页；模型运行时通过受保护 API 查看部署、路由和健康 | 结构化工具、指定月份/同比环比、数字 grounding、受控 fallback、OpenAI-compatible、常驻/按需编排 | 模型部署、任务路由、会话消息和调用日志均持久化 | 72 条 Qwen 基准、177 个单测、29 个 PostgreSQL 集成测试通过 | Qwen 文本与 OCR 常驻，VL/Embedding 按需 | B5 有效回答通过；原始模型高 fallback，必须保留结构化降级 |
| E2E 验收 | Playwright 驱动 API/Mock 两套前端，覆盖四角色、完整审批、XLS/XLSX、OCR、数据中心、报表、错误与安全运行 | 专用测试启动脚本，统一错误、CORS、安全头和 readiness 可断言 | 独立 `_test` PostgreSQL 自动 migrate/seed，精确清理 E2E 工单、导入/OCR任务、记录与文件 | 95 个普通测试、29 个 PostgreSQL 集成测试、14 个 Playwright E2E | API 与 Mock 均有自动化证据 | 审计修复和真实数据 B0-B2 回归通过，GitHub CI job 已配置 |

## 只读审计结论

### 已确认存在

- 本地阶段 4 至阶段 8 提交完整存在，未按远程旧版本重复开发或覆盖。
- Prisma 金额字段使用 `Decimal`。
- 后端成功和异常采用统一 envelope。
- 主要业务接口使用 JWT 与角色守卫，员工工单范围由后端按 token 用户过滤。
- 老板审批生成经营记录使用事务、唯一来源约束和重复请求检查。
- 文件不使用原文件名作为磁盘路径，上传目录已被 Git 忽略。

### 高优先级风险

1. 已解决：已授权安装 PostgreSQL 17，本机服务 `postgresql-x64-17` 正常运行并监听 5432。
2. 已解决：JWT secret 无默认值，启动时校验数据库、JWT、端口和 AI Provider 配置。
3. 已解决：tokenVersion 使 logout、重置密码、停用和角色变化后的旧 Token 失效。
4. 已解决：finance 不能创建、提升或操作 boss，并保护最后一个有效 boss。
5. 已解决：用户删除改为软停用，保留审计与关联数据链。
6. 已解决：工单创建固定为草稿，提交时完整校验；财务要求补充可由员工追加真实附件后重提，复核退回可由财务继续处理。
7. 已解决：报表只聚合 `confirmed` 经营记录，草稿、待确认和作废记录均排除；金额使用 Decimal，时区固定为 `Asia/Shanghai`。
8. 已解决：真实 PostgreSQL 集成测试覆盖 migration、外键、唯一约束和事务回滚。
9. 已解决：认证、用户及 C-1 至 C-11 均已完成显式 Mock/API Repository 切换，API 模式失败不回退 Mock。
10. 已解决：请求具备 requestId、结构化访问/错误日志和认证审计，日志不读取请求体或凭据。
11. 已解决 Excel 与 OCR 的模型、状态机、人工确认和自动化测试；真实模型准确率与企业格式适配待用户脱敏样本。
12. 已按用户确认创建专用发布分支；提交和推送前继续排除模型、下载脚本、真实环境文件与用户原始文档。

## 用户资产边界

以下未跟踪内容视为用户资产，不覆盖、不删除、不移动，也不提交模型权重：

- `.vscode/`
- `docs/` 下用户提供的规划、接口、数据库和总提示词文档
- `backend/财务Agent_真实化与阶段9-10推进总提示词.md`
- `download_models_modelscope.py`
- `model/`

## 基线验证

| 检查 | 结果 |
| --- | --- |
| 前端 `npm run build` | 通过；页面路由懒加载，最大业务共享块约 449 kB，Ant Design runtime 约 554 kB，无循环或体积警告 |
| 后端 `npm run build` | 通过 |
| 后端 `npm test -- --runInBand` | 15/15 suites，94/94 tests 通过 |
| `prisma validate` | 通过；schema 已执行官方 formatter |
| 真实 migration / seed | dev/test 两库均通过 15 个 migration 和 seed |
| 真实数据库集成 | 1/1 suite，28/28 tests 通过；包含财务精度、并发、Token、文件、XLS/XLSX、OCR、AI 和模型运行时边界 |
| 前端浏览器验收 | 14/14 Playwright 自动化通过；四角色登录、完整审批、标准/公式缓存 XLSX、旧 XLS、真实 PDF、数据中心/报表、错误与安全运行 |
| 后端 `npm run dev` | 使用 Node watch + ts-node 正常启动，`GET /api/health` 返回统一成功结构 |
| 模型资产与适配器 | 文本 9.31 GiB、OCR 2 GiB、VL 16.34 GiB、Embedding 14.11 GiB 全部通过；Docker/GPU 推理未启动 |

## 批次进度

| 批次 | 状态 | 说明 |
| --- | --- | --- |
| 只读审计 | 完成 | 文档、README、Schema、8 个 migration、seed、全部测试、依赖和 Mock/API 边界已核对 |
| A 真实 PostgreSQL | 完成 | PostgreSQL 17、dev/test 隔离、8 个 migration、seed、结构核对和 5 个真实集成测试通过 |
| B 前端 API 基础与认证安全 | 完成 | 统一 client、显式双模式、真实认证/用户管理及后端安全加固通过验收 |
| C 模块真实 API 切换 | 完成 | C-1 至 C-11 已按固定顺序通过；API 失败不静默回退 Mock |
| D E2E | 完成 | 独立测试库、API/Mock 双模式、精确清理与 CI 已通过 |
| E Excel | 完成 | 合成真实 `.xlsx` 的解析、映射、错误反馈和幂等入库已通过 |
| F OCR | 完成 | Mock/Local Provider、PDF预检、纠错、重试和幂等入库均通过 |
| G 本地模型 Provider | 程序完成 | Provider、真实 DB 路由、资产校验、Paddle 适配器、常驻/按需编排已通过静态验收；实际容器启动待 WSL 2/Docker |
| H 工程化收尾 | 完成 | CI、安全运行、文档、依赖/仓库检查和 PR 准备均通过；远程操作待用户确认 |
| I 真实业务数据 | B0-B6 完成，B7 进行中 | 文件/Excel/OCR、经营记录、72 条 AI 基准、故障恢复、并发和真实模型切换已通过；下一步全量回归并交付财务 UAT，OCR 标签与 L3 财务真值保留外部签字 |

## 批次 A 验收报告

批次 A 已完成：

- `backend/.env` 与 `backend/.env.test` 分别指向 `_dev`、`_test` 数据库，使用不同随机 JWT secret，且均被 Git 忽略。
- `.env.example` 与 `.env.test.example` 已明确开发/测试配置。
- seed 在生产环境强制拒绝，并默认只允许 `_dev` / `_test` 数据库。
- 新增 `prisma:migrate:deploy`、`test:integration`、`db:verify`。
- 真实集成测试已覆盖八账号、错误密码、停用账号、事务回滚、唯一约束、外键和实际表清单。
- 普通测试 6/6 suites、22/22 tests 通过；后端 build 和完整 TypeScript 检查通过。
- PostgreSQL 17 Windows 服务已运行，5432 正常监听。
- `finance_agent_dev` 与 `finance_agent_test` 均为本项目新建专用数据库。
- 开发库和测试库分别在空库成功执行全部 8 个 migration 与 seed。
- `db:verify` 对比结果：24 张 Prisma 业务表全部存在，无缺失或意外表；另有 Prisma 自身迁移表。
- 实际数据库包含 16 个枚举、83 个索引和 33 个外键。
- `npm run test:integration`：1/1 suite、5/5 tests 通过。
- 当前批次是真实 PostgreSQL 实现，不是 Mock。

实际修改包括 `.gitignore`、环境变量示例、后端脚本、seed 安全限制、migration lock、真实集成测试、数据库验证脚本和本地启动文档。未新增业务 API。新增环境变量为 `NODE_ENV`、`TEST_DATABASE_URL`、`SEED_ALLOW_NONSTANDARD_DATABASE`。

执行过的核心命令：`prisma generate`、`prisma migrate deploy`、`prisma:seed`、`db:verify`、普通 Jest、真实 PostgreSQL Jest、后端 build 和 TypeScript noEmit 检查。

批次 A 结束时 Git 工作区包含本批新增/修改文件以及用户原有未跟踪文档、模型脚本和 `.vscode`；本地 `.env`、测试 `.env` 和模型目录均未进入 Git。

## 批次 B 验收报告

批次 B 已完成：

- 新增统一 HTTP client，支持 Bearer Token、统一 envelope、15 秒超时、网络/HTTP/业务/协议错误分类和 requestId。
- `VITE_APP_DATA_MODE` 只允许 `mock` / `api`；API 失败不会回退到 Mock。
- 登录、刷新恢复、退出和用户管理已连接真实后端；用户列表使用服务端分页。
- 前端公开用户类型不再包含 password；旧的明文用户 localStorage 会通过存储版本升级清除。
- 本地 `.env.local` 选择 API 模式且被 Git 忽略；根 `.env.example` 默认 Mock，便于无后端演示。
- 后端新增启动配置校验、tokenVersion、登录限流、认证审计、requestId、finance/boss 边界、最后 boss 保护和用户软删除。
- 浏览器 API 模式观察到 login、me、users、logout；退出后令牌从存储清除。
- 浏览器存储审计未发现明文密码；API 故障会显示真实网络错误和请求编号。
- Mock 模式在不可达 API 地址下独立工作，未发出 API 请求。
- 普通测试 7/7 suites、32/32 tests 通过；真实 PostgreSQL 集成测试 1/1 suite、9/9 tests 通过；前后端 build 通过。
- 开发库结构核对为 24 张业务表、16 个枚举、84 个索引、33 个外键，无缺失或意外业务表。

详细迁移状态见 `docs/API_MIGRATION_MATRIX.md`。

## C-1 Project 验收报告

- 项目列表、详情、创建、更新、软归档和汇总具备同构 Mock/HTTP Repository。
- `dataCenterStore` 只异步化项目域；模板、字段和记录没有越序重写。
- 项目管理页具备 loading、error、empty、关键词、状态筛选和服务端分页。
- 员工工单、手工补录、Excel 导入、数据记录和结构页的项目目录统一读取 Project Store。
- 后端项目 DTO 增加 trim 与长度约束，伪造 `createdBy` 被全局白名单校验拒绝。
- 项目汇总改为只统计 `confirmed` 经营记录。
- 真实 PostgreSQL 测试覆盖四角色权限、分页、归档可见性和 requestId 审计；集成测试总数为 10。
- finance 浏览器 CRUD 与刷新持久化、boss 只读、employee active 目录均通过。
- Mock 项目模式在不可达 API 地址下通过，未发出 API 请求。
- 项目结构页的模板、字段、关系和记录仍标记为未切换，待 C-2 至 C-5 完成后统一改用后端 structure。

## C-2 DataTemplate 验收报告

- 模板主表使用同构 Mock/HTTP Repository，Store 只异步化模板主表，未越序改写字段关系。
- 模板管理页具备 loading、error、empty、关键词、记录类型筛选和服务端分页。
- 创建、基础信息编辑、克隆和删除均等待服务端成功后提示。
- 所有模板消费者统一拉取真实模板目录；模板详情可以按 ID 刷新恢复。
- 后端禁止客户端伪造 `isSystem`，禁止删除系统模板及被项目/业务记录引用的模板。
- Prisma P2003 现在统一映射为 409，而不是泄漏为 500。
- 真实 PostgreSQL 测试覆盖四角色、分页筛选、trim、字段克隆、删除保护和 requestId 审计；总数为 11。
- API 浏览器 CRUD/clone 与 Mock 无后端模式均通过，测试模板已清理。

## C-3 FieldDefinition / TemplateField 验收报告

- 字段字典和模板字段关系使用同构 Mock/HTTP Repository；页面不再直接读取 `mockDataCenter`。
- 字段页支持真实分页、关键词、字段类型、语义类型和启停状态筛选，并具备 loading、error、empty、创建、编辑、使用范围和停用交互。
- 模板编辑、项目结构、手工补录、导入映射/确认和字段建议页面统一按需拉取真实字段或模板字段。
- 后端只接受严格 `true` / `false` 查询值；客户端不能伪造 `isActive`，停用字段不能加入模板。
- 模板字段插入、上移/下移和移除均在事务中维护从 1 开始的连续顺序；移除关系不删除字段定义。
- 已产生 `RecordValue` 的字段禁止修改 `fieldType`，避免历史值与字段类型失配。
- 所有字段创建、更新、停用和模板字段新增、更新、移除均写 actor、requestId 和前后摘要审计。
- 真实 PostgreSQL 测试覆盖四角色、严格布尔解析、字段键冲突、停用保护、排序、usage、类型变更保护及审计；集成测试总数为 12。
- API 浏览器完成字段创建/编辑/usage/停用、模板字段新增/必填/排序/刷新/移除，所有请求 2xx 且无页面异常；合成数据已清理。
- Mock 浏览器完成同一会话流程，主动拦截后端后请求数为 0。
- 后端 7/7 suites、32/32 tests、真实 PostgreSQL 12/12、前后端 build 全部通过；前端仍有既有的大于 500 kB bundle 警告。

## C-4 ProjectTemplate 验收报告

- 项目启用模板列表、新增、改名、停用和重新启用使用同构 Mock/HTTP Repository；关系不再从 localStorage 或静态 Mock 初始化。
- Store 按 `projectId` 合并关系结果，并让项目抽屉、项目结构、手工补录和 Excel 入口按需加载真实关系。
- 所有写操作等待服务端成功后才提示；停用使用二次确认，重新启用复用原关系 ID 并保留已有项目内名称。
- 客户端不能传 `isActive` 创建或普通 PATCH 绕过关系状态语义；项目归档后启用、改名和停用均返回 409。
- 重复启用返回 409 且不新增关系/审计；重复停用返回当前状态且不追加重复审计。
- boss 通过项目关系读取内嵌模板，并仅可读取已启用模板字段；不访问 finance-only 全量模板/字段接口，也没有修改入口。
- 真实 PostgreSQL 测试覆盖四角色、DTO 伪造、重复操作、停用/重新启用、归档边界和 requestId 审计；集成测试总数为 13。
- API 浏览器完成启用、刷新、改名、停用、重新启用、名称保留、手工补录目录和 boss 只读结构；所有请求 2xx、boss 无 403、页面无异常，合成数据已清理。
- Mock 浏览器完成同一会话关系流程和手工补录目录，主动拦截后端后请求数为 0。
- 后端 7/7 suites、32/32 tests、真实 PostgreSQL 13/13、前后端 build 全部通过；前端仍有既有的大于 500 kB bundle 警告。

## C-5 BusinessRecord / RecordValue 验收报告

- 记录列表、项目记录、详情、更新、确认和软作废使用同构 Mock/HTTP Repository；记录不再从 localStorage 或静态 Mock 初始化。
- 记录页使用服务端分页及项目、记录类型、来源、状态、日期筛选，具备 loading、error、empty 和真实详情动态字段值。
- finance 只能编辑 draft/pending_confirm；普通 PATCH 不能伪造记录类型或 confirmed/rejected 状态，confirmed/rejected 均不能再编辑。
- 确认和作废使用专用动作及二次确认；重复请求幂等，不重复写 audit_logs 或 ledger_events；作废保留记录和 RecordValue。
- 归档项目不能创建、修改、确认或作废业务记录；日期结束日按整天包含，反向日期区间返回 400。
- PostgreSQL 验证 money/date/text 分别落入 `value_number`、`value_date`、`value_text`，且列表、项目记录和 boss 详情读取一致。
- 金额 UI 从整数四舍五入修正为固定两位小数显示。
- 真实 PostgreSQL 测试覆盖四角色、分页筛选、动态值物理列、状态伪造、幂等、审计/ledger 和归档边界；集成测试总数为 14。
- API 浏览器完成筛选、详情、编辑、确认、作废、刷新、项目结构和 boss 只读；所有请求 2xx、无页面异常，合成数据已清理。
- Mock 浏览器完成同一记录生命周期和项目结构，主动拦截后端后请求数为 0。

## C-6 手工补录验收报告

- 手工补录页通过 `recordApi` 提交输入 DTO，不再在浏览器生成记录 ID、动态值 ID、创建人或确认人。
- 保存草稿允许动态必填字段暂缺；创建 `pending_confirm` 和执行确认时均由后端重新校验模板必填字段，不能绕过。
- “确认入库”严格执行创建待确认记录后调用专用 confirm 动作，客户端不能通过创建或 PATCH 伪造 `confirmed/rejected`。
- `sourceType` 和 `sourceId` 固定为 `manual`，`createdBy` 从 JWT 当前用户写入；字段 ID 必须属于项目已启用模板。
- DTO 和服务层限制 ID/文本长度、数组数量、金额两位精度；动态 money/number、date、file、text 分别校验真实类型、范围和长度。
- 真实 PostgreSQL 验证草稿补全、必填确认、无效日期、异常数值、对象型文本、来源/状态伪造、事务回滚、审计和 ledger；集成测试总数为 15。
- API 浏览器完成不完整草稿保存、完整记录创建与确认，并在项目结构页看到两条真实记录；全部相关请求 2xx，无页面异常，合成数据已清理。
- Mock 浏览器完成同样流程，页面明确显示 Mock，后端请求数为 0。
- 长项目名的结构汇总卡与移动端布局已修正；390px 和 1440px 均无统计内容或页面横向溢出。
- 前端、后端 build，7/7 普通测试和 15/15 PostgreSQL 集成测试全部通过；前端仍有既有的大于 500 kB bundle 警告。

## C-7 工单及完整审批流验收报告

- 前后端状态收敛为唯一后端枚举；创建固定得到草稿，草稿允许不完整保存，提交时重新校验项目、金额、日期和说明。
- 创建、更新和补充均从 JWT 获取操作者；客户端伪造 `status`、`creatorId` 等字段会被全局白名单校验拒绝。
- employee 只能读取和操作自己的工单；finance、reviewer、boss 仅能读取各自角色范围，显式查询越权状态返回 403。
- 财务通过/驳回/要求补充、员工追加真实附件后重提、复核通过/退回财务、规则/AI 复核、老板通过/驳回均有可继续处理的入口。
- 创建、规则复核和老板终审均具备幂等保护；并发终审使用 PostgreSQL 事务锁，审批、经营记录、审计和 ledger 只生成一次。
- 老板通过后自动生成真实 `BusinessRecord/RecordValue`；前端不再本地伪造归档记录，老板记录页可读取同一条 PostgreSQL 数据。
- API 浏览器完成四角色全流程；补充材料真实上传 PDF 后工单回到财务复审，上传与重提均为 201，页面无 4xx/5xx 或运行异常。
- Mock 浏览器在同一会话完成相同审批闭环，后端请求数为 0；Mock 与 API 使用同一前端 DTO 和 Store 动作。
- 前端和后端 build、7/7 普通测试（32/32）及 16/16 PostgreSQL 集成测试全部通过；C-7 合成项目、模板、工单、记录和附件已清理。

## C-8 文件验收报告

- `fileApi` 使用显式 Mock/API Repository；API 二进制请求沿用 Bearer Token、requestId、超时、401 失效和统一错误处理，不把 Token 放入预览 URL。
- 统一响应拦截器识别 `StreamableFile`，元数据与错误仍使用统一 envelope，预览/下载按真实 MIME、长度、Content-Disposition 和 `nosniff` 返回二进制。
- 员工上传必须绑定本人 `draft/returned_for_supplement` 工单；新建工单页面先创建草稿、再绑定上传、最后提交。财务项目级上传用于手工补录。
- 文件校验覆盖扩展名、MIME、签名、PDF 结束标记、Office 容器特征、UTF-8 CSV、空文件、配置大小上限、20 个附件上限、路径穿越、控制字符和 255 字符文件名。
- 中文 multipart 文件名会在可逆时从 Latin-1 恢复为 UTF-8；磁盘路径使用年月目录和 UUID，不含用户原文件名。
- 员工只能预览本人有权工单，reviewer/boss 按工单状态范围访问；提交后不能追加或删除附件。感染状态文件禁止预览和下载。
- 文件删除为软删除，活动工单附件关系同步移除，磁盘原件保留；已被 BusinessRecord 或 file RecordValue 引用的凭证返回 409，记录作废后仍保留。
- 手工补录 file 字段真实上传，`raw_file.id` 同时进入动态值与记录附件；记录详情显示真实文件名、大小和预览/下载，不再把文件名或内部 ID 当作假附件。
- API 浏览器完成草稿上传、元数据、PDF 预览、下载和删除；手工补录完成上传、创建、确认和记录详情预览。Mock 同流程后端请求数为 0。
- 390px 浏览器验证页面与附件行无横向溢出；合成工单、记录、数据库元数据和磁盘文件均已清理。
- 前端/后端 build、7/7 普通测试（34/34）及 17/17 PostgreSQL 集成测试通过。对象存储、真实病毒扫描和生产备份明确未实现。

## C-9 通知验收报告

- `notificationApi` 与 `notificationStore` 使用显式 Mock/API 边界；API 失败不回退 Mock，Store 不持久化其他账号的通知状态。
- 列表按 JWT 当前用户在后端强制限定 `targetUserId` 或 `targetRole`，客户端传 `targetRole` 不能扩大范围；分页、严格布尔筛选和全局未读数均由服务端返回。
- 新增 `notification_receipts` 记录每个用户的已读时间；同一角色的甲用户阅读不会影响乙用户，旧版全局已读数据由 migration 转换为对应用户收据。
- 单条已读使用事务锁与唯一约束保证幂等；重复单条已读和重复全部已读不重复写收据或审计，审计包含 actor 和 requestId。
- 工作流在提交、补充、审核、规则复核、终审和催办时创建目标角色或目标用户通知；前端点击关联通知先标记已读，再跳转真实工单详情。
- API 浏览器验证两个财务账号、员工和复核员之间的角色/私有通知隔离、单条已读、全部已读和跳转；临时通知、收据及审计数据已清理。
- Mock 浏览器验证员工催办后财务未读数从 2 增为 3、单条已读降为 2、全部已读归零，整个流程后端请求数为 0。
- 390px 下通知浮层位于视口左右 12px 内，无文档横向溢出；前端/后端 build、7/7 普通测试（34/34）及 18/18 PostgreSQL 集成测试通过。

## C-10 报表验收报告

- `reportApi` 和 `reportStore` 使用显式 Mock/API Repository；财务日报不再倍率放大 Mock 数字，老板页不再显示固定摘要或固定数量。
- 财务今日/本周/本月、老板日报/周报/月报、老板首页和项目月报概览均等待服务端结果，具备 loading、empty、error 和重试状态。
- 后端所有正式金额只从 `BusinessRecord.status=confirmed` 聚合，明确排除 draft、pending_confirm 和 rejected；内部使用 `Prisma.Decimal` 汇总后输出两位金额。
- 日、周、月统计使用 `Asia/Shanghai` 的左闭右开区间，可指定日期/月；无效日期返回统一 400，周从周一开始。
- 财务报表返回真实工单/审核数量、确认收入支出利润、费用分类和异常；老板报表返回待审批、高风险、项目利润排行和结构化摘要。
- 项目日/月报与项目概览读取相同 confirmed 记录；老板 AI 的 `get_today_report` 和 `get_project_summary` 继续直接复用 `ReportsService`，不存在第二套统计 SQL。
- 真实 PostgreSQL 测试用日初、日末、相邻日及大额非确认记录验证边界和排除规则，并覆盖 finance/boss/employee/reviewer 权限、项目日/月报及 AI toolContext 一致性。
- API 浏览器确认 12345.67 收入、2345.67 支出和 10000 利润在财务、老板及项目月报一致，999999.99 待确认收入未计入；Mock 全流程后端请求数为 0。
- API/Mock 390px 截图均无横向溢出；前端/后端 build、7/7 普通测试（35/35）及 19/19 PostgreSQL 集成测试通过，C10 临时数据已清理。
- 修复开发启动脚本：`tsx` 不提供 Nest 所需的装饰器元数据，现改用 Node watch + `ts-node/register/transpile-only`，`npm run dev` 与健康检查已实测通过。

## C-11 老板 AI 助手外壳验收报告

- `aiApi` 使用显式 Mock/API Repository；老板完整聊天页和工单“询问 AI”抽屉均调用同一 DTO，API 模式不再直接 import `mockAI`。
- 前端保存服务端 `conversationId` 续问，使用服务端消息 ID/时间，展示工具来源和人工确认状态；网络/HTTP 错误保留用户问题并提供重试。
- 兼容性 history 只序列化白名单字段，不携带展示层 `toolsUsed/fallback`；输入限制 2000 字，发送中禁止并发重复提交。
- 后端 message/conversationId/workOrderId 严格去空白和限长，过量 history、多余身份字段和非法调用日志布尔参数均返回统一 400。
- 工具路由覆盖今日/本周/本月经营报表、财务报表、具体项目/客户汇总、项目排行、待审批、异常和工单详情；不存在项目明确返回“需要人工确认”。
- 项目工具允许读取归档项目历史，月度问题复用项目月报；比较型“哪个项目/客户”问题复用老板月报排行，不新增第二套 SQL。
- 每次成功或 Provider 失败调用都写 `ai_messages`、`ai_call_logs` 和 `audit_logs`；响应返回 `callLogId`、结构化工具调用、provider/model 和 fallback。
- 真实 PostgreSQL 验证 boss-only、两个老板账号会话隔离、六种工具、同会话续问、12 条消息/6 条调用日志/6 条审计、日志不含 Token/密码及严格分页筛选。
- API 浏览器完成 4 次同会话问答和工单上下文问答；强制 503 显示真实请求编号且不回退 Mock。Mock 浏览器 4 条回答后端请求数为 0。
- API/Mock 390px 页面无横向溢出；前后端 build、7/7 普通测试（35/35）及 20/20 PostgreSQL 集成测试通过，浏览器会话/日志/审计已清理。
- 当前不需要用户提供本地模型：`AI_PROVIDER=mock` 可完成确定性验收；Qwen 本地服务部署、显存和延迟实测留到批次 G，并需按提示词先确认环境与模型操作。

## D 完整 E2E 验收报告

- 根目录新增 Playwright 配置，固定单 worker、15 秒动作超时、失败截图和 trace；本地使用系统 Edge，CI 使用 Chromium。
- `prepare-e2e.mjs` 只接受 `_test` 数据库，自动 generate、migrate deploy、清理和 seed；全局 teardown 精确清理 `E2E ` 工单、生成记录、审计、ledger 和文件。
- 21 条真实 PostgreSQL 测试覆盖四角色、Token 有效性、资源归属、身份防伪、状态机、补充材料、并发幂等、动态值、文件、报表/AI 一致性和事务回滚。
- 9 条 Playwright 测试覆盖四角色真实登录、员工创建提交、财务审核、复核员触发规则复核、老板终审、经营记录与日报，以及 401/403/网络错误和 Mock 零后端请求。
- E2E 发现并修复 `expenseType` 与模板 `costCategory` 不兼容：前端新数据双写兼容键，后端可读取旧工单字段；单元回归与完整终审链均通过。
- `.github/workflows/ci.yml` 提供 PostgreSQL 17 service job，串行运行 build、35 个单测、21 个集成测试和 9 个 E2E，失败上传 Playwright 诊断。

## 下一检查点

进入批次 E：阶段 9 真实 Excel 导入。批次 E 通过前不把阶段 10 OCR 标记完成。

## E 阶段 9 Excel 验收报告

- 新增真实 ImportTask、ImportSheet、ImportColumn、ImportRow、MappingProfile/Rule、MappingDecision 与 FieldSuggestion 模型，迁移已在 dev/test PostgreSQL 执行。
- 财务可上传真实 `.xlsx` 和受限转换的 `.xls`；后端保存原件 SHA-256、大小、MIME、上传人和不可预测存储路径，仅接受 active 项目已启用模板。
- 解析器明确支持单个非空 Sheet、第一行表头、最多 200 列/5000 行；合并单元格、多 Sheet、公式和损坏文件返回明确错误。
- 原始单元格、规范化结果、行哈希、错误和警告持久化；空行、重复行、重复列名、错误金额、错误日期与公式均有测试。
- 映射优先级为人工 Profile、fieldKey/精确名、alias、规范化名、确定性模糊匹配、人工决定；未知列不得静默丢弃。
- 人工批准新字段、映射已有字段或明确忽略均可追溯；Profile 与本次 MappingDecision 分表保存。
- confirm 在单一事务中仅导入合法行，错误/重复/忽略行保留；并发及重复 confirm 不产生重复 BusinessRecord。
- 新记录写 RecordValue、audit_logs 与 ledger_events，并可由记录列表、项目结构和财务报表读取。
- 验收证据：前后端 build 通过；8/8 suites、38/38 普通测试；22/22 PostgreSQL；10/10 Playwright。
- 本段是阶段 9 初始验收历史；其后已补齐 `.xls`、多行/合并表头和显式 Sheet 选择。跨 Sheet 联合导入、隐藏列颜色语义与超过 50 MiB 通道仍不支持。

## F 阶段 10 OCR 验收报告

- 新增 `ocr_tasks`、`ocr_attempts`、`ocr_corrections`，保存 Provider/模型/端点快照、输入哈希、页数、耗时、错误、重试、原始结果引用和 correlationId。
- `MockOcrProvider` 稳定覆盖正常、低置信度、缺字段、失败和首次失败后恢复；`LocalPaddleOcrProvider` 通过独立 HTTP 契约预留。
- PDF 使用真实解析器验证页数、损坏和密码保护标记；图片旋转、压缩、缩放和 PDF 页面渲染通过预处理元数据预留，不伪装成已实现图像增强。
- OCR 原始文本、字段级值、置信度、页码、框选、证据和原始结果引用均持久化；未确认任务不会生成经营记录。
- 人工纠错请求只传目标字段与新值，before 值、原置信度、修正人和时间由后端生成并写 `ocr_corrections`、audit 和 ledger。
- 低置信度、缺失及格式异常字段明确标记；确认动作必须显式核对，必填/日期/金额/文件引用仍执行严格服务端校验。
- confirm 在行锁事务中生成现有 `BusinessRecord/RecordValue`，来源为 `ocr`，关联原文件；并发和重复确认只生成一条记录。
- Provider 失败写尝试与任务错误，受限重试可恢复；OCR Provider 不可用不影响工单、手工补录或 Excel 模块。
- 财务可创建、运行、纠错、重试、取消和确认；老板只读；employee/reviewer 由后端拒绝。
- 验收证据：前后端 build；9/9 suites、46/46 单测；23/23 PostgreSQL；11/11 Playwright；E2E teardown 精确清理 OCR 数据与文件。
- 阶段 F 自动化验收不依赖本地模型；真实准确率验收仍需要脱敏票据/PDF及字段真值。

## G 本地模型接入准备报告

- 新增 `model_deployments`、`task_model_routes`、`ai_tasks`、`ai_call_attempts`，并为既有 `ai_call_logs` 增加 endpoint、inputHash、correlationId、attempt 和 fallback 快照。
- seed 登记 Mock、Qwen3-14B-AWQ、Qwen3-VL-8B-Instruct、PaddleOCR-VL 与 Qwen3-Embedding-8B；仅 Mock 启用，真实部署全部 disabled。
- `GET /api/model-runtime/deployments|routes|health` 只允许 finance/boss；返回 secretRef 名称而不返回密钥，健康检查由调用者显式触发。
- 共享 HTTP 层提供超时、5xx/429/网络错误有限重试和连续失败熔断；AI/OCR 分组并发门控与有界队列避免单卡过载。
- Ajv JSON Schema 对模型中间结构做严格验证；新增可构建 PaddleOCR-VL 适配器，输出再由后端按内部 OCR 契约校验。
- `npm run model:routes -- list|enable|disable` 提供显式路由开关；启用前执行带密钥健康检查，生产修改需额外环境授权。
- `deploy/model-services` 提供文本/OCR 常驻、VL/Embedding 按需的 Compose 和 OCR OpenAPI 契约；脚本在共享 GPU 上切换大模型并在失败时恢复文本服务。
- 已只读核对本地权重索引：文本、OCR、Qwen3-VL、Embedding 全部完整。未移动、删除、转换或提交任何模型权重。
- 验收证据：后端 build、10/10 suites 55/55 单测、24/24 PostgreSQL；11/11 E2E 仍保持通过（阶段 F 最后一次全量运行）。

## 本地模型部署跟进

- 本机 GPU 为 RTX 5090 32 GB，驱动 591.86；文本与 OCR 采用单并发常驻，vLLM 初始显存比例 0.52。
- `verify-model-assets.mjs` 校验配置、Tokenizer、索引分片、非空文件、`.incomplete` 和 OCR 布局模型；四套模型资产均通过。
- `model-services.mjs` 支持初始化本地密钥、常驻启动、状态检查、日志、按需模型切换、文本恢复与全部停止。
- OCR 适配器限制类型和大小、校验 Bearer Key、串行推理、清理临时文件，并只产生低置信度确定性字段候选，强制保留人工确认。
- 后端 AI 和 OCR 现在优先解析启用的数据库任务路由；密钥通过 `secretRef` 读取环境变量，不进入数据库或日志。
- 系统级阻塞：WSL 2/Docker 尚未安装，未经用户明确确认不执行安装；因此当前不声称容器、显存或准确率验收完成。

## H 工程化收尾验收报告

- CI 使用 PostgreSQL 17 service，执行 npm ci、仓库卫生和高危依赖审计、Prisma format/validate/generate/migrate/status/结构核对、前后端 build、单测、真实数据库集成和 Chromium E2E。
- 启动配置新增生产 CORS 必填、Swagger 开关、代理层数和请求限流校验；缺失/非法关键配置会拒绝启动。
- Helmet 启用 CSP、nosniff 和 `X-Frame-Options: DENY`；全局 IP 限流与既有登录限流分别保护普通请求和账号口令尝试。
- 新增 `/api/health/live` 与查询 PostgreSQL 的 `/api/health/ready`，保留阶段 0 的 `/api/health` 兼容响应。
- 请求日志统一记录 requestId、无查询参数路径、状态码、耗时和已认证 actor；5xx 客户端响应与日志不暴露凭据或异常详情。
- 生产 Swagger 默认关闭，启用 shutdown hook；部署 migration 使用 `prisma migrate deploy`。
- 仓库卫生脚本检查 `.env`、模型权重、上传物、测试样本和高风险密钥模式；370 个 tracked/candidate 文件通过。
- `docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/LOCAL_SETUP.md` 与 `docs/PR_PREPARATION.md` 补齐架构、安全、Windows/跨平台初始化和 PR/回滚说明。
- 审计修复后证据：前后端 build 通过；13/13 suites、73/73 单测；26/26 PostgreSQL；12/12 Playwright；15 个 migration、41 张业务表核对一致。
- 根目录与后端 `npm audit` 均为 0 vulnerabilities；未使用破坏性 `--force` 修复。
- 当前实现仍默认 Mock AI/OCR；真实 GPU 性能、模型准确率、企业 Excel/票据适配明确留待 Docker 环境、脱敏样本与业务真值。
- 用户已确认提交和推送；当前在专用分支完成模型部署跟进与全量回归，尚未 merge。

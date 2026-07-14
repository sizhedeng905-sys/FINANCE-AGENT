# 前端 API 迁移矩阵

更新日期：2026-07-12

## 判定规则

- `mock` 与 `api` 由 `VITE_APP_DATA_MODE` 显式选择。
- API 模式请求失败必须显示真实错误，不允许返回 Mock 数据。
- 页面只调用 API/Repository 边界，不直接引用 `src/mock`。
- “真实闭环”需要前端、真实后端、PostgreSQL、权限、错误处理和自动化证据同时成立。

## 固定迁移顺序

| 模块 | 前端调用 | 后端接口 | Mock 实现 | API 实现 | 权限测试 | 完成状态 |
| --- | --- | --- | --- | --- | --- | --- |
| B-1 登录会话 | `authApi`、`authStore`、`httpClient` | `/api/auth/login`、`me`、`logout` | 已对齐 | 已接通 | 已通过 | 真实闭环完成 |
| B-2 用户管理 | `userApi`、`userStore` | `/api/users` 系列 | 已对齐 | 已接通 | 已通过 | 真实闭环完成 |
| C-1 项目 | `projectApi`、`dataCenterStore` | `/api/projects` CRUD、summary、structure | 已对齐 | 已接通 | finance/boss/employee/reviewer 已通过 | CRUD 与结构聚合真实闭环完成 |
| C-2 模板 | `templateApi`、`dataCenterStore` | `/api/templates` CRUD/clone | 已对齐 | 已接通 | finance 与三类拒绝角色已通过 | 真实闭环完成 |
| C-3 字段/模板字段 | `fieldApi`、`templateApi`、`dataCenterStore` | `/api/fields`、`/api/templates/:id/fields`、`/api/template-fields/:id` | 已对齐 | 已接通 | finance 与三类拒绝角色已通过 | 真实闭环完成 |
| C-4 项目启用模板 | `projectApi`、`dataCenterStore` | `/api/projects/:id/templates`、`/api/project-templates/:id` | 已对齐 | 已接通 | finance 写、boss 只读、employee/reviewer 拒绝已通过 | 真实闭环完成 |
| C-5 业务记录 | `recordApi`、`dataCenterStore` | `/api/records`、`/api/projects/:id/records` | 已对齐 | 已接通 | finance 写、boss 只读、employee/reviewer 拒绝已通过 | 真实闭环完成 |
| C-6 手工补录 | `recordApi`、手工补录页 | `POST /api/records`、`POST /api/records/:id/confirm` | 已对齐 | 已接通 | finance 写及三类拒绝角色已通过 | 真实闭环完成 |
| C-7 工单 | `workOrderApi`、`workOrderStore` | `/api/work-orders` 创建/更新/提交/补充/审核/规则/AI/终审/催办/时间线 | 已对齐 | 已接通 | 四角色、资源范围、状态机、并发幂等已通过 | 真实闭环完成 |
| C-8 文件 | `fileApi`、`mockFileRepository`、`AttachmentPreview` | `/api/files` 上传/元数据/预览/下载/删除 | 已对齐 | 已接通 | 角色、归属、状态、内容、保留策略已通过 | 本地文件真实闭环完成 |
| C-9 通知 | `notificationApi`、`notificationStore` | `/api/notifications` | 已对齐 | 已接通 | 目标用户/角色、用户级已读隔离和幂等已通过 | 真实闭环完成 |
| C-10 报表 | `reportApi`、`reportStore` | `/api/reports` | 已对齐 | 已接通 | 四角色、confirmed 口径、时区边界和 AI 一致性已通过 | 真实闭环完成 |
| C-11 AI | `aiApi`、`ChatBox` | `/api/ai/chat`、`/api/ai/call-logs` | 已对齐 | 已接通 | boss-only、会话归属、六工具和日志已通过 | 真实 API 闭环完成；默认 Mock |
| D E2E | Playwright、真实 API、Mock 前端 | 阶段 0-10 核心接口 | 0 后端请求已验证 | 完整审批、Excel、OCR与安全运行验收 | 24 条 PostgreSQL + 12 条浏览器测试 | 批次 D 完成并持续扩展 |
| E Excel | `importApi`、`importStore`、导入/映射/确认/任务/建议页 | `/import-tasks`、parse/mappings/preview/confirm/errors、`/field-suggestions`、records filter | 显式内存 Repository，无 API 回退 | 真实 `.xlsx` → BusinessRecord/RecordValue/audit/ledger | 3 个解析器测试 + PostgreSQL 真实文件用例 + Playwright 浏览器上传 | 批次 E 完成 |
| F OCR | `ocrApi`、`ocrStore`、上传/任务/详情纠错页 | `/ocr-tasks` 与 `/ocr/tasks` 兼容路由，run/corrections/confirm/retry/cancel | 显式内存 Repository，无 API 回退 | 合成 PDF → Provider → 人工纠错 → BusinessRecord/RecordValue | Provider/PDF 单测 + PostgreSQL 纠错重试并发 + Playwright | 批次 F 完成 |
| G 模型运行时 | 无普通业务页面；受保护管理 API | `/model-runtime/deployments|routes|health` | Mock deployment 默认启用 | OpenAI-compatible/Local Paddle 适配、Schema、队列、重试、熔断 | 运行时单测 + PostgreSQL 权限/密钥边界/健康检查 | 框架完成；真实 GPU 待验收 |
| H 工程化 | 无新增业务页面 | `/health/live|ready`、全局安全/日志中间件 | 不适用 | CORS、Helmet、限流、requestId、生产 Swagger 开关、CI | 62 单测 + 24 PostgreSQL + 12 Playwright + hygiene/audit | 工程化收尾完成 |

## 批次 B 证据

- 浏览器真实观察到 `POST /api/auth/login`、`GET /api/auth/me`、分页 `GET /api/users` 和 `POST /api/auth/logout`。
- 刷新受保护页面会通过 `/auth/me` 恢复用户。
- API 不可达时停留在登录页，显示网络错误和请求编号，不产生令牌，不访问 Mock 仓库。
- Mock 模式在不可达 API 地址下可以独立登录和退出，API 请求数为 0。
- localStorage 仅包含存储版本和访问令牌，不包含密码或用户密码字段。
- finance 登录时，boss 行的编辑、重置密码、启停和删除按钮全部禁用；后端另有强制权限测试。

## C-1 Project 证据

- finance 浏览器真实执行项目列表、创建、编辑、软归档；刷新后仍保持更新值和归档状态。
- Network 观察到真实分页 GET、POST、PATCH、DELETE，均为成功状态；测试项目已清理。
- boss 项目页没有新建、编辑或归档入口，只保留查看动作。
- employee 通过真实 `GET /api/projects?status=active` 获取三个可选项目；归档项目由后端强制排除。
- reviewer 访问项目列表返回 403；employee 访问项目详情返回 403。
- 真实 PostgreSQL 测试覆盖伪造 `createdBy`、分页、角色矩阵、软归档和 create/update/archive requestId 审计。
- Mock 模式在不可达 API 地址下可读取和创建项目，API 请求数为 0。
- `/projects/:id/structure` 的前端聚合暂未切换；该页面依赖模板、字段、项目模板和记录，按固定顺序在 C-4/C-5 后完成。

## C-2 DataTemplate 证据

- finance 浏览器真实执行模板分页列表、创建、基本信息更新、克隆和删除；Network 请求均成功。
- 系统模板不显示删除入口；直接调用后端删除系统模板返回 409。
- 已被项目启用或已有业务记录的模板返回 409，不级联破坏关系和记录。
- 客户端不能传 `isSystem`；自定义模板始终由后端写为 `false`。
- 克隆会在同一事务复制模板字段关系；真实测试验证克隆前后字段数量一致。
- boss、employee、reviewer 访问模板接口均返回 403。
- create/update/clone/delete 均验证 actor 和 requestId 审计。
- Mock 模式在不可达 API 地址下完成模板创建和删除，API 请求数为 0。
- 模板字段关系已在后续 C-3 检查点完成真实化。

## C-3 FieldDefinition / TemplateField 证据

- finance 浏览器真实执行字段分页、创建、编辑、usage、停用，以及模板字段新增、必填切换、排序、刷新和移除；捕获的真实请求均为 2xx。
- `GET /api/fields?isActive=false` 严格返回停用字段，非法布尔值返回 400；客户端传 `isActive` 创建字段被白名单拒绝。
- 后端自动生成并去重 `fieldKey`，清理 aliases；已有动态字段值时修改 `fieldType` 返回 409。
- 停用字段加入模板返回 409；重复关系返回 409；插入、移动和移除后 `displayOrder` 始终连续。
- 从模板移除关系后字段定义仍可读取；usage 返回模板数和启用项目数。
- boss、employee、reviewer 访问字段及模板字段管理接口返回 403。
- create/update/disable/add/reorder/remove 均验证 actor 与 requestId 审计。
- Mock 模式在拦截全部后端请求时完成同一会话字段与关系流程，后端请求数为 0。

## C-4 ProjectTemplate 证据

- finance 浏览器真实执行项目模板启用、刷新、改名、停用、同关系重新启用；名称和关系 ID 语义保持稳定。
- 项目模板目录已接入项目列表抽屉、项目结构、手工补录和 Excel 入口；选择项目后只展示该项目 active 模板。
- boss 项目抽屉和结构页只调用允许的项目关系及模板字段读取接口，没有请求全量 `/templates` 或 `/fields`，没有 403 和写按钮。
- `isActive` 不能由创建或普通 PATCH 伪造；重复启用不新增关系，重复停用不新增审计。
- 归档项目不能启用、改名或停用模板关系，三类写请求均返回 409。
- enable/update/disable/reenable 审计验证 actor、requestId 和去重行为。
- Mock 模式完成启用、改名、停用、重新启用和手工补录目录，后端请求数为 0。

## C-5 BusinessRecord / RecordValue 证据

- finance 浏览器真实执行服务端项目筛选、详情、编辑、确认、软作废和刷新；项目结构读取相同记录与状态。
- boss 记录页只有详情动作，读取真实动态字段值，未出现写按钮或 403；employee/reviewer 接口访问返回 403。
- PostgreSQL 验证 `value_number`、`value_date`、`value_text`，分页、项目记录和日期整日边界结果准确。
- PATCH 传 `status`/`recordType` 被白名单拒绝；confirmed/rejected 记录更新返回 409。
- 重复确认和重复作废只产生一条对应 audit/ledger；归档项目的四类记录写入均返回 409。
- 作废记录不物理删除，列表、详情和动态字段值仍可读取。
- Mock 模式完成详情、编辑、确认、作废和项目结构，后端请求数为 0。

## C-6 手工补录证据

- 页面提交 `CreateRecordPayload` 并等待服务端返回，不生成 ID、创建人、确认人或输出型 `RecordValue`。
- 保存草稿允许缺少模板必填字段；进入待确认或调用 confirm 时后端强制执行完整必填校验。
- `sourceType/sourceId` 只能是 `manual`，直接创建 confirmed/rejected、伪造身份和 PATCH 状态均被拒绝。
- 动态字段按模板类型校验；无效日期、超范围/超精度数值、对象型文本、重复或模板外字段均不能入库。
- PostgreSQL 验证失败请求事务回滚，成功创建与确认分别写 actor、requestId、audit 和 ledger。
- API 浏览器完成草稿与确认入库，结构页刷新可见；Mock 浏览器完成同一流程且后端请求数为 0。

## C-7 工单证据

- API 浏览器以 employee 创建并提交真实工单，finance 审核、reviewer 审核与规则复核、boss 终审后生成真实经营记录；Network 中各专用动作均成功。
- 第二条真实工单覆盖财务要求补充，employee 通过两步补充交互上传签名有效 PDF 并重提；`raw_files`、`work_order_attachments` 和时间线均可追溯。
- 复核退回后的 `reviewer_rejected` 可由 finance 重新处理，不会形成状态死路；规则/AI 重试可恢复至老板待审。
- PostgreSQL 集成测试覆盖草稿完整性、身份/状态伪造、所有权、角色筛选、真实文件补充、非法跳转、AI 重试和审计。
- 老板终审要求 Idempotency-Key；两个并发批准请求均返回同一完成结果，数据库严格只有一条生成记录和一次终审审批/audit/ledger。
- Mock 浏览器在拦截全部后端请求的同一 SPA 会话完成四角色流程，生成 Mock 经营记录，后端请求数为 0。
- 前后端 build、32/32 普通测试、16/16 独立 PostgreSQL 集成测试均通过；全部 C-7 合成数据和磁盘附件已清理。

## C-8 文件证据

- API 浏览器从新建工单页先创建真实草稿，再上传并绑定 PDF；详情页加载真实元数据，preview/download/delete 分别返回 200，下载文件名正确。
- 手工补录浏览器将同一 `raw_file.id` 写入 BusinessRecord attachments 和 file RecordValue，确认后记录详情可真实预览原件。
- Mock 浏览器完成上传、元数据、预览、下载和删除，后端请求数为 0；Mock SHA-256、归属和状态限制与 API DTO 语义一致。
- PostgreSQL multipart 测试覆盖无 Token、他人工单、finance/employee 上传边界、伪 PDF、错误 MIME、空文件、超限、不可预测路径和中文文件名。
- 二进制预览/下载逐字节等于上传 Buffer；感染文件返回 403；无权角色不能读取草稿附件。
- 可编辑草稿附件软删除后关系消失、元数据作废而磁盘原件保留；提交后上传/删除返回 403。
- 项目不匹配或已关联工单的文件不能进入手工记录；被记录引用及记录作废后的原件均不能删除。
- upload/preview/download/delete 的 actor、requestId 审计和 raw file ledger 均经真实数据库验证。
- 390px 下 document 与附件行 `scrollWidth === clientWidth`；前后端 build、34/34 单测、17/17 集成测试通过，测试上传目录清空且被 Git 忽略。

## C-9 通知证据

- 前端列表、未读数、单条已读和全部已读均调用显式 Repository；API 模式不再从 fixture 初始化，Mock 模式不发起后端请求。
- 后端仅按 JWT 当前用户匹配 `targetUserId` 或 `targetRole`，忽略客户端用于兼容的 `targetRole` 查询值，无法伪造其他角色范围。
- `notification_receipts` 以 `(notification_id, user_id)` 唯一约束保存用户级已读状态；两个同角色账号的已读状态互不影响。
- 单条及全部已读操作具备幂等收据和审计；严格布尔查询、分页、总数和当前用户全局未读数经真实 PostgreSQL 测试验证。
- API 浏览器完成私有/角色通知隔离、点击已读并跳转工单、全部已读；Mock 浏览器完成催办生成通知及相同已读流程，后端请求数为 0。
- 390px 通知浮层边界、页面错误和失败响应检查通过；前后端 build、34/34 单测和 18/18 集成测试通过，验收临时数据已清理。

## C-10 报表证据

- 财务和老板页面只调用 `reportApi/reportStore`；API 模式不读取 fixture，Mock 模式不请求后端，前端不再按固定倍率、比例或工单列表计算正式报表。
- 后端查询条件固定为 `BusinessRecordStatus.confirmed`，内部以 `Prisma.Decimal` 汇总；draft、pending_confirm、rejected 均不计入收入、支出、分类、项目排行和趋势。
- `Asia/Shanghai` 日初/日末、周一至周日、月初/月末和无效日期均有单元/真实数据库证据；指定日期使用 `[start, end)` 避免跨日重复。
- finance/boss 可读取财务报表，只有 boss 可读取老板报表；finance/boss 可读取项目日/月报，employee/reviewer 均由后端返回 403。
- 固定 PostgreSQL 数据下财务、老板、项目日报/月报结果一致；AI `get_today_report` 保存的 toolContext 与普通老板日报金额逐项一致。
- API 浏览器覆盖财务三个周期、老板首页/日报/月报和项目概览；Mock 覆盖同入口且后端请求数为 0，390px 页面无横向溢出。
- 前后端 build、35/35 单测、19/19 集成测试通过；开发后端 `npm run dev` 与健康检查实测通过，验收临时数据已清理。

## C-11 老板 AI 助手证据

- 完整聊天页和工单紧凑抽屉只调用 `aiApi`；API 模式使用真实 `/api/ai/chat`，Mock 模式使用独立 Repository 且后端请求数为 0。
- 前端续问复用服务端 `conversationId`，只发送白名单 history 字段；展示工具来源、fallback，并在强制 503 时显示真实错误和请求编号。
- 后端只允许 boss 调用 chat/call-logs；finance、employee、reviewer 返回 403，第二个 boss 不能续问第一个 boss 的会话。
- 六个批准工具均有真实 PostgreSQL 证据；本月/项目/客户问题复用 C-10 报表服务，不存在项目明确转人工，不编造金额。
- 空白/超长问题、过长 ID、51 条 history、多余 role 和非法 `success` 查询均由 DTO 拒绝。
- 同一会话 6 次调用严格产生 12 条消息、6 条调用日志和 6 条审计；日志包含模型、prompt、工具、延迟和结果，不含 Token、密码或 JWT secret。
- API 浏览器完成经营、项目、待审批、不存在项目和工单风险问答；Mock 完成对应页面交互，390px 无横向溢出。
- 前后端 build、35/35 单测和 20/20 集成测试通过；API 浏览器会话、调用日志与审计已精确清理。

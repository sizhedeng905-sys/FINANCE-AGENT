# 后续功能 TODO List

当前项目仍是前端原型，已为主要功能预留 `src/api` mock Promise 接口。下一阶段建议按下面顺序推进。

## 1. 后端接口

- 登录认证：接入 `POST /api/auth/login`，返回用户、角色、token、权限菜单。
- 工单列表：接入 `GET /api/work-orders`，支持角色、状态、项目、创建人、时间范围筛选。
- 工单详情：接入 `GET /api/work-orders/:id`。
- 新建工单：接入 `POST /api/work-orders`。
- 更新工单：接入 `PUT /api/work-orders/:id`。
- 审核流转：接入 `POST /api/work-orders/:id/status`，统一处理财务审核、复核员审核、AI复核、老板审批。
- 员工催办：接入 `POST /api/work-orders/:id/urge`，同时生成通知和时间线。
- 附件上传：接入 `POST /api/work-orders/:id/attachments`，支持发票、回单、图片、PDF。
- 通知列表：接入 `GET /api/notifications?targetRole=finance`。
- 通知已读：接入 `PATCH /api/notifications/:id/read` 和 `PATCH /api/notifications/read-all`。
- AI聊天：接入 `POST /api/ai/chat`，仅老板完整聊天页面可用。
- AI异常：接入 `GET /api/reports/anomalies`，供财务异常提示页展示。
- 财务日报：接入 `GET /api/reports/finance?period=today|week|month`。
- 老板经营日报：接入 `GET /api/reports/boss?period=daily|weekly|monthly`。
- 项目概览：接入 `GET /api/projects` 和 `GET /api/projects/:id/summary`。

## 2. 数据库设计

- `users`：用户账号、姓名、角色、部门、职位、状态。
- `roles`：角色定义，包含 employee、finance、reviewer、boss。
- `permissions`：页面和操作权限。
- `projects`：客户/项目、负责人、收入、成本、状态、AI摘要。
- `work_orders`：工单主表，保存类型、项目、客户、金额、收入、成本、利润、状态、风险等级、加急字段。
- `work_order_transport`：运输订单扩展字段，保存车牌、司机、起终点、公里数、油费、过路费等。
- `work_order_expense`：费用报销和其他支出扩展字段，保存费用类型、金额、日期、付款方式、说明。
- `attachments`：附件表，关联工单，保存文件名、URL、类型、上传人。
- `audit_timeline`：审核时间线，记录操作人、角色、动作、意见、时间。
- `notifications`：通知表，保存类型、发送人、目标角色、已读状态、关联工单。
- `reports`：日报/周报/月报汇总数据。
- `ai_anomalies`：AI异常检测结果，关联工单和风险原因。
- `ai_conversations`：AI对话会话，仅老板可创建。
- `ai_messages`：AI对话消息明细。
- `audit_logs`：系统操作日志，便于追踪审批和权限变更。

## 3. 权限和安全

- 后端必须校验角色权限，前端 403 只作为体验层控制。
- 员工只能访问自己创建的工单。
- 财务可查看全部业务工单和财务日报，但不可访问老板 AI 助手。
- 复核员只能访问复核任务和审核历史，不可访问财务日报和老板 AI 助手。
- 老板可访问最终审批、经营日报、财务日报、AI助手、项目分析。
- 所有审批操作需要记录操作日志和时间线。

## 4. 业务流程

- 明确工单状态机，禁止非法状态跳转。
- 财务通过后进入复核员复核。
- 复核通过后进入 AI 自动复核。
- AI复核结果只作为流程步骤，不作为登录角色。
- AI通过或标记异常后进入老板待审批。
- 老板通过后归档完成，老板驳回后进入驳回状态。
- 待补充材料状态下，员工补充后重新提交财务审核。
- 催办需要限制频率，例如同一工单 30 分钟内只能催办一次。

## 5. 前端后续优化

- 将页面中的部分直接 mock 读取逐步切换为 `src/api` 调用。
- 增加加载态、空状态、错误态。
- 增加列表分页、排序、搜索条件持久化。
- 增加附件真实预览组件。
- 增加工单详情打印或导出 PDF。
- 增加更多表单校验，例如金额必须大于 0、运输订单收入不能为空。
- 优化大包体，按角色页面做路由懒加载。
- 增加单元测试和关键流程 E2E 测试。

## 6. 当前已预留的前端 API 文件

- `src/api/authApi.ts`
- `src/api/workOrderApi.ts`
- `src/api/notificationApi.ts`
- `src/api/projectApi.ts`
- `src/api/reportApi.ts`
- `src/api/aiApi.ts`

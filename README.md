# 物流企业 AI 财务运营审核系统

这是一个物流企业 AI 财务运营管理系统。项目正在按可验证批次从前端原型升级为真实 PostgreSQL、真实后端与可替换 AI/OCR Provider 的工程系统。

当前仓库包含前端原型和分阶段后端实现：

- 登录和用户管理已支持显式 Mock/API 双模式并接通真实后端
- 后端已完成阶段 0–10：基础骨架、权限、数据中心、业务记录、工单审批、附件通知、规则异常、实时报表、老板 AI 助手、Excel 导入和 OCR 人工确认框架
- 后端使用 PostgreSQL + Prisma，支持真实数据库连接
- AI 默认使用不需要模型的结构化 mock provider，也可配置 OpenAI 或本地 OpenAI-compatible 服务
- 项目、模板、字段、经营记录、完整审批、文件、通知、报表、AI 助手、Excel 和 OCR 页面已接真实 API
- 真实业务数据 B0-B7 工程门禁已完成：112 份原件保持只读和哈希不变，文件/Excel/OCR/经营记录/老板 AI/故障恢复均有自动化证据；财务 L3 对账和 OCR 人工标签仍待外部签字
- Qwen3-14B-AWQ 与 PaddleOCR-VL 已在 RTX 5090 上常驻运行并通过 30 分钟稳定性、服务切换和并发推理；Qwen3-VL-8B-Instruct 与 Qwen3-Embedding-8B 按需启动

## 技术栈

- React 18 + TypeScript + Vite
- Ant Design
- Zustand
- React Router
- dayjs
- Playwright

后端：

- Node.js + NestJS
- TypeScript
- PostgreSQL
- Prisma
- JWT
- class-validator
- Swagger/OpenAPI

## 功能概览

### 角色与权限

| 角色 | 账号 | 密码 | 默认入口 | 权限说明 |
| --- | --- | --- | --- | --- |
| 员工 | `employee` | `123456` | `/employee/home` | 新建工单、查看自己的工单、查看审核进度、催办 |
| 财务 | `finance` | `123456` | `/finance/home` | 财务审核、AI异常提示、财务日报、数据中心、员工管理 |
| 复核员 | `reviewer` | `123456` | `/reviewer/home` | 复核任务、审核历史 |
| 老板 | `boss` | `123456` | `/boss/home` | 最终审批、AI助手、经营日报、项目数据只读、员工管理 |

> 登录页也支持中文角色展示。真实后端接入后，角色 key 仍建议保持 `employee`、`finance`、`reviewer`、`boss`。

### 主要模块

- 登录与角色权限
- 统一后台 Layout：左侧菜单、顶部用户信息、通知铃铛、内容区域
- 员工工单：新建工单、我的工单、工单详情、催办
- 财务审核：待审核列表、详情、附件预览、AI分析摘要、审核按钮
- 复核员审核：复核任务、审核历史
- 老板审批：最终审批、AI建议、风险等级、询问 AI
- 通知提醒：催办通知、审核提醒、系统提醒、老板审批提醒
- AI助手：boss-only 持久化会话、六个结构化工具、调用日志，以及显式 Mock/API Provider
- 日报中心：财务日报、老板经营日报
- 项目数据中心：项目、模板、字段、手工补录、Excel 导入、字段建议、数据记录
- OCR中心：票据/PDF任务、识别证据与置信度、人工纠错、确认入库
- 员工管理：财务和老板可新增、编辑、禁用、重置用户

## 2026-07-14 审计修复状态

针对 PR #2 的 15 项 P1、12 项 P2 和 5 项 P3 审计结果，本分支已完成财务方向、金额精度、并发状态、审批快照、文件隔离、模板版本、AI 可信边界、风险异常闭环、认证与供应链等修复，并补充攻击型回归测试。

主要收口项：

- 模板版本固定 `income/expense` 会计方向和主金额/主日期字段；手工、工单、Excel、OCR 复用同一记录策略，报表不再根据中文分类猜测方向。
- 所有正式金额 API 使用固定小数位字符串，数据库和聚合路径保持 `Prisma.Decimal`，已验证 `90071992547409.91` 分币无损往返。
- 经营记录和工单使用版本/CAS、事务锁、互斥时间戳、提交快照和附件 SHA-256 清单；并发确认、作废、修改、上传、删除和提交均有最终数据库断言。
- 文件先授权、后进入隔离区并 fail-closed 扫描；生产强制 ClamAV，PDF/OOXML/CSV/图片做结构校验，上传下载流式处理，并有用户/项目配额与磁盘水位保护。
- Excel/OCR 任务具备 lease、取消和过期恢复；OCR 使用原子上传建任务接口；不可变模板发生字段扩展时自动克隆新版本。
- Cookie 登录使用 HttpOnly、SameSite 和双提交 CSRF；生产环境校验可信代理、远程 PostgreSQL TLS、JWT 熵和受保护 seed。
- AI 使用有限服务端会话历史、项目唯一匹配、不可信工具数据边界和响应大小/token 限制；异常支持人工处置并在审批后闭环。
- 前端 API 模式直接读取真实项目结构，路由按页懒加载；CI 固定 Action SHA，并加入 Gitleaks、CodeQL 和 Dependabot。

当前仍按用户决定暂缓一项，不应视为已解决：

- **P1-07**：Excel、OCR、手工录入之间的跨来源业务去重策略和统一幂等键。

**P1-08 已完成**：同步接口保持 5000 行上限，5001-50000 行自动进入后台流式任务；每 500 行提交并刷新租约，前端展示进度且支持取消，过期租约从第 0 行幂等重放，最多自动恢复三次。5001 与 30196 行已通过真实 PostgreSQL 无重复/无漏行验证，确认前不会生成 `BusinessRecord`。

因此当前版本适合隔离开发和真实样本结构验收；在跨来源去重政策、真实模型/ClamAV/反向代理部署验收及脱敏业务真值校准前，不标记为生产就绪。

## 启动方式

### 前端启动

先复制 `.env.example` 为 `.env.local`。本地真实联调使用：

```env
VITE_APP_DATA_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_API_TIMEOUT_MS=15000
```

只运行前端演示时将 `VITE_APP_DATA_MODE` 改为 `mock`。API 模式失败不会回退到 Mock。

```bash
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:5173
```

Windows 脚本启动：

双击或运行：

```bat
start-dev.bat
```

该脚本会：

1. 停止本机 `5173` 端口上的旧 Vite 进程
2. 执行 `npm install`
3. 启动 `npm run dev -- --host 127.0.0.1 --port 5173`

PowerShell 也可以运行：

```powershell
.\start-dev.ps1
```

### 后端启动

```bash
cd backend
npm install
copy .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

后端默认地址：

```text
http://localhost:3001
```

Swagger：

```text
http://localhost:3001/api/docs
```

Health：

```text
http://localhost:3001/api/health
```

### 后端阶段进展

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 阶段 0 | 已完成 | NestJS、TypeScript、Prisma、PostgreSQL、统一响应、统一错误、Swagger、健康检查 |
| 阶段 1 | 已完成 | 用户表、审计日志、JWT 登录、当前用户、退出、用户管理、finance/boss 权限 |
| 阶段 2 | 已完成 | 项目、模板、字段、项目启用模板、项目结构可视化 |
| 阶段 3 | 已完成 | 业务记录、动态字段值、手工补录、记录确认、ledger_events 简化事件 |
| 阶段 4 | 已完成 | 工单主流程、角色数据范围、审批状态机、时间线、催办 |
| 阶段 5 | 已完成 | 本地附件上传、预览下载、SHA-256、软删除、通知未读闭环 |
| 阶段 6 | 已完成 | 可配置规则审核、自动风险检查、异常记录与追溯 |
| 阶段 7 | 已完成 | 老板审批幂等生成经营记录、财务/老板/项目实时报表 |
| 阶段 8 | 已完成 | 老板 AI 助手、六个结构化工具、mock/OpenAI-compatible provider、AI 调用日志 |
| 阶段 9 | 已完成 | 真实 `.xlsx` 解析、映射、逐行错误、字段建议和幂等事务入库 |
| 阶段 10 | 程序完成 | OCR Task、可构建 PaddleOCR 适配器、证据/置信度、人工纠错、重试和幂等入库；真实准确率待样本校准 |
| 真实化批次 D-H | 已完成 | 30 条 PostgreSQL、14 条 Playwright、模型运行时、安全加固、CI 与交付文档 |
| PR #2 审计修复 | 基本完成 | P1-08 超大 Excel 后台分块已完成；仅用户暂缓的 P1-07 跨来源业务去重未收口，其余 P1/P2/P3 已修复并回归 |
| 真实业务数据 B0-B7 | 工程完成 | 112 个文件只读匿名基线、文件/Excel/OCR、四来源财务记录、72 条 AI 基准、并发与故障恢复均已验收；财务签字见 `docs/B7_FINANCE_UAT_ACCEPTANCE.md` |
| 本地模型部署 | 稳定性通过 | 四套资产完整；文本/OCR 常驻和 VL 按需切换已在 RTX 5090 实测，OCR 准确率仍等待人工标签 |

阶段 1 后端测试账号：

| 账号 | 密码 | role |
| --- | --- | --- |
| `员工` / `employee` | `123456` | `employee` |
| `财务` / `finance` | `123456` | `finance` |
| `复核员` / `reviewer` | `123456` | `reviewer` |
| `老板` / `boss` | `123456` | `boss` |

已实现后端接口：

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/users`
- `POST /api/users`
- `GET /api/users/:id`
- `PATCH /api/users/:id`
- `PATCH /api/users/:id/password`
- `PATCH /api/users/:id/status`
- `DELETE /api/users/:id`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/structure`
- `GET /api/projects/:id/summary`
- `GET /api/projects/:projectId/templates`
- `POST /api/projects/:projectId/templates`
- `PATCH /api/project-templates/:id`
- `PATCH /api/project-templates/:id/disable`
- `GET /api/templates`
- `POST /api/templates`
- `GET /api/templates/:id`
- `PATCH /api/templates/:id`
- `DELETE /api/templates/:id`
- `POST /api/templates/:id/clone`
- `GET /api/templates/:id/fields`
- `POST /api/templates/:id/fields`
- `PATCH /api/template-fields/:id`
- `DELETE /api/template-fields/:id`
- `GET /api/fields`
- `POST /api/fields`
- `GET /api/fields/:id`
- `PATCH /api/fields/:id`
- `PATCH /api/fields/:id/disable`
- `GET /api/fields/:id/usage`
- `GET /api/records`
- `POST /api/records`
- `GET /api/records/:id`
- `PATCH /api/records/:id`
- `DELETE /api/records/:id`
- `POST /api/records/:id/confirm`
- `GET /api/projects/:projectId/records`
- `GET /api/work-orders`
- `POST /api/work-orders`
- `GET /api/work-orders/:id`
- `PATCH /api/work-orders/:id`
- `POST /api/work-orders/:id/submit`
- `POST /api/work-orders/:id/finance-review`
- `POST /api/work-orders/:id/reviewer-review`
- `POST /api/work-orders/:id/run-rules`
- `POST /api/work-orders/:id/boss-approve`
- `POST /api/work-orders/:id/urge`
- `GET /api/work-orders/:id/timeline`
- `POST /api/work-orders/:id/generate-record`
- `POST /api/files/upload`
- `GET /api/files/:id`
- `GET /api/files/:id/preview`
- `GET /api/files/:id/download`
- `DELETE /api/files/:id`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
- `GET /api/risk-rules`
- `POST /api/risk-rules`
- `PATCH /api/risk-rules/:id`
- `GET /api/reports/anomalies`
- `GET /api/reports/finance`
- `GET /api/reports/boss`
- `GET /api/reports/projects/:projectId/daily`
- `GET /api/reports/projects/:projectId/monthly`
- `POST /api/ai/chat`
- `GET /api/ai/conversations`
- `GET /api/ai/conversations/:id/messages`
- `GET /api/ai/call-logs`
- `GET/POST /api/import-tasks`
- `POST /api/import-tasks/:id/parse`
- `PUT /api/import-tasks/:id/mappings`
- `GET /api/import-tasks/:id/rows`
- `GET /api/import-tasks/:id/errors`
- `GET /api/import-tasks/:id/preview`
- `POST /api/import-tasks/:id/confirm`
- `GET /api/field-suggestions`
- `POST /api/field-suggestions/:id/{approve|map|reject}`
- `GET/POST /api/ocr-tasks`
- `POST /api/ocr-tasks/upload`
- `POST /api/ocr-tasks/:id/run`
- `POST /api/ocr-tasks/:id/retry`
- `PUT /api/ocr-tasks/:id/corrections`
- `POST /api/ocr-tasks/:id/confirm`
- `GET /api/model-runtime/deployments`
- `GET /api/model-runtime/routes`
- `GET /api/model-runtime/health`
- `GET /api/health/live`
- `GET /api/health/ready`

## 构建

```bash
npm run build
```

或运行：

```bat
build.bat
```

构建产物输出到：

```text
dist/
```

## 自动化验收

后端单元测试和真实 PostgreSQL 集成测试：

```bash
npm test --prefix backend
npm run test:integration --prefix backend
```

当前 B7 验收基线为 17/17 Jest suites、184/184 tests、30/30 真实 PostgreSQL 集成测试和 14/14 Playwright。测试库已应用 18/18 Prisma migrations，40 张预期业务表核对一致；根目录和 `backend/` 的生产依赖审计均为 0 vulnerabilities。

完整浏览器 E2E 会初始化独立测试库并启动 API/Mock 两套前端。先配置 `backend/.env.test`，数据库名必须以 `_test` 结尾：

```bash
npm run test:e2e
```

覆盖范围、清理规则和失败 trace 用法见 `docs/E2E_ACCEPTANCE.md`。GitHub Actions 的 `postgres-e2e` job 会自动运行构建、单测、数据库集成和核心 E2E。

## 常用调试命令

查看本机监听的 5173 端口：

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
```

停止占用 5173 端口的进程：

```powershell
$listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
$listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

清理前端本地缓存后重新登录：

```text
登录页点击“清空缓存并重新登录”
```

如果页面出现旧数据或权限异常，优先清理浏览器 localStorage。

## 目录结构

```text
.
├── docs/                         # 后端接入计划
├── src/
│   ├── api/                      # 显式 Mock/API Repository 与统一 HTTP client
│   ├── components/               # 通用组件、工单组件、通知组件、AI组件
│   ├── layouts/                  # 主后台 Layout
│   ├── mock/                     # mock 用户、项目、工单、通知、日报、数据中心
│   ├── pages/                    # 页面模块
│   │   ├── boss/                 # 老板端
│   │   ├── common/               # 通用页面，如工单详情、403、404
│   │   ├── data/                 # 项目数据中心
│   │   ├── employee/             # 员工端
│   │   ├── finance/              # 财务端
│   │   ├── login/                # 登录页
│   │   ├── reviewer/             # 复核员端
│   │   └── system/               # 员工管理
│   ├── router/                   # 路由、菜单、权限判断
│   ├── store/                    # Zustand 状态管理
│   ├── types/                    # TypeScript 类型定义
│   └── utils/                    # 格式化、状态映射、缓存工具
├── 数据库设计文档_V1.0.md
├── 后端接口文档_V1.0.md
├── NEXT_TODO.md
├── COMMANDS.md
├── start-dev.bat
├── start-dev.ps1
└── build.bat
```

## 核心文件说明

| 文件/目录 | 说明 |
| --- | --- |
| `src/router/roleMenus.tsx` | 四类角色菜单和页面权限 |
| `src/router/index.tsx` | 路由注册 |
| `src/layouts/MainLayout.tsx` | 后台主布局 |
| `src/store/authStore.ts` | 登录用户状态 |
| `src/store/workOrderStore.ts` | 工单和审批状态 |
| `src/store/dataCenterStore.ts` | 项目、模板、字段和数据记录 |
| `src/store/importStore.ts`、`src/store/ocrStore.ts` | Excel 与 OCR 任务工作流 |
| `src/store/notificationStore.ts` | 通知提醒 |
| `src/store/userStore.ts` | 员工管理 |
| `src/api/` | 统一 HTTP/Repository 边界；C-1 至 C-11、Excel 和 OCR 已接真实 API |
| `src/mock/` | 当前原型 mock 数据 |
| `src/types/` | 全局类型定义 |

## 后端接入位置

真实后端切换必须经过 `src/api` 的 Repository 边界，页面不得直接依赖 `src/mock`。下表模块均已接通，Mock 只由环境变量显式选择。

| 模块 | 前端接口文件 | 预留方向 |
| --- | --- | --- |
| 登录认证 | `src/api/authApi.ts` | 已接真实 login、me、logout 和 Token 失效 |
| 用户管理 | `src/api/userApi.ts` | 已接真实分页、增改、启停、软删除和重置密码 |
| 工单审批 | `src/api/workOrderApi.ts` | 工单 CRUD、审核流转、催办、生成业务记录 |
| 通知 | `src/api/notificationApi.ts` | 通知列表、已读、全部已读 |
| 项目管理 | `src/api/projectApi.ts` | 已接真实列表、详情、创建、更新、归档、汇总和结构聚合 |
| 模板字段 | `src/api/templateApi.ts`、`src/api/fieldApi.ts` | 模板、字段字典与模板字段关系已接真实 API |
| 业务记录 | `src/api/recordApi.ts` | 手工补录、分页记录、动态值、编辑、确认和软作废已接真实 API |
| Excel 导入 | `src/api/importApi.ts`、`src/api/mappingApi.ts` | 已接真实文件、映射、逐行错误与确认导入 |
| 文件附件 | `src/api/fileApi.ts` | 上传、预览、下载 |
| 报表 | `src/api/reportApi.ts` | 财务日报、老板经营日报、异常统计 |
| AI | `src/api/aiApi.ts`、`src/api/dataAiApi.ts` | `POST /api/ai/chat`、风险检测、字段映射建议 |
| OCR | `src/api/ocrApi.ts` | 已接任务、证据、人工纠错与确认入库 |

## 后端与数据库文档

项目根目录已包含两份 V1.0 设计文档：

- `后端接口文档_V1.0.md`
- `数据库设计文档_V1.0.md`

这两份文档覆盖：

- 四类角色与权限
- 动态字段模型
- 项目结构可视化
- Excel 导入和字段映射
- 工单审批流
- 通知提醒
- OCR 与 AI 占位
- 财务日报和老板经营日报
- 追加式原始数据账本
- 审计日志

后续细化建议见：

- `NEXT_TODO.md`
- `docs/backend-api-plan.md`

## 当前限制

- 认证、用户管理和 C-1 至 C-11 已完成显式 Mock/API 切换；API 失败不会静默回退 Mock。
- Excel 已使用真实解析器和 PostgreSQL；Qwen/Paddle 服务已在 Docker/GPU 上完成稳定性验证。默认开发配置仍使用确定性 Mock Provider，真实 OCR 准确率必须在财务复核 17 份标签后才能声明达标。
- 后端权限已经按 JWT 角色和数据归属强制校验，前端路由仅用于界面体验。
- 文件当前真实存储在 `backend/uploads`；开发可用基础扫描，生产配置强制使用 ClamAV 且只允许 `clean` 文件进入预览、下载、Excel 或 OCR。对象存储、备份和实际 ClamAV 服务部署仍需在目标环境完成。
- 后端报表只聚合 PostgreSQL 中已确认经营记录，前端财务/老板/项目报表均已切换真实接口。
- AI 默认使用结构化 mock provider；本地路由启用前强制健康检查。真实 Qwen 72 条基准暴露较高 grounding fallback，因此财务数字继续由结构化工具和受控 renderer 提供，模型不能自由生成金额。
- 全局/登录限流当前为单实例内存实现；生产多副本需要共享限流。对象存储、ClamAV 服务、集中监控和备份仍待部署。
- 跨 Excel/OCR/手工来源的业务去重仍按用户决定暂缓；Excel 当前只接受 50000 行以内，50 MiB 为含边界硬上限，超过时统一返回 413。旧 `.xls` 已进入隔离转换通道，但不会执行公式或接受缺失缓存的公式行。

## 推荐后续开发顺序

1. 财务按 `docs/B7_FINANCE_UAT_ACCEPTANCE.md` 完成 L3 逐分对账、入账粒度和负数/冲销政策签字，并复核 17 份 OCR 字段标签。
2. 定义跨 Excel/OCR/手工来源的业务唯一性政策，再实现统一幂等键和重复入账攻击测试。
3. 根据已签字标签校准 OCR 字段准确率、低置信度召回率和人工复核时长；达标前保持人工辅助模式。
4. 上线前部署对象存储、ClamAV、共享限流、密钥托管、监控和备份，并在真实反向代理/PostgreSQL TLS 拓扑演练。

## GitHub

当前仓库：

```text
https://github.com/sizhedeng905-sys/FINANCE-AGENT
```

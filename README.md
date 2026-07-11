# 物流企业 AI 财务运营审核系统

这是一个物流企业 AI 财务运营管理系统的前端原型，用于梳理工单、财务审核、复核、老板审批、项目数据中心、日报和 AI 辅助分析等业务流程。

当前仓库包含前端原型和分阶段后端实现：

- 前端页面仍默认使用 `src/mock` 数据
- 后端已完成阶段 0–8：基础骨架、权限、数据中心、业务记录、工单审批、附件通知、规则异常、实时报表和老板 AI 助手
- 后端使用 PostgreSQL + Prisma，支持真实数据库连接
- AI 默认使用不需要模型的结构化 mock provider，也可配置 OpenAI 或本地 OpenAI-compatible 服务
- 前端仍默认使用 mock，真实接口已统一预留在 `src/api`，下一步是前后端联调

## 技术栈

- React 18 + TypeScript + Vite
- Ant Design
- Zustand
- React Router
- ECharts
- dayjs

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
- AI助手：类 ChatGPT 对话界面，当前为 mock 回复
- 日报中心：财务日报、老板经营日报
- 项目数据中心：项目、模板、字段、手工补录、Excel 导入、字段建议、数据记录
- 员工管理：财务和老板可新增、编辑、禁用、重置用户

## 启动方式

### 前端启动

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
- `GET /api/ai/call-logs`

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
│   ├── api/                      # 未来后端接口统一入口，当前返回 mock Promise
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
| `src/store/dataCenterStore.ts` | 项目、模板、字段、数据记录、导入任务 |
| `src/store/notificationStore.ts` | 通知提醒 |
| `src/store/userStore.ts` | 员工管理 |
| `src/api/` | 未来真实后端接口替换位置 |
| `src/mock/` | 当前原型 mock 数据 |
| `src/types/` | 全局类型定义 |

## 后端接入位置

真实后端开发时，优先替换 `src/api` 下的 mock Promise，页面和 Zustand store 尽量保持现有调用方式。

| 模块 | 前端接口文件 | 预留方向 |
| --- | --- | --- |
| 登录认证 | `src/api/authApi.ts` | `POST /api/auth/login`、`GET /api/auth/me`、刷新 token |
| 用户管理 | `src/api/userApi.ts` | 用户列表、新增、编辑、禁用、重置密码 |
| 工单审批 | `src/api/workOrderApi.ts` | 工单 CRUD、审核流转、催办、生成业务记录 |
| 通知 | `src/api/notificationApi.ts` | 通知列表、已读、全部已读 |
| 项目管理 | `src/api/projectApi.ts` | 项目列表、详情、结构、经营汇总 |
| 模板字段 | `src/api/templateApi.ts`、`src/api/fieldApi.ts` | 模板、字段字典、模板字段关系 |
| 业务记录 | `src/api/recordApi.ts` | 手工补录、数据记录、记录确认 |
| Excel 导入 | `src/api/importApi.ts`、`src/api/mappingApi.ts` | 导入任务、字段映射、确认导入 |
| 文件附件 | `src/api/fileApi.ts` | 上传、预览、下载 |
| 报表 | `src/api/reportApi.ts` | 财务日报、老板经营日报、异常统计 |
| AI | `src/api/aiApi.ts`、`src/api/dataAiApi.ts` | `POST /api/ai/chat`、风险检测、字段映射建议 |
| OCR | `src/api/ocrApi.ts` | OCR任务、识别结果确认 |

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

- 当前前端仍默认使用 mock 数据，刷新页面后部分状态依赖 localStorage。
- 前端 AI、OCR、Excel 页面仍默认调用 mock；后端阶段 0–8 接口需要单独联调到 `src/api`。
- 后端权限已经按 JWT 角色和数据归属强制校验，前端路由仅用于界面体验。
- 文件当前真实存储在 `backend/uploads`，生产环境仍需替换为对象存储并接入病毒扫描与备份。
- 后端报表来自 PostgreSQL 实时聚合；前端报表页面尚未切换到真实接口。
- AI 默认使用结构化 mock provider；真实模型需要配置 API，阶段 8 不要求训练或部署本地模型。
- Excel 导入和 OCR 分别属于阶段 9、阶段 10，尚未实现。

## 推荐后续开发顺序

1. 将 `src/api` 的登录、工单、文件、通知、报表和 AI 模块逐步切换到真实后端，并保留 mock fallback。
2. 使用真实 PostgreSQL 执行全部 migration、seed 和端到端业务验收。
3. 阶段 9：Excel 导入、字段映射、预览和幂等确认。
4. 阶段 10：OCR provider、低置信度标记和人工确认入库。
5. 上线前替换对象存储、接入病毒扫描、密钥托管、监控和备份。

## GitHub

当前仓库：

```text
https://github.com/sizhedeng905-sys/FINANCE-AGENT
```

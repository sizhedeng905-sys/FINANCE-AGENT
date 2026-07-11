# 物流企业 AI 财务运营审核系统

这是一个物流企业 AI 财务运营管理系统的前端原型，用于梳理工单、财务审核、复核、老板审批、项目数据中心、日报和 AI 辅助分析等业务流程。

当前仓库包含前端原型和分阶段后端实现：

- 前端页面仍默认使用 `src/mock` 数据
- 后端已新增 `backend/`，完成阶段 0 项目骨架、阶段 1 登录/用户权限、阶段 2 数据中心基础、阶段 3 业务记录手工补录
- 后端使用 PostgreSQL + Prisma，支持真实数据库连接
- 不调用真实 AI API
- 工单、项目、附件、报表、AI 助手等业务接口仍待后续阶段实现
- 所有未来接口统一预留在 `src/api`

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
| 阶段 4+ | 待实现 | 工单主流程、附件、通知、规则审核、报表、AI 助手 |

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
- AI、OCR、Excel 文件解析均为前端 mock，不代表真实识别能力。
- 权限由前端路由控制，真实上线必须由后端再次校验。
- 文件上传当前只是原型交互，不会真正存储到对象存储。
- 报表数据来自 mock 汇总，不是实时财务数据。

## 推荐后续开发顺序

1. 后端基础：用户、登录、权限、JWT、审计日志。
2. 数据中心基础：项目、模板、字段、项目启用模板。
3. 文件上传和追加式账本：`raw_files` + 完整 `ledger_events`。
4. Excel 导入：导入任务、原始行、字段映射、确认入库事务。
5. 工单审批：员工提交、财务审核、复核、AI复核、老板终审、催办。
6. 通知、日报、AI基础。
7. OCR 图片/PDF 识别和人工确认入库。

## GitHub

当前仓库：

```text
https://github.com/sizhedeng905-sys/FINANCE-AGENT
```

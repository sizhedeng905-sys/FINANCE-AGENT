# FINANCE-AGENT

面向物流企业的 AI 财务运营系统。项目把员工工单、财务审核、复核、规则与 AI 辅助检查、老板审批、经营数据、通知、日报和老板 AI 助手连接为一个可审计的业务闭环。

当前仓库已经从前端原型推进到 React 前端、NestJS 后端、PostgreSQL 数据库、异步 Excel/OCR、结构化 AI Claim、本地模型控制面和 Staging 工程。自动化工程工作已完成到 B8-09 与 RC-04，但真实 Staging、财务真值、OCR/AI 真值和人工签字尚未完成，因此本项目**不是 production-ready**。

## 项目状态

状态快照：2026-07-18

| 项目 | 当前状态 | 人工判断依据 |
| --- | --- | --- |
| 第一版业务闭环 | `engineering_complete` | 登录、工单、附件、四级审核、经营记录、通知、日报和 AI 助手均已接真实 API |
| 后端阶段 0-10 | `engineering_complete` | NestJS/PostgreSQL/Prisma、业务模块、Excel 和 OCR 均已实现 |
| B0-B7 真实数据工程 | `engineering_complete` | 大文件、四来源记录、模型、并发与故障恢复已有自动化证据 |
| B8-01 至 B8-07 | `engineering_complete` | 状态机、金额精度、异步任务、AI grounding、安全和模型控制面已收口 |
| B8-08 财务 UAT | `awaiting_human_signoff` | 匿名工具、逐分对账脚本和签字模板已交付，真实结论必须由授权人员填写 |
| B8-09 Staging | `blocked_external` | 18 服务配置和运维工具已完成；最后一次 release 在 Compose `up` 前被 registry TLS 超时阻断 |
| RC-00 至 RC-04 | `engineering_complete` | 机器可执行审计、修复、全量回归、交接和 PR 看护已完成 |
| 发布结论 | `blocked_external` | 真实 Staging、恢复演练、安全复核、财务/OCR/AI 真值和最终签字均未完成 |

最新经过完整代码门禁的提交：`4d597721e693d14f09ec518c7ea9dfc4093766e9`

- 工作分支：`agent/b8-stable-hardening`
- Draft PR：[PR #4: B8 stable hardening through model control plane](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- Build and acceptance：[run 29591539073](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29591539073)，成功
- CodeQL：[run 29591542681](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29591542681)，成功
- PR 安全 review thread：3/3 已解决且已过期，未解决数量为 0

上述结论只代表工程候选状态。CI 全绿不能替代真实环境验收和业务签字。

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
- OCR 永远需要人工确认；未经确认的 OCR 任务不会自动生成正式经营记录。
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

## B8 与 RC 加固进展

已完成的主要工程收口：

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

详细问题状态见 [`docs/B8_BLOCKER_MATRIX.md`](docs/B8_BLOCKER_MATRIX.md) 和 [`docs/RELEASE_CANDIDATE_AUDIT.md`](docs/RELEASE_CANDIDATE_AUDIT.md)。

## 自动化证据

以下是 2026-07-17 至 2026-07-18 的最终工程基线：

| 门禁 | 结果 | 证据摘要 |
| --- | --- | --- |
| 前端 production build | `passed` | Vite 构建 3,143 modules |
| 后端 build | `passed` | Prisma Client、NestJS 应用和脚本 TypeScript |
| 后端 Jest | `passed` | 29/29 suites，263/263 tests |
| PostgreSQL 集成 | `passed` | 2/2 suites，60/60 tests |
| 浏览器 E2E | `passed` | Playwright 16/16 |
| Prisma | `passed` | 24/24 migrations；41 表、27 enums、173 indexes、77 foreign keys |
| Migration 路径 | `passed` | 空 `_test` 库 24 条；上一基线 23 条再升级第 24 条 |
| 大批量 Excel | `passed` | 30,196 与 49,999 行最终记录、动态值、金额、audit、ledger 和日报闭环 |
| OCR 并发 | `passed` | 1/3/5 精确并发门禁；最新 GitHub 集成 60/60 |
| Repository hygiene | `passed` | 550 个 tracked/candidate 文件；真实数据、模型、secret 和构建产物排除 |
| 生产依赖审计 | `passed` | 根目录与后端均为 0 vulnerabilities |
| Paddle adapter | `passed` | 运行镜像内 8/8；合成 PDF 实际 OCR 接受测试通过 |
| 模型韧性 | `passed` | 文本重启、VL 切换、文本恢复；432 次 OCR readiness 采样零失败 |
| Staging 静态门禁 | `passed` | 18 services、17 secrets、TLS、固定 tag、私网和只读应用容器 |
| Shell/Compose | `passed` | 10/10 shell、1/1 PowerShell syntax、两份 Compose config |
| 最新 GitHub Build | `passed` | 完整 build、263 单测、60 集成、16 E2E，耗时 6 分 46 秒 |
| 最新 GitHub CodeQL | `passed` | JavaScript/TypeScript 分析成功，无开放 review thread |
| 真实 Staging release | `blocked_external` | Node 基础镜像 metadata TLS timeout；没有执行 `up`、smoke 或 restore drill |

测试数量下降必须解释，不得通过删除测试、放宽安全断言或静默回退 Mock 制造绿色结果。

## 尚未完成的门禁

| 状态 | 事项 | 必须由谁完成 | 允许进入下一步的证据 |
| --- | --- | --- | --- |
| `blocked_external` | 目标服务器、域名、registry、正式 secret 和真实 Staging | 基础设施负责人 | 18 服务固定版本启动，TLS 与 readiness 通过 |
| `blocked_external` | 真实备份恢复、RPO/RTO 和 rollback | 运维/DBA | release manifest、smoke、恢复和回退记录 |
| `pending_human_decision` | 入账粒度、负数、冲销、更正、作废和关账 | 财务负责人 | 已签字规则和验收样例 |
| `pending_human_decision` | Excel/OCR/手工/工单跨来源重复策略 | 财务与业务负责人 | 唯一性字段、时间窗、金额容差和处置规则 |
| `pending_human_decision` | MFA、最终权限矩阵、文件下载和外部 AI 数据政策 | 管理层与安全负责人 | 已批准政策和实现要求 |
| `awaiting_human_signoff` | 财务逐分对账 | 财务负责人 | 系统与人工汇总差异为 0，或有正式问题单 |
| `awaiting_human_signoff` | 17 份 OCR 标签与 5 份盲测真值 | 独立标注/复核人员 | 冻结标签、准确率和关键字段错误报告 |
| `awaiting_human_signoff` | 老板 AI 标准问题和答案 | 老板或授权审批人 | 正确期间、口径、项目和来源的签字结果 |
| `awaiting_human_signoff` | 独立代码与安全 Review | 非本实现者 | PR Review 记录和 P0/P1 关闭证明 |
| `awaiting_human_signoff` | 最终 UAT 和有限试运行批准 | 财务、业务、老板、安全、项目负责人 | 签字结论和试运行范围 |

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

本地开发可用单进程 API 和本地文件存储。提供的 Staging 拓扑固定为单 API、单 Worker，因为登录限流、上传准入和模型并发闸门仍有进程内状态；横向扩容前必须迁移为共享原子控制并完成多实例故障测试。

## 技术栈

前端：

- React 18、TypeScript、Vite
- Ant Design、Zustand、React Router、dayjs
- Playwright

后端：

- Node.js 22+、NestJS 11、TypeScript
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

- Node.js 22 或更高版本
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
| Rules/reports | `/api/risk-rules/*`、`/api/reports/*` |
| Boss AI | `/api/ai/chat`、`/api/ai/conversations/*`、`/api/ai/call-logs/*` |
| Excel | `/api/import-tasks/*`、`/api/field-suggestions/*` |
| OCR | `/api/ocr-tasks/*` |
| Model runtime | `/api/model-runtime/deployments`、`/routes`、`/health` |

完整字段、状态码和权限以 Swagger 与后端 DTO/Guard 为准。

## 测试与验收

安装和构建：

```bash
npm ci
npm ci --prefix backend
npm run build
npm run build --prefix backend
```

核心自动化：

```bash
npm test --prefix backend
npm run test:integration --prefix backend
npm run test:e2e
npm run check:hygiene
npm run db:migration-paths --prefix backend
```

生产依赖审计：

```bash
npm audit --omit=dev --audit-level=high
npm audit --prefix backend --omit=dev --audit-level=high
```

集成和 E2E 必须使用数据库名以 `_test` 结尾的专用 PostgreSQL。测试准备、seed、清理和 restore 脚本会拒绝非测试库，禁止通过修改保护逻辑在开发库或生产库运行破坏性测试。

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

这些结果证明运行时控制和恢复链路，不代表 OCR 字段准确率或老板 AI 业务正确率已经获得人工签字。

## Staging 与发布

```bash
npm run staging:init
npm run staging:check
npm run staging:release
```

`staging:init` 只在被 Git 忽略的目录生成随机 secret、CA 和证书。`staging:release` 要求干净工作树，并执行 migration、权限、TLS smoke、关联备份恢复、release manifest 和必要回退检查。

当前已完成：

- 18 服务 Compose 拓扑和静态安全断言。
- API/Worker 分离、Redis、MinIO、ClamAV、PostgreSQL TLS 和三套可观测性服务。
- migrator/runtime/backup 数据库账号分离；runtime 不能更新或删除 audit/ledger。
- 应用回退、数据恢复和模型回退脚本及人工确认边界。
- 基础服务镜像拉取和 backup 镜像构建。

当前未完成：

- Node 基础镜像 metadata 拉取成功后的完整 `docker compose up`。
- 真实 TLS、Redis、MinIO/S3、ClamAV、PostgreSQL 和 Worker smoke。
- 真实备份恢复、对象恢复、RPO/RTO 和 rollback 演练。

Registry 恢复后的第一条安全命令：

```bash
docker pull node:24.18.0-bookworm-slim
```

拉取成功后按 [`docs/B8_09_STAGING_RUNBOOK.md`](docs/B8_09_STAGING_RUNBOOK.md) 重新运行 `npm run staging:release`，不得跳过 smoke 或 restore drill。

## 目录结构

```text
.
|-- src/                    # React 前端、路由、页面、store、API repository
|-- backend/
|   |-- src/                # NestJS API、Worker 和业务模块
|   |-- prisma/             # Schema、24 条 migration 和 seed
|   |-- scripts/            # 集成、数据、模型、UAT 与数据库工具
|   `-- test/               # 单元和 PostgreSQL 集成测试
|-- e2e/                    # Playwright 真实 API/Mock 验收
|-- deploy/
|   |-- model-services/     # 本地模型 Compose、锁和运行脚本
|   `-- staging/            # 18 服务 Staging、TLS、观测、备份和回退
|-- docs/                   # 架构、测试、B8、RC、UAT 和运行手册
`-- .github/workflows/      # Build/acceptance 与 CodeQL
```

模型权重、真实业务数据、`.realdata-test/`、上传目录、测试录像、`.env`、secret、证书和本地报告均不得提交。

## 关键文档

| 文档 | 用途 |
| --- | --- |
| [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md) | 分阶段实现记录 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 系统架构与边界 |
| [`docs/RELEASE_CANDIDATE_AUDIT.md`](docs/RELEASE_CANDIDATE_AUDIT.md) | RC 问题、修复和发布判断 |
| [`docs/B8_OVERNIGHT_EXECUTION_REPORT.md`](docs/B8_OVERNIGHT_EXECUTION_REPORT.md) | B8-09 与 RC-00 至 RC-04 执行证据 |
| [`docs/B8_BLOCKER_MATRIX.md`](docs/B8_BLOCKER_MATRIX.md) | P0/P1、外部阻断和人工门禁 |
| [`docs/PR4_REVIEW_GUIDE.md`](docs/PR4_REVIEW_GUIDE.md) | 独立 reviewer 检查顺序 |
| [`docs/B8_08_FINANCE_UAT_RUNBOOK.md`](docs/B8_08_FINANCE_UAT_RUNBOOK.md) | 财务八场景 UAT |
| [`docs/B8_09_STAGING_RUNBOOK.md`](docs/B8_09_STAGING_RUNBOOK.md) | Staging 发布、恢复和回退 |
| [`docs/B8_09_PILOT_DAILY_CHECKLIST.md`](docs/B8_09_PILOT_DAILY_CHECKLIST.md) | 有限试运行每日检查 |
| [`docs/MODEL_DEPLOYMENT.md`](docs/MODEL_DEPLOYMENT.md) | 本地模型部署和常驻/按需策略 |
| [`docs/E2E_ACCEPTANCE.md`](docs/E2E_ACCEPTANCE.md) | 浏览器验收范围和失败诊断 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 安全边界与运行要求 |

## 人工最短决策顺序

1. 基础设施负责人确定服务器、域名、registry、容量和正式 secret。
2. 运维/DBA 在目标环境完成 release、smoke、backup/restore、RPO/RTO 和 rollback。
3. 独立 reviewer 按 PR #4 和 Reviewer Guide 完成代码与安全审查。
4. 财务完成逐分对账、17 份 OCR 标签和 5 份盲测复核。
5. 财务与业务负责人签署入账粒度、负数/冲销/更正/关账和跨来源重复规则。
6. 老板或数据负责人签署 AI 标准问题、允许数据范围和外部 AI 政策。
7. 财务、业务、老板、安全和项目负责人基于全部证据决定是否进入有限试运行。

任何一项未满足时，系统只能用于隔离开发、工程验收或人工辅助，不得用于无人监督的正式财务入账。

## 发布边界

只有同时满足以下条件，才能讨论有限试运行：

- 真实 Staging 容器全部启动并通过 TLS/readiness/smoke。
- 真实 PostgreSQL 与对象存储备份恢复、RPO/RTO 和 rollback 演练通过。
- 财务逐分对账完成，差异为 0 或全部形成已关闭的问题单。
- OCR 标签和盲测冻结，准确率、拒识率和人工复核阈值由授权人员确认。
- 老板 AI 标准问题、数据来源和外部数据政策验收通过。
- 跨来源重复、负数、冲销、更正、作废和关账规则完成签字。
- 独立代码/安全 Review 与最终 UAT 签字完成。

即使所有自动化测试和 GitHub CI 全绿，也不能宣布“已经生产就绪”。在真实 Staging、恢复演练、安全复核、财务真值、OCR/AI 真值和人工签字全部完成前，发布状态保持 `blocked_external` 或 `awaiting_human_signoff`。

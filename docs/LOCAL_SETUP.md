# 本地开发环境

更新日期：2026-07-20

本项目使用两个独立 PostgreSQL 数据库：

- `finance_agent_dev`：本地开发库。
- `finance_agent_test`：自动化测试库；初始化脚本拒绝数据库名不以 `_test` 结尾的连接。

当前开发机已安装 PostgreSQL 17，Windows 服务名为 `postgresql-x64-17`。数据库密码只保存在被 Git 忽略的环境文件中。

## 1. 启动 PostgreSQL

Windows PowerShell：

```powershell
Get-Service postgresql-x64-17
Start-Service postgresql-x64-17
```

首次安装可通过 pgAdmin 或 `psql` 创建空数据库：

```sql
CREATE DATABASE finance_agent_dev;
CREATE DATABASE finance_agent_test;
```

macOS/Linux 可使用系统包管理器或 PostgreSQL 容器，数据库名仍保持 `_dev` / `_test` 后缀。

## 2. 创建环境文件

Windows：

```powershell
Copy-Item .env.example .env.local
Copy-Item backend/.env.example backend/.env
Copy-Item backend/.env.test.example backend/.env.test
```

跨平台 shell：

```bash
cp .env.example .env.local
cp backend/.env.example backend/.env
cp backend/.env.test.example backend/.env.test
```

必须替换：

- `backend/.env` 的 `DATABASE_URL` 指向 `finance_agent_dev`。
- `backend/.env.test` 的 `DATABASE_URL` / `TEST_DATABASE_URL` 指向 `finance_agent_test`。
- 两个文件分别使用至少 32 字符、非示例值的 `JWT_SECRET`。
- 生产环境必须显式配置精确的 `CORS_ORIGINS`。
- `AI_INGESTION_MODE`、`AI_REPORT_MODE` 缺失时默认 `disabled`，只允许 `disabled|suggest`；不要添加自动批准或自动入账模式。
- `AI_GLOBAL_KILL_SWITCH=true` 会阻止所有新 AI 调用；`AI_EXTERNAL_PROVIDER_MODE=disabled` 在 H12 批准前不得放宽真实数据外发。

真实 `.env`、密码、API key、上传文件、模型目录和真实样本不得提交到 Git。

## 3. 安装依赖

```powershell
npm ci
npm ci --prefix backend
```

没有 lockfile 变更需求时优先使用 `npm ci`；只有明确升级依赖时才使用 `npm install`。

## 4. 初始化开发库

```powershell
cd backend
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run db:verify
cd ..
```

开发 seed 会恢复八个演示账号的密码和 active 状态，只允许 `_dev` / `_test` 数据库，且在 `NODE_ENV=production` 时拒绝运行。生产只运行 `prisma:migrate:deploy`，不运行 seed 或 `prisma migrate dev`。

## 5. 启动 API 模式

根目录 `.env.local`：

```env
VITE_APP_DATA_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_API_TIMEOUT_MS=15000
```

终端 1：

```powershell
cd backend
npm run dev
```

终端 2：

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

访问前端 `http://127.0.0.1:5173`，Swagger 为 `http://127.0.0.1:3001/api/docs`。

## 6. Smoke Test

PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
Invoke-RestMethod http://127.0.0.1:3001/api/health/ready
```

跨平台：

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/health/ready
```

就绪响应应包含 `data.status=ok` 和 `data.database=ok`。再用 `employee/123456` 登录，确认请求由 `/api/auth/login` 返回真实 Token，而非 Mock 标识。

## Mock 模式

仅演示前端时设置：

```env
VITE_APP_DATA_MODE=mock
```

Mock 模式不需要 PostgreSQL 或后端；API 模式失败不会自动回退 Mock。

## 测试与构建

```powershell
npm run build
npm run build --prefix backend
npm test --prefix backend
npm run test:integration --prefix backend
npm run test:e2e
npm run check:hygiene
```

`test:integration` 和 `test:e2e` 会对专用测试库执行 generate、`migrate deploy`、seed 和精确测试数据清理。脚本检测到非 `_test` 数据库会立即终止。

当前 M8 收口证据：前端/后端 build 通过，后端 47/47 suites、410/410 tests，PostgreSQL 10/10 suites、97/97 tests，Playwright 17/17，Prompt 漂移 4/4 unit + 3/3 PostgreSQL，41 条 migration 空库与 40→41 升级通过。

## 模型与 OCR

普通开发和全部自动化验收使用：

```env
AI_PROVIDER=mock
OCR_PROVIDER=mock
AI_INGESTION_MODE=disabled
AI_REPORT_MODE=disabled
AI_GLOBAL_KILL_SWITCH=false
AI_EXTERNAL_PROVIDER_MODE=disabled
```

普通开发和自动化验收无需启动模型。当前 `model` 目录中的 Qwen 文本、PaddleOCR、Qwen3-VL 和 Embedding 权重均已通过只读完整性校验；文本与 OCR 常驻，VL 与 Embedding 默认按需离线。资产完整和健康不代表真实业务准确率达标。

模型环境初始化和校验：

```powershell
npm run model:init
npm run model:check
```

Docker Desktop 与 WSL 2 安装完成后，文本模型和 OCR 常驻启动：

```powershell
npm run model:resident
npm run model:status
```

Embedding/VL 使用 `npm run model:on-demand -- <embedding|vl>`，任务完成后必须执行 `npm run model:restore`。真实 Paddle/Qwen 接入、密钥同步、路由启用和显存验收见 `docs/MODEL_DEPLOYMENT.md`；不要移动或提交用户模型目录。

查看当前常驻状态：

```powershell
npm run model:status
```

AI 建议默认关闭。仅在合成/匿名开发数据且财务仍人工批准时，才可把对应模式改为 `suggest`；前端参数不能扩大服务端模式。外部 Provider 未经 H12 批准不得接收真实或未知数据。

## 常见问题

- `JWT_SECRET` 报错：替换示例值并确保长度至少 32 字符。
- `CORS_ORIGINS` 报错：只填写逗号分隔的 Origin，例如 `http://127.0.0.1:5173`，不要带路径。
- readiness 503：确认 PostgreSQL 服务、连接串、数据库和 migration 状态。
- 测试拒绝数据库：确认测试 URL 的数据库名以 `_test` 结尾。
- 429：开发默认每 IP 每分钟 600 次；测试配置为 5000 次。生产多副本需要共享限流。
- 前端 bundle 警告：当前为非阻断警告，后续通过路由懒加载和拆包处理。

# GitHub PR 准备

更新日期：2026-07-14

## 建议 PR

标题：

```text
feat: complete real API migration and guarded local model runtime
```

本地 `main` 当前包含既有 `process 4` 至 `process 8` 提交，并在其上存在批次 A-H 的未提交改动。远程 `origin/main` 当前停在 `process 3`。在用户明确确认前，不 push、不创建 PR、不 merge。

## 完成内容

- PostgreSQL dev/test 可重复初始化，Prisma schema、14 个 migration、seed 和结构核对通过。
- 前端所有 C-1 至 C-11 领域完成显式 Mock/API Repository，API 错误不回退 Mock。
- 工单完整审批、文件、通知、规则、confirmed 经营记录、报表和老板结构化 AI 工具形成真实闭环。
- 阶段 9/B2 支持真实 `.xlsx` 与隔离转换 `.xls` 上传、解析、映射、错误行隔离、字段建议和幂等事务确认。
- 阶段 10 支持 OCR Task、Provider、证据/置信度、纠错、重试和幂等确认入库。
- 模型运行时提供部署/路由登记、健康检查、Schema、超时、重试、熔断、并发和安全日志；真实模型默认 disabled。
- 本地权重校验、PaddleOCR-VL 适配器、文本/OCR 常驻编排和 VL/Embedding 按需切换已实现；WSL 2/Docker 尚未安装，真实推理未验收。
- CI、CORS、Helmet、请求/登录限流、就绪探针、结构化日志、生产 Swagger 开关、仓库卫生检查和文档完成。

## Migration

本分支相对 `process 3` 包含阶段 4-10 和安全增强 migration。当前完整目录共 14 个；新增环境必须执行：

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
```

Migration 是前向、非破坏性建表/加字段流程。不要在生产使用 `prisma migrate dev`，不要运行开发 seed。

## 环境变量

必须：`DATABASE_URL`、`JWT_SECRET`、`PORT`。生产必须显式提供 `CORS_ORIGINS`。

运行安全：`NODE_ENV`、`SWAGGER_ENABLED`、`TRUST_PROXY_HOPS`、`REQUEST_RATE_LIMIT_WINDOW_MS`、`REQUEST_RATE_LIMIT_MAX`、`UPLOAD_DIR`、`MAX_FILE_SIZE_MB`。

AI/OCR：`AI_*`、`OCR_*`、`MODEL_*`、`AI_MAX_CONCURRENCY`、`OCR_MAX_CONCURRENCY`。默认 `AI_PROVIDER=mock`、`OCR_PROVIDER=mock`，无需 GPU。

测试：`TEST_DATABASE_URL` 必须指向名称以 `_test` 结尾的专用数据库。完整清单见 `backend/.env.example`、`backend/.env.test.example` 和 `docs/LOCAL_SETUP.md`。

## 测试证据

2026-07-12 本地：

- 前端 production build：通过；保留 bundle 大于 500 kB 的非阻断警告。
- 后端 production build：通过。
- 后端单测：11 suites，64 tests，通过 64，失败 0。
- PostgreSQL 集成：1 suite，24 tests，通过 24，失败 0。
- Playwright：12 tests，通过 12，失败 0；teardown 精确清理工单、导入/OCR任务、记录和文件。
- Prisma format/validate/generate/migrate status/db:verify：通过；40 张业务表，无缺失/意外表。
- PaddleOCR 适配器纯逻辑：4 tests，通过 4，失败 0。
- 模型资产：文本、OCR、Embedding 通过；VL 缺失分片按预期被拒绝。
- 仓库卫生：370 个 tracked/candidate 文件通过。
- 生产依赖审计：高危/严重 0；已知中等级风险见 `docs/SECURITY.md`。

## 手工验收

1. 按 `docs/LOCAL_SETUP.md` 初始化 dev/test 数据库并启动前后端 API 模式。
2. 用八个中英文账号登录；验证错误密码、停用账号、登出后旧 Token。
3. employee 创建并提交工单，finance/reviewer/boss 完成审批，确认生成 confirmed 经营记录、时间线、通知和报表。
4. finance 上传合成 Excel，检查映射、错误行和合法行入库；重复确认不得重复生成记录。
5. finance 上传合成 PDF，检查 OCR 证据、修改字段、确认入库；确认前不得出现经营记录。
6. 检查 `/api/health/ready`、允许/拒绝 Origin、安全头、Swagger 开关及非授权 401/403。

## 兼容性

- 前端仍支持 `VITE_APP_DATA_MODE=mock`，无数据库演示不受影响。
- 成功/错误继续使用 `{ code, message, data }`，现有 `src/api` 类型保持兼容。
- OCR 同时保留 `/api/ocr-tasks` 和 `/api/ocr/tasks` 路由别名。
- 开发文件仍可本地存储；生产对象存储尚未实现。

## 回滚

- 应用回滚：部署上一个镜像/提交；旧代码应忽略新增表和可空字段。
- 数据库不建议自动向下 migration。上线前做快照；发生问题时先停止写流量、回滚应用，再按已验证备份恢复方案处理数据库。
- 导入/OCR/审批产生的数据通过审计、ledger 和 source/idempotency 标识定位；不要直接删除生产审计链。
- 新模型路由可先设为 disabled，不影响 Mock 和非模型核心业务。

## 保留项

- 真实 Paddle/Qwen 未在 GPU 上启动或压测，准确率未声明达标。
- Qwen3-VL 缺少 `model-00003-of-00004.safetensors`，启动前校验会拒绝不完整权重。
- 企业 Excel 格式、票据类型、字段真值、审批阈值和老板问题集需要脱敏真实数据校准。
- 对象存储、病毒扫描、共享限流、监控告警、密钥托管和生产备份仍是上线任务。

## 建议提交拆分

由于阶段 4-8 已有独立提交，当前未提交批次建议按可审查边界拆分：

1. `feat: connect frontend domains to real PostgreSQL APIs`
2. `test: add PostgreSQL and dual-mode Playwright acceptance`
3. `feat: add transactional Excel import workflow`
4. `feat: add OCR task and human-review framework`
5. `feat: add guarded local model runtime adapters`
6. `chore: harden runtime, CI, and delivery documentation`

拆分时只暂存本项目实现文件；用户模型目录、下载脚本、真实 `.env`、上传物和样本不得进入提交。

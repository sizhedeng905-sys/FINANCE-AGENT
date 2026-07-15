# E2E 验收说明

更新日期：2026-07-15

## 目标

批次 D 使用真实 PostgreSQL、真实 NestJS API 和 Playwright 浏览器测试，证明权限、状态机、数据生成和错误体验可重复验收。Mock 模式只由 `VITE_APP_DATA_MODE=mock` 显式启用，API 失败不会回退 Mock。

## 安全边界

- E2E 只接受数据库名以 `_test` 结尾的 `TEST_DATABASE_URL` 或 `DATABASE_URL`。
- `backend/scripts/prepare-e2e.mjs` 按 generate、migrate deploy、清理 E2E 数据、seed 的顺序初始化。
- E2E 数据的工单说明、Excel 和 OCR 文件名统一以 `E2E ` 开头；全局 teardown 只清理对应工单、导入/OCR任务、生成记录、审计、ledger 和测试文件。
- 测试上传目录固定在 `backend/test-uploads/e2e` 并被 Git 忽略。
- teardown 即使数据库中没有匹配行，也会在确认目录位于 `backend/test-uploads` 的专用子目录后清理残留文件，避免数据库提前返回留下磁盘孤儿。
- 测试单 worker 执行，测试场景不依赖其他测试产生的数据。

## 本地运行

先从示例创建 `backend/.env.test`，替换数据库密码和测试 JWT secret，并确认数据库名以 `_test` 结尾：

```powershell
Copy-Item backend/.env.test.example backend/.env.test
npm install
npm install --prefix backend
npm run test:e2e
```

有界面调试：

```powershell
npm run test:e2e:headed
```

只运行完整审批链：

```powershell
npm run test:e2e -- e2e/core-workflow.spec.ts
```

失败时查看 `test-results/` 截图和 trace，或运行：

```powershell
npx playwright show-trace test-results/<case>/trace.zip
```

## 自动化覆盖

后端真实 PostgreSQL 集成测试共 30 条，覆盖：

- 四角色权限、员工资源归属、finance/boss 管理边界；
- 无 Token、伪造 Token、过期 Token、旧 `tokenVersion`、停用和登出失效；
- 身份字段伪造、合法/非法状态跳转、补充材料、重复和并发终审；
- 动态字段类型、模板归属、项目归档、幂等和事务回滚；
- 文件签名/MIME/扩展名/大小、归属授权和原件保留；
- confirmed 报表口径、北京时间边界及 AI 工具一致性。
- 真实 `.xlsx`、隔离 `.xls`、Sheet/合并表头、公式缓存、媒体流式隔离、字段建议/Profile、错误行部分成功、并发确认和项目结构统计。
- 合成 PDF、OCR低置信度、纠错证据、未确认不入库、失败重试、并发确认和项目结构统计。
- 模型 deployment/route 只暴露安全元数据，权限边界和显式健康检查。

Playwright 共 14 条，覆盖：

- employee、finance、reviewer、boss 真实登录及默认首页；
- 员工创建提交、财务通过、复核并自动规则检查、老板终审；
- 终审生成 confirmed BusinessRecord，数据中心和老板日报可见；
- 401 自动清理会话、网络错误显示 requestId、客户端 403 页面；
- Mock 模式明确显示且后端请求数为 0。
- 财务真实上传 `.xlsx`、人工忽略未知列、错误行隔离、合法行入库及本月报表可见。
- 财务在含媒体 XLSX 中看到隔离提示，并显式授权公式缓存后解析。
- 财务真实上传 PDF、读取 OCR 证据、人工修改金额、确认后生成 OCR 来源经营记录。
- CORS 白名单、拒绝未知 Origin、安全响应头和 PostgreSQL readiness。

## CI

`.github/workflows/ci.yml` 的 `postgres-e2e` job 提供 PostgreSQL 17 service。该 job 依次执行仓库卫生/高危依赖检查、Prisma format/validate/generate/migrate/status/结构核对、前后端构建、后端单测、真实数据库集成测试和 Playwright Chromium E2E；失败时上传 7 天保留的截图、HTML 报告和 trace。

## 当前证据

2026-07-15 B7 本地验收结果：

- 前端 build：通过；
- 后端 build：通过；
- 后端单测：17 suites，183 tests，失败 0；
- PostgreSQL 集成：1 suite，30 tests，失败 0；
- Playwright：14 tests，失败 0；
- E2E teardown：测试数据库和 `backend/test-uploads/e2e` 均为 0 残留；
- Prisma：18 个 migration，40 张预期业务表，无缺失或意外表；
- 仓库卫生：424 个 tracked/candidate 文件通过；
- 根目录和后端生产依赖审计：0 vulnerabilities。

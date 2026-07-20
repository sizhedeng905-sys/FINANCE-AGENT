# E2E 验收说明

更新日期：2026-07-20

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

后端真实 PostgreSQL 集成测试为 10/10 suites、97/97 tests，覆盖：

- 四角色权限、员工资源归属、finance/boss 管理边界；
- 无 Token、伪造 Token、过期 Token、旧 `tokenVersion`、停用和登出失效；
- 身份字段伪造、合法/非法状态跳转、补充材料、重复和并发终审；
- 动态字段类型、模板归属、项目归档、幂等和事务回滚；
- 文件签名/MIME/扩展名/大小、归属授权和原件保留；
- confirmed actual 报表口径、北京时间边界、Decimal 分币种、canonical ReportSnapshot/source hash、严格 AI Claim 和并发快照复用；
- 真实 `.xlsx`、隔离 `.xls`、Sheet/合并表头、公式缓存、媒体流式隔离、字段建议/Profile、AI 列映射、revision/revalidate、阻断错误整批失败关闭、双人批准和项目结构统计；
- 4,999/5,000/5,001/30,196/49,999/50,000/50,001 行、服务端分页、响应体预算、Worker crash/lease 接管和原子发布；
- 合成 PDF、OCR IR/page/token/bbox、AI evidence mapping、人工 override、旧 ValidationSnapshot 失效、自审批拒绝、权限撤销、失败重试和并发批准；
- 模型 deployment/route/prompt/version vector 只暴露安全元数据，外部真实数据失败关闭，kill switch、超时、截断 JSON 和注入输出不生成正式记录或 Narrative；
- 文件大小上限减一/恰好/超一字节、低磁盘 507、隔离区/对象残留、幂等重放、通知 outbox 和 retention dry-run。

Playwright 共 17 条，覆盖：

- employee、finance、reviewer、boss 真实登录及默认首页；
- 员工创建提交、财务通过、复核并自动规则检查、老板终审；
- 终审生成 confirmed BusinessRecord，数据中心和老板日报可见；
- 401 自动清理会话、网络错误显示 requestId、客户端 403 页面；
- Mock 模式明确显示且后端请求数为 0。
- 财务真实上传 `.xlsx`，任何阻断行错误都不能部分入账；预览只加载当前服务端页；
- 财务在公式 XLSX 中显式授权缓存证据，另一名财务重新校验并批准；旧 `.xls` 走隔离转换；
- 财务真实上传 PDF，在原件画布/bbox 证据上修改 OCR 字段，另一名财务批准后才生成经营记录；
- 老板报告展示 canonical Snapshot、source digest、warning、Provider/Prompt 和逐条 `sourcePath`；
- CORS 白名单、拒绝未知 Origin、安全响应头和 PostgreSQL readiness。

## CI

`.github/workflows/ci.yml` 的 `postgres-e2e` job 提供 PostgreSQL 17 service。该 job 依次执行仓库卫生/高危依赖检查、Prisma format/validate/generate/migrate/status/结构核对、前后端构建、后端单测、真实数据库集成测试和 Playwright Chromium E2E；失败时上传 7 天保留的截图、HTML 报告和 trace。

## 当前证据

2026-07-20 M7 全量与 M8 收口验收结果：

- 前端 build：通过；
- 后端 build：通过；
- 后端单测：47 suites，410 tests，失败 0；
- PostgreSQL 集成：10 suites，97 tests，失败 0；
- Playwright：17 tests，失败 0；
- E2E teardown：测试数据库和 `backend/test-uploads/e2e` 均为 0 残留；
- Prisma：41 个 migration，空库和 40→41 升级通过，222 个索引、89 个外键；
- Prompt Registry 漂移：4/4 unit 与空库 41 migration 后 3/3 PostgreSQL 通过；
- 仓库卫生：708 个 tracked/candidate 文件通过；
- 根目录和后端生产依赖审计：0 vulnerabilities。

# CR-046 Dependency install and runtime image hardening

## 目标

刷新无已知公告的补丁级依赖，显式约束 npm install scripts，并让后端运行镜像只从一次干净的 production dependency install 构建，避免 `npm prune` 留下开发依赖或未经复核的生命周期脚本。

## 起始事实

- 基线 SHA：`c861197`。
- 根目录与后端 `npm audit` 在修改前均无已知漏洞；本 CR 不是由高危公告驱动，不升级 major。
- npm lockfile 中存在 Prisma、esbuild、Scarf 和 `fsevents` 等带 install script 的包，但仓库没有把批准/拒绝决定做成可审查、可漂移检测的契约。
- 后端镜像原来先安装全部依赖，再执行 `npm prune --omit=dev`；本机镜像构建显示 prune 阶段会重新评估生命周期脚本，边界不够清晰。

## 修改范围

### 补丁级依赖

- 根目录 lockfile：`@types/node` 22.20.0 → 22.20.1。
- 后端 lockfile：`@nestjs/swagger` 11.4.5 → 11.4.6、`ajv` 8.18.0 → 8.20.0、`helmet` 8.1.0 → 8.3.0、`ts-jest` 29.4.11 → 29.4.12、`tsx` 4.23.0 → 4.23.1，并接受 lockfile 解析出的安全传递依赖补丁。
- 不升级 major，不修改 SheetJS 固定来源，不为“追新”扩大运行时行为范围。

### Install script 策略

- 根目录只精确批准 `esbuild@0.25.12`，拒绝 `fsevents`。
- 后端只精确批准 Prisma 6.19.3 的 client/engines/CLI 与 `esbuild@0.28.1`，拒绝 `@scarf/scarf` 和 `fsevents`。
- 新增静态检查器：所有 lockfile `hasInstallScript` 包必须被覆盖；批准必须精确到当前版本；过期、冲突、非布尔决定失败关闭；Scarf/`fsevents` 不能被批准。
- CI 在依赖风险门禁中执行该检查；npm 自身的 allowScripts 在安装时执行决定，检查器负责发现 policy/lockfile 漂移。

### 后端镜像

- build stage 保留完整依赖完成 TypeScript/Prisma 构建。
- 新增独立 `production-dependencies` stage，执行干净的 `npm ci --omit=dev` 与 Prisma Client 生成。
- runtime 只复制生产依赖、构建产物与 Prisma 资产；仍删除 npm/npx/corepack，并以 UID/GID 10001 运行。

## Schema、API、UI 与财务影响

- Schema/migration：无变化，仍为 51 个 migration。
- API/UI：无字段、路由或交互变化。
- 财务金额、审批、幂等、正式写库和报告口径：无变化。
- 周五 Demo：功能路径不变；全量浏览器 E2E 和 Demo 用例重新通过。

## 攻击与边界检查

- 未批准的新 install script、模糊包名批准、旧版本批准、批准/拒绝冲突和 Scarf 放行均有自动失败断言。
- 根目录和后端分别执行干净 `npm ci`；`npm approve-scripts --allow-scripts-pending` 均无未复核脚本。
- 后端运行镜像中不存在 npm、npx 或 corepack；Node、OpenSSL、Prisma schema 和编译产物可用，进程用户不是 root。
- 本地应用镜像完整性脚本通过 17 个身份、用户、标签和运行时边界用例；扫描被显式 defer，没有冒充 CVE 扫描通过。
- Docker Scout 的本地 CVE 扫描需要 Docker ID 登录，本轮不读取或请求用户凭据；同 SHA Syft/Grype 必须由远端 CI 给出。
- 真实 Staging 日志检查会读取目标 `.secrets` 并抓取真实容器日志；没有目标环境授权时只运行 4 个脱敏策略测试，不执行实机检查，不声明真实日志通过。
- 临时 Redis 固定到已批准 digest且只绑定 `127.0.0.1:6379`，全量集成结束后已删除；用户常驻 Qwen/OCR 容器未改动。

## 测试证据

| 状态 | 命令/场景 | 结果 |
| --- | --- | --- |
| `PASS` | 根目录 `npm ci` | 149 packages；0 vulnerabilities |
| `PASS` | `cd backend && npm ci` | 622 packages；0 vulnerabilities；仅既有传递依赖弃用提示 |
| `PASS` | `npm run check:install-scripts:test` | 7/7 |
| `PASS` | `npm run check:install-scripts` | frontend 3 个脚本包（1 批准/2 拒绝）；backend 6 个（4 批准/2 拒绝） |
| `PASS` | 根目录与后端 `npm audit` / `npm audit --omit=dev` | 四次均 0 vulnerabilities |
| `PASS` | `npm run build` | 前端 TypeScript 与 Vite production build 通过 |
| `PASS` | `cd backend && npm run build` | Prisma 6.19.3 generate 与两套 TypeScript build 通过 |
| `PASS` | `cd backend && npm test` | 51/51 suites；473/473 tests；约 22.6 秒 |
| `PASS` | 带本机 Redis 的 `cd backend && npm run test:integration` | 14/14 suites；125/125 tests；338.072 秒 |
| `PASS` | `npm run test:e2e` | 22/22；约 1.4 分钟 |
| `PASS` | install policy / runtime config / SBOM / log policy | 7/7、4/4、7/7、4/4 |
| `PASS` | 后端与前端 Docker build | 两个应用镜像均构建成功；后端 production install 无未批准脚本提示 |
| `PASS_WITH_SCAN_DEFERRED` | `npm run staging:image-integrity:test -- --defer-scan --retain-fixtures` | 17 个运行时/身份用例通过；约 183.4 秒；fixture 随后清理 |
| `PASS` | `npm run check:docs` / `npm run check:hygiene` / `git diff --check` | 141 files/217 links；863 candidates；无 diff error |
| `BLOCKED_EXTERNAL` | 本地 Docker CVE scan | Docker Scout 要求 Docker ID；未登录、未伪造通过 |
| `BLOCKED_EXTERNAL` | `npm run staging:logs:check` | 缺真实目标 Staging 授权；未读取目标 secrets 或声明通过 |

第一次强制 Redis 集成运行没有提供 `TEST_REDIS_URL`，因此 11 个 PostgreSQL suite/111 tests 通过、3 个 Redis suite 在收集阶段失败；补齐 loopback URL 后先定向通过 3 suites/14 tests，最终又执行一次单命令全量集成并取得上表 `14/14、125/125` 结果。该配置失败保留在证据中，不用后续绿色结果抹去。

一次未带测试环境的只读 `db:verify` 命中了本地开发库并发现其缺少后 10 张表；没有执行 migration、seed 或写操作。该本地开发库状态不属于本 CR 通过证据，所有正式数据库回归均由脚本限制在 `finance_agent_test`。

## 限制

- push 前没有本 CR 同 SHA 的 Syft/Grype、CodeQL 或远端 PostgreSQL/Redis/E2E 证据。
- `npm audit` 只表示查询时 registry 报告 0 个已知漏洞，不证明不存在未知供应链风险。
- 本 CR 不证明真实 target Staging、真实日志、registry 签名或生产部署可用。
- PR #4 必须继续保持 Draft；三次人工 Demo 彩排和 owner UAT 仍为 `NOT_RUN`。

## 回滚

仅使用 `git revert <sha>`。回滚会恢复旧 lockfile、移除 install-script 漂移门禁并恢复 prune 型镜像构建；不涉及数据库回滚。回滚后至少重跑两次 `npm ci`、前后端 build、后端单元/集成、浏览器 E2E、应用镜像构建和依赖审计。

## 下一步

1. 正常 push CR045/CR046，观察 CR046 同 SHA 的 Build and acceptance、应用镜像 Syft/Grype 与 CodeQL。
2. 同 SHA 远端通过后，执行最终 Friday Demo reset/test/verify 并冻结稳定检查点。
3. 更新 Draft PR 和夜间功能总述；真实 Staging 日志、签名和目标环境继续标记外部阻塞。

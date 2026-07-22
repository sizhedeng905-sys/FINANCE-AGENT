# CR-010：移除后端运行镜像中的无用包管理器

## 1. 提交目的

恢复应用容器供应链门禁：后端最终运行镜像不再携带仅构建阶段需要的全局 npm、npx 和 Corepack，同时保留 Node.js、OpenSSL、应用入口以及项目内 Prisma CLI 的运行能力。

## 2. 范围与非范围

本提交只调整后端 runtime image、Staging migration 命令、CI 镜像断言和对应契约测试。build stage 继续使用 npm 安装和构建依赖；运行时迁移改为显式调用 `./node_modules/.bin/prisma`。

本提交不修改业务依赖版本、数据库 Schema、AI registry、业务状态机、权限、财务口径或前端功能；不降低 Grype 阈值，不增加漏洞 allowlist，也不把当前扫描结果描述为永久无漏洞。

## 3. 修改文件

- `backend/Dockerfile`：runtime stage 创建非 root 用户前删除全局 npm/Corepack 目录及 npm、npx、corepack 命令入口。
- `deploy/staging/compose.yaml`：migration service 直接调用项目内 Prisma CLI。
- `.github/workflows/ci.yml`：验证 entrypoint、运行用户、包管理器缺失、Node/OpenSSL/Prisma 和三个编译入口。
- `backend/test/ci-gates.spec.ts`：锁定 Dockerfile 与 CI 的供应链断言。
- `backend/test/staging-deployment.spec.ts`：禁止 Staging 迁移重新引入 `npx prisma`。
- `README.md`、`NEXT_TODO.md`、汇报与审查索引：更新真实进度和下一检查点。

## 4. 数据与状态机影响

没有 migration、数据回填或状态机变化。Prisma migration 的实际命令及执行顺序保持不变，仅从 npm 的 npx 分派改为直接执行已经复制进镜像的项目内二进制。

## 5. API 与权限影响

没有新增或修改 HTTP API、DTO、角色或授权规则。后端容器仍通过既有 `backend-entrypoint` 以 UID/GID `10001:10001` 启动；前端、财务审批和 AI 建议权限边界不变。

## 6. 安全与隐私影响

CR-009 SHA `7a0fded` 的 SBOM 证明 fixable Critical 来自 Node 基础镜像自带的全局 npm 依赖树，而非业务 lockfile：`tar 7.5.15`、`undici 6.26.0` 和 `brace-expansion 5.0.6`。运行镜像不需要 npm 执行应用，因此最小修复是缩小运行面，不是忽略扫描结果。

新镜像 SBOM 包含 433 个组件、0 个 npm CLI 组件；旧全局 npm 中的三个命中不再存在。镜像仍是 digest-pinned 基础链、固定 OpenSSL 包版本、非 root 用户和不可变 revision。未读取或提交 `.env`、Token、真实业务文件、模型权重或原始扫描正文。

## 7. 测试证据

- 失败基线：新增断言后定向测试为 2 suites 中 2 tests 失败，分别证明 runtime image 未删除包管理器、Staging 仍使用 `npx prisma`。
- `npm test -- --runTestsByPath test/ci-gates.spec.ts test/staging-deployment.spec.ts`：PASS，2 suites / 19 tests，2.88 秒。
- `npm test`：PASS，50 suites / 464 tests，23.038 秒。
- 强制 Redis 的 `npm run test:integration`：PASS，14 suites / 124 tests，Jest 306.838 秒；30,196 行和 49,999 行边界均实际执行。
- `npm run db:migration-paths`：PASS，空库 43 migrations 与 42 到 43 升级；48 tables、34 enums、224 indexes、89 foreign keys。
- `npm run system:acceptance`：PASS，43 migrations、并发 bootstrap、11/1/7/1 系统计数、Mock/API/Worker/漂移拒绝全部通过。
- 根目录及后端 `npm run build`：PASS；`npm run test:runtime`：PASS，4/4；`npm run staging:config:test`：PASS，3/3。
- `npm run test:e2e`：PASS，17/17，57.4 秒；使用真实 API 和隔离 PostgreSQL，teardown 清理成功。
- 根目录及后端 `npm audit --omit=dev --audit-level=high`：PASS，均为 0 vulnerabilities。
- 本地镜像构建：PASS，69.3 秒；identity 为用户 `10001:10001`、revision `cr010-local-supply-chain`、entrypoint `backend-entrypoint`。
- 镜像内 Node `v24.18.0`、OpenSSL `3.0.20`、Prisma `6.19.3`、Schema validate 及 `main/worker/system-bootstrap` 语法检查均通过；npm、npx、corepack 均不可用。
- 固定 Syft `1.44.0` 重新生成 SBOM；固定 Grype 镜像首次因本地数据库超过 5 天失败，未降低门槛；使用隔离的新数据库重跑后 PASS，`No vulnerabilities found`。
- CR-009 远端 Build run `29821449158`：PostgreSQL/E2E job 成功，容器 job 仅在上述 fixable-Critical gate 失败；CodeQL run `29821448996` 成功。
- CR-010 SHA `1abe513b0392e367dc4242930a6022dbf4e7bc8e`：Build run `29823851399` 两个 job 全部成功，包含新 runtime 断言、应用 SBOM、fixable Critical gate、14/124 PostgreSQL/Redis 和 17/17 Playwright；CodeQL run `29823851377` 成功。

## 8. 新增边界与攻击用例

- Dockerfile 必须显式删除全局 npm/Corepack 目录及命令入口，防止基础镜像更新后意外重新暴露包管理器。
- CI 通过默认 entrypoint 执行运行时检查，避免用覆盖 entrypoint 的方式绕过非 root 初始化边界。
- CI 同时验证 `npm`、`npx`、`corepack` 不可调用，而 Node、OpenSSL、项目内 Prisma 和编译入口仍可用。
- Staging 契约拒绝任意 `npx prisma` 回归，migration、runtime grants、system bootstrap 和受控 seed 顺序保持锁定。
- SBOM/Grype 使用现有 fixable Critical 规则，无新增过滤、阈值下降或 allowlist。

## 9. 迁移、部署与回滚

没有数据库 migration。部署仍按既有顺序运行项目内 Prisma migration、runtime grants、system bootstrap、受控合成 seed，再启动 API/Worker。运行镜像不提供交互式 npm 运维能力；临时排障也应使用构建镜像或明确的运维镜像，而不是把包管理器重新放回生产运行镜像。

如需回滚，回退本提交的镜像、Compose 和 CI 契约即可；不会回滚数据库或业务数据。回滚会重新暴露已知 fixable Critical，因此只能作为诊断动作，不能作为可发布状态。

## 10. 已知限制与剩余任务

- 本地扫描只证明当前构建和当时漏洞数据库的结果；最终门禁以 CR-010 新 SHA 的 GitHub CI 为准。
- 基础镜像与 OS 包仍需持续扫描，未来 CVE 需要按新证据处理。
- 目标 Linux Staging、恢复演练、真实财务/OCR/AI 真值和 owner UAT 仍未关闭。
- 下一主题是周五演示级“Excel 到确定性经营报告”E2E，之后才进入 Excel AI 前端建议桥接。

## 11. 审查者检查清单

- [ ] build stage 仍可使用 npm，runtime stage 不含 npm/npx/Corepack
- [ ] Staging migration 只调用 `./node_modules/.bin/prisma`
- [ ] 镜像用户为 `10001:10001`，revision 与 entrypoint 可追溯
- [ ] Node、OpenSSL、Prisma、API/Worker 编译入口保持可运行
- [ ] SBOM 不再包含基础镜像全局 npm 的三个已知命中
- [ ] Grype 阈值、allowlist 和扫描范围没有降低
- [ ] 无 migration、业务状态、权限或 AI registry 混入
- [ ] `.env`、模型、真实数据和受保护未跟踪资产未进入提交
- [ ] 本地全量门禁和新 SHA 远端 Build/CodeQL 分开记录
- [ ] Draft PR 保持 Draft，不 merge、不标记 Ready

## 12. 状态

`ENGINEERING_VERIFIED`。本地构建、测试、镜像结构、SBOM 与 fixable Critical 扫描，以及同一新 SHA 的 GitHub Build/CodeQL 均成功，供应链红灯已关闭。目标 Staging、真实样本、恢复和 owner UAT 仍不在此状态声明内。

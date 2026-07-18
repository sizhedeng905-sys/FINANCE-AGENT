# R8.1 应用容器 CI 与供应链报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

基线 HEAD：`ce943f306c7905df1d0db450cfc11ce7293668e7`

## 结论

R8.1 已完成本地工程验收：普通 CI 不再只编译 Node 工程，而会真实构建后端与显式 API 前端镜像，核对运行用户和 Git revision，为两个实际镜像生成 SPDX SBOM，并使用固定 Grype scanner/数据库执行“无可修复 Critical”门禁。

本报告不表示当前 commit 已在 GitHub runner 通过，也不表示完整 Staging、恢复、回滚或生产发布通过。前者要在 push 后取得 workflow 证据，后者属于 R8.2、R9 和 H13/H14。

## 失败复现

新增 `backend/test/ci-gates.spec.ts` 后首次执行结果为 3/3 失败：

- CI 仍使用 Node 22，Dockerfile 使用 Node 24.18.0；
- CI 中不存在真实后端/前端镜像构建 job；
- CI 只扫描 R5 合成 fixture，没有两个应用镜像的 SBOM/CVE 证据。

首次真实构建又发现一个独立边界：前端 Docker context 发送 10.23GB、耗时约 593 秒。目录盘点证明其中约 9.48GB 来自被 Git 忽略但未被 Docker 忽略的 `deploy/staging/.evidence`。该目录包含本机供应链证据，不属于前端产物。

## 实现

- `.node-version`、根/后端 `engines`、GitHub CI 和两份 Dockerfile 统一到 Node 24.18.0 主版本线；CI 使用精确版本。
- 新增 `container-images` job，在每次 push/PR 实际构建：
  - `backend/Dockerfile`；
  - `Dockerfile.frontend`，强制 `VITE_APP_DATA_MODE=api` 和 `/api`。
- 镜像检查固定断言：
  - 后端运行用户 `10001:10001`；
  - 前端运行用户 `101:101`；
  - `org.opencontainers.image.revision` 等于当前 commit SHA。
- Docker Scout 分别输出 `backend.spdx.json`、`frontend.spdx.json`。
- 固定 digest 的 Grype 容器和固定数据库归档分别扫描两个 SBOM；任一可修复 Critical 会让 job 失败。
- CI 上传身份、SBOM、SARIF 和 Critical gate 输出，保留 14 天；失败时不会伪造完整证据。
- `.dockerignore` 新增 Staging `.env/.evidence/.release/.runtime/.secrets`，防止本机 secret、证据和发布状态进入前端构建上下文。

## 本地证据

环境：Node 24.18.0、npm 11.16.0、Docker 29.6.1、Compose 5.3.0。

| 门禁 | 结果 |
| --- | --- |
| CI 契约红灯 | 3 tests failed，符合预期 |
| CI 契约修复后 | 1 suite / 3 tests passed |
| 后端镜像构建 | passed；context 1.78MB；用户 `10001:10001`；revision 匹配 |
| 前端首次构建 | 镜像成功，但 context 10.23GB，判为失败边界并修复 |
| 前端修复后构建 | passed；context 24.09KB；缓存构建 7.74s；用户 `101:101`；revision 匹配 |
| 后端 SBOM | passed；约 1.60MB；585 packages indexed |
| 前端 SBOM | passed；约 1.16MB；83 packages indexed |
| 后端 Grype | passed；固定数据库 SHA-256 `7c732b44...102940`；无可修复 Critical |
| 前端 Grype | passed；同一固定数据库；无可修复 Critical |
| 后端完整单元 | 38/38 suites，345/345 tests |
| 前端运行时/构建 | 4/4；3,144 modules；API 产物检查通过 |
| 后端构建 | Prisma generate、应用和脚本 TypeScript 通过 |
| 仓库/依赖 | 628 files hygiene；根/后端均 0 vulnerabilities |

Docker Scout 在 Windows 临时目录清理时报告文件占用警告，但命令退出 0、两份 SBOM 均存在且随后通过 Grype；该警告不被描述为 Linux CI 证据。

## 剩余工作

- R8.2：scheduled/manual 工作流真实执行完整 `staging:release`、Compose browser smoke、隔离 restore drill、同一 release manifest rollback 和运行日志泄露检查。
- R8.2：增加 Python OCR 适配器完整依赖契约 job，并为需要 GPU/模型权重的真实推理保留显式条件门禁。
- Push 后核对 GitHub 当前 commit 的 `container-images` 和 PostgreSQL/E2E job；失败必须记录真实日志，不得回退为空 smoke。
- H13/H14 仍决定目标 Linux、registry、签名、正式恢复、RPO/RTO 和风险接受；R8.1 不解除这些阻断。

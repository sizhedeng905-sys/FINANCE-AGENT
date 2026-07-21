# M8.1 Nginx CI 安全基线刷新报告

> 日期：2026-07-20
> 状态：`verified_ci / blocked_external(H13,H14,H15,H16)`
> 范围：前端运行镜像、Staging 网关、R5 供应链夹具和 Nginx 上传边界
> 禁止解读：目标 Staging 通过、生产风险清零或 production-ready

## 1. 失败证据

M8 提交 `30c6ead1951e783dbb7f119e060f214c43002637` 已推送到 Draft PR #4：

- CodeQL run `29752262976`：`success`。
- Build and acceptance run `29752263099`：`failure`。
- 该 Build 的前后端镜像构建、Prisma/migration、410 个后端单测、97 个 PostgreSQL 集成测试和 17 个 Playwright 用例均通过。
- 唯一失败边界是前端镜像和 R5 夹具的 Grype `--only-fixed --fail-on critical` 门禁。
- 两处失败共享旧的 `nginx:1.28.0-alpine` 基础镜像，包含已有修复版本的 OpenSSL/libxml2 Critical 漏洞。

没有降低严重性阈值、移除 `--only-fixed`、吞掉退出码或把扫描移回业务门禁之前。

## 2. 候选验证与选择

第一次保守候选为 `nginx:1.28.3-alpine`。它虽然升级到 Alpine 3.23.3，但当前网络漏洞库仍检出 `libcrypto3/libssl3 3.5.5-r0` 的可修复 Critical，包括 `CVE-2026-31789` 和 `CVE-2026-34182`，因此未作为最终方案提交。

最终选择官方稳定版：

```text
nginx:1.30.4-alpine3.24@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46
```

Docker Hub registry 元数据显示该 tag 于 2026-07-18 更新。拉取并核验的本地 `linux/amd64` 运行时为 Alpine 3.24.1，`nginx` 用户仍为 UID/GID 101，关键包包括：

```text
nginx       1.30.4-r1
libcrypto3  3.5.7-r0
libssl3     3.5.7-r0
libxml2     2.13.9-r2
libpng      1.6.58-r1
curl        8.21.0-r0
libexpat    2.8.2-r0
```

## 3. 实现

所有 Nginx 消费者使用同一固定摘要：

- `Dockerfile.frontend`；
- `deploy/staging/.env.example`；
- `deploy/staging/compose.yaml` 的前端构建参数和 gateway；
- `deploy/staging/scripts/test-image-integrity.mjs` 的 R5 夹具；
- `backend/scripts/test-nginx-upload-boundary.mjs`。

`backend/test/staging-deployment.spec.ts` 新增精确一致性断言，任何版本或摘要单点漂移都会使 CI 失败。

## 4. 验收证据

| 门禁 | 实际结果 |
| --- | --- |
| 官方镜像拉取/身份 | digest 匹配；`linux/amd64`；UID/GID 101 |
| 真实前端镜像构建 | 通过；运行用户 `101:101`；revision 标签正确；Vite 3,147 modules |
| 前端镜像 SBOM | Syft 1.44.0；72 packages |
| 前端 Grype 门禁 | 当前网络数据库；fixable Critical 0 |
| R5 供应链攻击 | 17/17；证据 finalized；fixture 已清理 |
| R5 夹具 SBOM/Grype | 72 packages；fixable Critical 0 |
| Nginx 上传边界 | 19/50 MiB 接受；50 MiB + 1 与 53 MiB 拒绝；临时残留 0；JSON 错误统一 |
| 前端 runtime/build | 4/4；API 模式产物检查通过 |
| 后端部署/CI 契约 | 2 suites；19/19 tests |
| 后端 build | Prisma generate、应用及脚本 TypeScript 通过 |
| Staging 配置算法 | 3/3 |

本机 Syft 1.44.0 Windows 发布包从 Anchore GitHub release 下载，并按官方 checksums 文件验证 SHA-256 后执行。Grype 使用仓库固定扫描镜像和当前网络漏洞数据库，门禁参数与 GitHub CI 一致。

## 5. 远端与剩余风险

- M8.1 提交：`118a5ee2e2956327e0ed0622a7681824d416a3a1`，已推送到 Draft PR #4。
- Build and acceptance run `29755386892`：`success`。应用镜像供应链 job 用时 2m37s；PostgreSQL/E2E/R5 job 用时 12m30s；前端和 R5 的 Grype Critical 门禁均通过。
- CodeQL run `29755387035`：`success`。
- GitHub 注释提示部分固定 Actions 仍以 Node 20 为声明运行时并由平台强制迁移到 Node 24；本次执行成功，但应作为后续依赖升级维护项，不能等待平台停止兼容后再处理。
- Nginx 1.28 到 1.30 的兼容性已经覆盖静态配置、非 root 启动、上传边界、统一 JSON 错误和真实前端镜像构建，但不替代 H13 目标 Linux 的完整 release/restore/rollback。
- 其他 High/Medium/Low 漏洞继续由现有供应链报告和风险台账跟踪；本阶段只关闭导致 CI 失败的可修复 Critical。
- PR #4 保持 Draft，不 merge、不标记 Ready。H01-H16、Prompt Catalog 和目标环境门禁不因本修复自动关闭。

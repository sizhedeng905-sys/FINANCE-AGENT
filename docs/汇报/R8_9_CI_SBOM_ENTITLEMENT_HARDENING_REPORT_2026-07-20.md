# R8.9 CI SBOM entitlement 修复与验收报告

日期：2026-07-20

状态：`verified_ci / blocked_external(H13,H14)`

## 1. 问题与失败证据

基线提交为 `2243adf1ab823ea48683d40e85214544c0376ccd`。GitHub Actions 的 Build and acceptance [run 29666837943](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29666837943) 在两个 job 中均失败：

- Application container build and supply chain 已成功构建并核对前后端镜像，随后在 backend SBOM 步骤失败。
- PostgreSQL integration and E2E 已完成依赖、卫生和 Staging 静态门禁，随后在 R5 fixture SBOM 步骤失败。
- 两处共同错误为 `could not authenticate: user githubactions not entitled to use Docker Scout`。
- 由于 SBOM 步骤位于数据库、构建、单测和 E2E 之前，第二个 job 的业务门禁被全部跳过。

这不是业务代码失败，而是 workflow 依赖了需要 Docker Scout entitlement 的外部 Action。仍需修复，因为失败的 CI 不能作为验收证据。

## 2. 修复设计

### 2.1 扫描器供应链

- 移除 CI 和 Staging acceptance 中的 `docker/scout-action`。
- 固定 Syft `1.44.0`，Linux amd64 发布包 SHA-256 固定为 `0e91737aee2b5baf1d255b959630194a302335d848ff97bb07921eb6205b5f5a`。
- 下载使用 HTTPS、有限重试、连接超时和总超时；解包前执行 `sha256sum --check --strict`。
- 执行时再次解析 `syft version` 并要求与固定版本完全一致，关闭更新检查。
- Grype 的固定版本、数据库锁和“无可修复 Critical”硬门禁保持不变。

### 2.2 SBOM 输出边界

新增 `deploy/staging/scripts/generate-sbom.mjs`：

- 只接受 `docker:` 和仓库内 `dir:` 来源；拒绝远程 scheme、目录穿越、空白、控制字符及指向仓库外的目录符号链接。
- 输出只能位于仓库内且必须使用 `.spdx.json` 后缀；输出目录链拒绝符号链接。
- 先写进程唯一 partial 文件，限制最大 512 MiB，解析并验证 SPDX 文档结构后再原子发布。
- 校验失败、进程失败或输出非法时删除 partial 文件，不保留看似成功的证据。
- release 扫描索引明确记录 `pinned-syft-spdx-and-pinned-grype` 和 `syft_spdx_sealed`。

### 2.3 门禁顺序

- 应用镜像 job 仍先构建并核对真实镜像，再安装 Syft 和扫描。
- PostgreSQL job 先执行 Prisma、前后端构建、后端单测、PostgreSQL 集成和 Playwright，再执行 R5 fixture 的 Syft/Grype 门禁。
- 扫描失败仍使 job 失败，但不会再把未运行的业务测试误解为业务回归结果。
- fixture 清理保持 `if: always()`，失败路径仍清理本地测试镜像和网络。

## 3. 修改范围

- `.github/workflows/ci.yml`
- `.github/workflows/staging-acceptance.yml`
- `deploy/staging/scripts/generate-sbom.mjs`
- `deploy/staging/scripts/generate-sbom.test.mjs`
- `deploy/staging/scripts/scan-image-lock.mjs`
- `deploy/staging/scripts/test-image-integrity.mjs`
- `backend/test/ci-gates.spec.ts`
- `backend/test/staging-deployment.spec.ts`
- `package.json`

无 Prisma schema 或 migration 变更，无业务 API、权限、金额或入账语义变更。

## 4. 本地验收证据

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| SBOM helper 单测 | `passed` | 7/7；来源、穿越、符号链接、输出、版本锁和 SPDX 结构 |
| CI/Staging 契约 | `passed` | 2 suites，18/18 tests |
| actionlint | `passed` | `rhysd/actionlint:1.7.7`，两份 workflow 0 finding |
| Staging 配置 | `passed` | 3/3 |
| 镜像身份攻击 | `passed` | 17/17，deferred scan；结束后清理 fixture |
| 后端 build | `passed` | Prisma generate 与 Nest build 成功 |
| 后端单测 | `passed` | 45/45 suites，398/398 tests，24.49 秒 |
| PostgreSQL 集成 | `passed` | 8/8 suites，88/88 tests，32 migrations，130.602 秒 |
| 前端 runtime | `passed` | 4/4 |
| 前端 API build | `passed` | 3,144 modules；显式 `api` 配置 |
| Playwright E2E | `passed` | 本机 Edge 17/17，39.2 秒；隔离 PostgreSQL |
| 仓库卫生 | `passed` | 661 个 tracked/candidate 文件 |
| 生产依赖审计 | `passed` | 根目录和后端均 0 vulnerabilities |

第一次 Playwright 运行使用 `CI=true`，因本机没有 CI 专用 Chromium binary 而产生 1 passed/16 failed；这不是产品通过证据。随后移除 `CI`，使用仓库配置的系统 Edge 复跑相同 17 条用例并全部通过。两次均使用临时 `_test` PostgreSQL，结束后容器已删除。

第一次 PostgreSQL 集成运行未带 CI 的 `MAX_FILE_SIZE_MB=5`，导致一条文件上限断言得到 400 而非 413；补齐与 workflow 相同的环境后完整重跑为 88/88。未修改产品断言来制造通过。

## 5. 外部阻塞与未宣称事项

Windows Syft 官方发布包进行了两次有界下载，均因当前网络速度在硬超时前无法完成；第二次在 600 秒时取得 8,175,141/28,310,106 bytes 后退出。因为完整文件和 SHA-256 校验均未完成，本报告不宣称本机 Syft 二进制扫描通过，也不再重试同一外部条件。

推送后必须由 GitHub Linux runner 证明：

1. 固定发布包可下载且 SHA-256 匹配；
2. 前后端镜像和 R5 fixture 均生成有效 SPDX JSON；
3. 固定 Grype 门禁继续生效；
4. PostgreSQL、单测和 Playwright 在扫描器步骤之前真实运行；
5. evidence artifact 可上传且清理步骤执行。

该段记录的是推送前的关闭条件。后续 Build run `29752263099` 已证明固定 Syft/SPDX/Grype 链在 Linux runner 真实执行，并按设计阻断旧 Nginx Critical；M8.1 的 Build run `29755386892` 在不降低 Critical 门槛的前提下完整通过。因此 R8.9 工程项现为 `verified_ci`。目标 Linux Staging、跨版本 rollback、真实财务/OCR/AI 真值和 H01-H16 签字仍是独立门禁，本修复不改变项目“非 production-ready”的结论。

## 6. 回退

如需回退，只回退本 R8.9 提交即可恢复旧 workflow 和扫描脚本。旧 Docker Scout 路径已被远端 entitlement 失败证明不可作为当前默认门禁，因此回退后 CI 会重新进入已知失败状态；不涉及数据库回滚。

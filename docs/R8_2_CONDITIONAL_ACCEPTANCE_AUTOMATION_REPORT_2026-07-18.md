# R8.2 条件验收自动化报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

基线 HEAD：`f99e75b`

## 结论

R8.2 已完成条件验收路径的本地工程实现与静态/依赖回归。仓库现在提供两条彼此隔离的执行路径：scheduled/manual 的完整 Staging 发布验收，以及仅手工触发、要求预置 GPU 和模型资产的 L0 模型运行验收。

本报告不表示当前 commit 已在 GitHub self-hosted runner 执行，不表示真实模型准确率达标，也不表示 H13/H14 指定目标环境、正式恢复或 RPO/RTO 通过。完整本地 `staging:release` 已实际推进到 Compose 启动并暴露数据库网络就绪缺陷；修复后的端到端 release/rollback 结果仍需另行补充。

## 失败复现

- 新增 CI 契约后，Staging、GPU 模型和 Python OCR 三条预期能力最初均不存在，4 个断言按预期失败。
- 首版 Staging workflow 错用了 Docker Scout 不支持的 `command: version`；依据固定 v1.23.1 Action 契约改为最小 `fs://` SBOM，引导并实际检查 CLI。
- `actionlint` 首次发现两处已有 Docker build 参数未引用，以及两个自托管 runner 标签未登记；修复后仓库全部 workflow 零告警。
- `staging:init` 对旧的忽略文件 `.env` 不做升级，导致 `staging:check` 拒绝旧 PostgreSQL 镜像引用。现只同步仓库管理的镜像/构建依赖项，保留端口、环境标识、备份周期、身份策略和全部 secret。
- `model:init` 原先会吞掉模型目录冲突异常并继续尝试创建文件；现只捕获真实 `ENOENT`，相对路径和已有配置不一致均明确失败关闭。
- 首次完整 `staging:release` 在构建前失败：`minio-init` 与 `backup` 共享同一仓库自建镜像，但 Compose `--ignore-buildable` 仍把前者当成可拉取镜像并访问公共 registry。现场没有容器或数据写入；修复后只拉取 `redis/clamav/gateway/grafana/loki` 五个固定第三方服务。
- 修复后两次构建均在获取 `docker/buildkit-syft-scanner:stable-1` 认证 token 时网络超时；同一外部条件连续两次失败后标记 `blocked_external` 并停止重试。审计确认这份 build-time SBOM 没有进入供应链索引或 manifest，且 scanner 使用 mutable tag；现移除该重复依赖，保留 BuildKit max provenance，正式 SBOM 继续由逐镜像 Docker Scout SPDX 生成并封存。
- 移除未封存 scanner 后的第三次完整 release 已构建、锁定并扫描 18 个镜像，生成 57 份供应链产物和 sealed index；Compose 启动随后暴露 PostgreSQL 只监听 `localhost`，本地 socket `pg_isready` 错误地先报告健康，migration 容器以 P1001 失败。
- 失败栈的运行日志门禁检出 exact secret，但旧证据只保存类别。现场已完整清理，无法安全重建来源，因此没有猜测归因；新诊断只保存 secret 文件名、服务和次数，明确不保存值或原始日志行。

## 实现

- `.github/workflows/staging-acceptance.yml`：
  - hosted Python 3.10.19 OCR 依赖契约；
  - 带 48 GiB 磁盘、12 GiB 内存、Docker/OpenSSL 预检的 self-hosted Staging job；
  - 完整 release、运行日志泄露检查、同 manifest rollback、API/浏览器 smoke、清理和残留断言；
  - 只上传 `.release/.evidence`，不上传 `.secrets` 或 TLS 私钥。
- `.github/workflows/model-runtime-acceptance.yml`：仅 `workflow_dispatch`，保护预置模型目录，执行 resident、合成 Paddle OCR、按需模型切换、安全扫描和文本/OCR 恢复；结论固定为 L0，不声明准确率。
- `runtime-log-policy.mjs` 与 `verify-runtime-logs.mjs`：限制 32 MiB，检测 exact secret、Bearer/JWT、带凭据 URL、签名 query 和 Cookie；证据只保存哈希、大小、类别，以及 exact secret 对应的安全文件名/服务/次数，不保存密钥值或原始行。
- PostgreSQL 强制监听私有 Compose 网络；健康检查以 migrator 角色、固定 CA、`sslmode=verify-full` 和真实 `SELECT 1` 验证远程 TLS。初始化先移除上游泛化 host 规则，再显式拒绝非 TLS 并仅放行职责分离角色。
- `lock-images.mjs --scope staging|all`：完整 release 不再依赖未集成到 Staging 的大模型镜像；`all` 仍保留模型供应链锁路径。
- `release.mjs` 使用第三方服务白名单拉取镜像，不再对共享的仓库自建镜像执行隐式 registry pull。
- 构建只请求 BuildKit `mode=max` provenance；`scan-image-lock.mjs` 负责所有锁定镜像的 SPDX，并在 sealed index 中记录 `sbomSource=docker_scout_spdx_sealed` 后交给固定 Grype。
- `current-release-manifest.mjs`：只返回经 seal 校验、与 `current.json` 内容一致的 manifest 相对路径。
- `managed-environment.mjs`：版本升级时仅同步仓库管理默认项，重复键、缺失模板项失败关闭并保持幂等。
- `model:init` 支持显式绝对 `MODEL_ROOT`，且拒绝覆盖指向其他目录的现有配置。

## 本地证据

环境：Node 24.18.0、Docker 29.6.1、Compose 5.3.0；Python 依赖契约在 `python:3.10.19-slim-bookworm` 隔离容器执行。

| 门禁 | 结果 |
| --- | --- |
| CI/部署契约 | 2 suites / 18 tests passed |
| Workflow lint | actionlint 1.7.7，全部 workflow 零告警 |
| Staging 日志策略 | 4/4 passed；安全日志、exact secret 安全定位、Token/URL/query/Cookie 攻击覆盖 |
| Staging 配置升级 | 3/3 passed；首次实际旧配置同步 19 项，第二次更新 0 项 |
| Staging 配置检查 | 18 services、19 secrets、证书、固定镜像、私网与 API 模式 passed |
| Staging scope 镜像锁 | 18 images；`staging-image-lock/2.0`；非法 scope 被拒绝 |
| 备份完整性自测 | 9/9 passed |
| Python OCR 依赖 | 完整 requirements 安装、`pip check` passed |
| Python OCR 契约 | 8/8 passed；未执行模型推理，不声明准确率 |
| 模型目录负向测试 | 相对路径和现有配置不一致均被拒绝 |
| 后端 Jest | 38/38 suites，349/349 tests |
| 前端运行时 | 4/4 passed |
| 前后端 build | passed；Vite 3,144 modules；Prisma/NestJS/脚本 TypeScript passed |
| 仓库/依赖 | 638 files hygiene；根/后端均 0 vulnerabilities |

本批没有数据库模型或应用业务逻辑变更，因此 PostgreSQL 集成和 Playwright 标记为 `not_run`，将在完整 Staging release/smoke 与后续全量收口中重新执行。

## 未决门禁

- 当前 commit 的 GitHub hosted/self-hosted workflow：`not_run`，push 后才能取得远端证据。
- 完整本地 release、隔离 restore、同 manifest rollback 和运行态日志：下一批实际执行，不在本报告中冒充 passed。
- 第三次 release 的镜像构建/锁定/扫描已通过；数据库远程 TLS 就绪修复目前仅通过 18/18 部署/CI 契约、Compose 配置和 shell 语法，完整运行重试仍为 `not_run`。失败栈已清理，容器/网络/卷残留为 0。
- Docker Hub BuildKit scanner 认证端点：连续两次超时，`blocked_external`；该未封存重复 scanner 已从发布依赖移除，不影响 sealed Docker Scout/Grype 门禁。
- GPU L0 workflow：`not_run`；需要具备 NVIDIA runtime 和完整被忽略模型资产的 self-hosted runner。
- OCR/AI 真实准确率：`awaiting_human_signoff(H04-H09,H12,H16)`。
- 目标 Linux、registry、签名、正式恢复与 RPO/RTO：`blocked_external(H13,H14)`。

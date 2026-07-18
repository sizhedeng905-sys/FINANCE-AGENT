# R8.2 条件验收自动化报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

基线 HEAD：`f99e75b`

## 结论

R8.2 已完成条件验收路径的本地工程实现与静态/依赖回归。仓库现在提供两条彼此隔离的执行路径：scheduled/manual 的完整 Staging 发布验收，以及仅手工触发、要求预置 GPU 和模型资产的 L0 模型运行验收。

本报告不表示当前 commit 已在 GitHub self-hosted runner 执行，不表示真实模型准确率达标，也不表示 H13/H14 指定目标环境、正式恢复或 RPO/RTO 通过。完整本地 `staging:release` 必须在本批代码形成干净提交后执行，结果将另行补充。

## 失败复现

- 新增 CI 契约后，Staging、GPU 模型和 Python OCR 三条预期能力最初均不存在，4 个断言按预期失败。
- 首版 Staging workflow 错用了 Docker Scout 不支持的 `command: version`；依据固定 v1.23.1 Action 契约改为最小 `fs://` SBOM，引导并实际检查 CLI。
- `actionlint` 首次发现两处已有 Docker build 参数未引用，以及两个自托管 runner 标签未登记；修复后仓库全部 workflow 零告警。
- `staging:init` 对旧的忽略文件 `.env` 不做升级，导致 `staging:check` 拒绝旧 PostgreSQL 镜像引用。现只同步仓库管理的镜像/构建依赖项，保留端口、环境标识、备份周期、身份策略和全部 secret。
- `model:init` 原先会吞掉模型目录冲突异常并继续尝试创建文件；现只捕获真实 `ENOENT`，相对路径和已有配置不一致均明确失败关闭。

## 实现

- `.github/workflows/staging-acceptance.yml`：
  - hosted Python 3.10.19 OCR 依赖契约；
  - 带 48 GiB 磁盘、12 GiB 内存、Docker/OpenSSL 预检的 self-hosted Staging job；
  - 完整 release、运行日志泄露检查、同 manifest rollback、API/浏览器 smoke、清理和残留断言；
  - 只上传 `.release/.evidence`，不上传 `.secrets` 或 TLS 私钥。
- `.github/workflows/model-runtime-acceptance.yml`：仅 `workflow_dispatch`，保护预置模型目录，执行 resident、合成 Paddle OCR、按需模型切换、安全扫描和文本/OCR 恢复；结论固定为 L0，不声明准确率。
- `runtime-log-policy.mjs` 与 `verify-runtime-logs.mjs`：限制 32 MiB，检测 exact secret、Bearer/JWT、带凭据 URL、签名 query 和 Cookie；证据只保存哈希、大小与类别。
- `lock-images.mjs --scope staging|all`：完整 release 不再依赖未集成到 Staging 的大模型镜像；`all` 仍保留模型供应链锁路径。
- `current-release-manifest.mjs`：只返回经 seal 校验、与 `current.json` 内容一致的 manifest 相对路径。
- `managed-environment.mjs`：版本升级时仅同步仓库管理默认项，重复键、缺失模板项失败关闭并保持幂等。
- `model:init` 支持显式绝对 `MODEL_ROOT`，且拒绝覆盖指向其他目录的现有配置。

## 本地证据

环境：Node 24.18.0、Docker 29.6.1、Compose 5.3.0；Python 依赖契约在 `python:3.10.19-slim-bookworm` 隔离容器执行。

| 门禁 | 结果 |
| --- | --- |
| CI/部署契约 | 2 suites / 18 tests passed |
| Workflow lint | actionlint 1.7.7，全部 workflow 零告警 |
| Staging 日志策略 | 3/3 passed；安全日志、exact secret、Token/URL/query/Cookie 攻击覆盖 |
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
- GPU L0 workflow：`not_run`；需要具备 NVIDIA runtime 和完整被忽略模型资产的 self-hosted runner。
- OCR/AI 真实准确率：`awaiting_human_signoff(H04-H09,H12,H16)`。
- 目标 Linux、registry、签名、正式恢复与 RPO/RTO：`blocked_external(H13,H14)`。

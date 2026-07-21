# R5 镜像身份、供应链与回退完整性报告

更新日期：2026-07-18

## 结论

`R5-IMAGE-001` 的本机工程门禁已完成。发布会在启动候选容器前构建镜像、生成不可变镜像锁、保存配置证据、生成 SBOM、执行漏洞门禁、冻结 migration ledger 和写入自校验发布计划；回退只接受与这些证据完全匹配的 release manifest，并在启动后复核实际容器 image ID。

该结论不表示生产供应链获批。目标 registry、签名密钥、签名/证明验证、正式 Linux 主机和真实回退演练仍受 H13/H14 约束，状态为 `blocked_external`。MinIO 使用归档源码的最后公开提交构建，镜像标签明确带 `production-approval=pending-h13`，不得据此宣称生产选型获批。

## 失败复现

R5 开始时存在以下可复现风险：

- release 在部署后才记录部分本地 image ID，部署前没有完整锁；
- rollback 只恢复少量 tag，tag 漂移后可能启动与历史 release 不同的镜像；
- manifest 没有自校验，也没有关联配置、SBOM、漏洞扫描和 migration 集合；
- 回退没有验证运行中容器的实际 image ID；
- Promtail 已停止维护，部分观测和存储镜像只有供应商 tag；
- 用户现有 `deploy/staging/.env` 可覆盖仓库安全默认值为旧供应商镜像。

新增的失败测试会拒绝 tag 漂移、image ID 篡改、manifest/sidecar 篡改、配置镜像不一致、migration 增删改和越界证据路径。旧本地 `.env` 现在因 PostgreSQL 未使用仓库自建镜像而失败关闭；该用户文件未被修改或提交。

## 实现

### 发布证据链

- `staging-image-lock/2.0` 记录每个 Compose、模型和扫描镜像的 requested reference、repo digest、本地 image ID、平台、OCI revision label 和使用位置。
- `staging-release-plan/2.0` 在候选服务启动前冻结 Git SHA、配置哈希、完整 migration ledger、镜像锁和供应链索引。
- `staging-release-manifest/2.0` 关联最终 smoke、恢复演练和模型路由快照；所有 JSON 都有 canonical SHA-256 与 sidecar。
- `staging-supply-chain/1.0` 关联逐镜像 SPDX SBOM、Grype SARIF、Critical 修复门禁和 BuildKit provenance 请求状态。
- 配置证据中的每一个服务镜像都必须与锁一致，不能用旧 `.env` 或部署时覆写偷偷替换。
- runtime 环境从镜像锁生成，Compose 使用 `--no-build --pull never`；启动后按服务复核实际容器 image ID。

### 回退边界

- rollback 只读取 `.release/releases` 内的自校验 manifest、计划、锁和扫描索引；路径逃逸被拒绝。
- 本地身份模式要求历史 requested reference 仍解析到相同 image ID；tag 漂移直接失败。
- 签名 registry 模式要求供应链索引中的签名状态为 `passed`；H13 未配置前不会伪造签名成功。
- 回退前核对当前 Compose/`.env.example` 哈希、全部 11 类自建镜像、完整 migration 名称与 checksum 集合。
- 回退后复核运行容器 image ID、数据库 migration 集合、TLS/API/browser smoke 和模型路由快照。
- 数据恢复继续要求一次性 H13/H14 授权，并使用 R4 的隔离验证和补偿路径；普通应用回退不执行 down migration。

### 构建输入和镜像

- Node、Nginx、Redis、ClamAV、Grafana、Loki、Go 和 Debian 构建输入均固定到已核验 `sha256`。
- PostgreSQL 17.10、备份工具、MinIO、Prometheus、Alertmanager、node-exporter、Alloy 和 Tempo 使用固定源码提交或固定包版本构建。
- Promtail 已替换为 Alloy 1.16.1 源码构建；日志采集只读 Docker JSON 文件，不挂载 Docker socket。
- 自建运行镜像带 `org.opencontainers.image.revision`，采用非 root、只读根、cap drop 和 no-new-privileges 等既有约束。
- `verify-config.mjs` 要求 R5 服务使用仓库自建镜像，第三方运行镜像及所有 Docker build 输入必须是 digest reference。

## 自动化证据

本轮实际执行并通过：

| 门禁 | 结果 |
| --- | --- |
| 镜像身份攻击测试 | 17/17，通过；覆盖锁、tag 漂移、配置证据、migration 和 bundle 篡改 |
| 备份完整性故障注入 | 9/9，通过 |
| Staging 静态 Jest | 11/11，通过 |
| 后端全量 Jest | 31/31 suites，286/286 tests，通过 |
| PostgreSQL 集成 | 2/2 suites，61/61 tests，通过 |
| Playwright 真实 API | 16/16，通过 |
| 前端 runtime/build | 4/4；Vite 3,144 modules，通过 |
| Prisma/migration | schema validate；空库 24 条、23 到 24 升级，通过 |
| 生产 npm audit | 根目录和后端均为 0 vulnerabilities |
| Compose/候选配置 | 18 services、19 secrets、TLS、私网、自建镜像和第三方 digest，通过 |

完整本机镜像扫描使用 22 个锁定镜像，产生 66 份 SBOM/扫描产物，耗时 2487.3 秒。固定 Grype 镜像和本地数据库归档 SHA-256 下，所有镜像均通过“无已有修复版本的 Critical”门禁。扫描结果仍包含 53 个 High、88 个 Medium、38 个 Low 项，不能表述为零漏洞；它们需要镜像升级、可利用性分析和 H13 风险接受继续处理。

完整扫描证据保存在 Git 忽略的 `.evidence/r5-full-lock/`，避免把大型 SBOM、缓存或可能触发 DLP 的包元数据提交 Git。CI 新增轻量合成镜像门禁和 SARIF/evidence artifact；远端 CI 只有在提交成功推送后才可形成新的 GitHub 证据。

## 保守行为与剩余风险

- `IMAGE_IDENTITY_POLICY=local_identity` 只适合同一受控 Docker 主机；镜像被清理后不能跨主机恢复。
- `signed_registry` 所需 registry、Cosign 身份、信任根和授权流程等待 H13；签名状态当前为 `pending_h13`。
- CI 无本地固定 Grype 数据库归档时会使用固定 scanner 镜像获取当次数据库；本机完整 release 证据使用了固定数据库归档。两者不能混写为相同可复现级别。
- 目标 Linux Staging 尚未执行 release、rollback、restore、RPO/RTO 和告警送达，保持 `blocked_external`。
- 用户现有 `deploy/staging/.env` 与新镜像策略不兼容。下一次本地发布前应从 `.env.example` 同步非敏感镜像项；门禁会持续失败关闭，脚本不会覆盖已有 secret 或用户配置。

## 关键文件

- `deploy/staging/scripts/image-integrity-lib.mjs`
- `deploy/staging/scripts/lock-images.mjs`
- `deploy/staging/scripts/scan-image-lock.mjs`
- `deploy/staging/scripts/release.mjs`
- `deploy/staging/scripts/rollback.mjs`
- `deploy/staging/scripts/verify-config.mjs`
- `deploy/staging/scripts/test-image-integrity.mjs`
- `deploy/staging/compose.yaml`
- `.github/workflows/ci.yml`

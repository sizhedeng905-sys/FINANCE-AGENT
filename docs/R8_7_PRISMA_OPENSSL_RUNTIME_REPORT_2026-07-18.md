# R8.7 Prisma OpenSSL 运行时契约报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

触发基线：R8.6 同 manifest rollback

## 问题

rollback 的 migration 容器虽然成功完成，但 Prisma 输出“无法检测 OpenSSL 版本并默认使用 openssl-1.1.x”。后端镜像来自 Debian bookworm，继续依赖猜测可能在引擎升级或基础镜像变化时造成 binary target 不兼容，因此不能把该告警当作无害噪声。

## 修复

- 后端 Dockerfile 增加共享 `node-base`，build 与 runtime 均安装固定版本的 CA、libssl3 和 OpenSSL CLI；升级必须显式改版本并重新扫描。
- 最终容器仍以 `10001:10001` 运行；没有把 migration 或 API 改回 root。
- CI 在实际后端镜像内执行 `openssl version` 和本地 Prisma CLI，并拒绝任何 `failed to detect` 输出。
- Jest 契约固定共享基础层、OpenSSL 包、最终镜像探针和失败文案。

## 定向证据

| 门禁 | 结果 |
| --- | --- |
| 首次镜像构建 | `blocked_external`；Debian bookworm-updates InRelease 返回 502，没有关闭签名校验 |
| 第二次镜像构建 | 73.4 秒 passed；验证共享基础层方案，npm audit 0 vulnerabilities |
| 最终固定版本重建 | 显式固定 CA/libssl3/OpenSSL Debian 版本后 70.0 秒 passed |
| OpenSSL | `OpenSSL 3.0.20`，CLI 与 library 一致 |
| Prisma | 6.19.3；Computed binaryTarget=`debian-openssl-3.0.x`；无 detect warning |
| 运行用户 | 镜像配置继续为 `10001:10001` |
| CI/部署契约 | 2 suites、18/18 tests passed |
| Workflow lint | 固定本地 `rhysd/actionlint:1.7.7` 镜像；首次发现裸 `! grep` 的 SC2251，改为显式失败分支后全 workflow 零告警 |

## 边界

- R8.7 commit 的完整 release、运行日志和 rollback：`not_run`，不得只凭定向镜像探针写 passed。
- R8.6 的本地完整发布与同 manifest rollback 保持 passed；这不是目标 Linux 或生产批准。
- 目标 registry/签名、正式恢复和 RPO/RTO 继续 `blocked_external(H13,H14)`。

## 下一动作

提交 R8.7，执行最终完整 release 和日志复核；migration/rollback 输出不得再包含 OpenSSL 检测告警。完成后清理本项目 Compose 资源并确认容器、网络、卷为 0。

# CR-010 后端运行镜像供应链恢复报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

起始 SHA：`7a0fded95aa1fb78658c1dd173bdb33264ec539c`

## 结论

CR-009 的系统登记逻辑经独立复验没有发现回归。其 GitHub Build 失败被精确限定在后端运行镜像的 fixable Critical gate，PostgreSQL/Redis、构建和 17 条浏览器 E2E 均成功；CodeQL 也成功。

本轮采用最小运行面修复：构建阶段继续使用 npm，最终运行阶段移除不需要的全局 npm、npx 和 Corepack；Staging migration 改为直接调用项目内 Prisma CLI。没有修改业务依赖、数据库、权限或 AI registry，也没有降低扫描门槛。

## 根因证据

失败 run：[Build and acceptance 29821449158](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29821449158)

- `tar 7.5.15`、`undici 6.26.0`、`brace-expansion 5.0.6` 均位于 `/usr/local/lib/node_modules/npm/node_modules/`。
- 根目录和后端 production dependency audit 均为 0 vulnerabilities，排除业务 lockfile 是本次命中的来源。
- CR-009 的 PostgreSQL integration and E2E job 成功；Application container job 只在 fixable Critical gate 失败。
- CR-009 CodeQL：[run 29821448996](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29821448996)，成功。

## 修复与防回归

- `backend/Dockerfile` 删除 runtime 中全局 npm/Corepack 目录和三个命令入口。
- `deploy/staging/compose.yaml` 直接执行 `./node_modules/.bin/prisma`。
- CI 通过默认 `backend-entrypoint` 验证非 root 用户、revision、包管理器缺失、Node、OpenSSL、Prisma Schema 和编译入口。
- Jest 契约锁定 Dockerfile、Workflow 和 Compose，防止后续重新引入 `npx` 或无用全局 npm。

## 本地验收

| 门禁 | 结果 |
| --- | --- |
| 定向 CI/Staging 契约 | PASS，2 suites / 19 tests |
| 后端单元 | PASS，50 suites / 464 tests |
| PostgreSQL + 强制 Redis | PASS，14 suites / 124 tests |
| Migration 双路径 | PASS，43 migrations；42 到 43 升级 |
| System registry acceptance | PASS，API/Worker 启动和漂移拒绝均成立 |
| 前后端构建 | PASS |
| Playwright | PASS，17/17 |
| Runtime / Staging config | PASS，4/4 与 3/3 |
| 前后端 production audit | PASS，均为 0 vulnerabilities |
| 后端 runtime image | PASS，`10001:10001`、revision、entrypoint、Node/OpenSSL/Prisma 均符合预期 |
| Syft / Grype | PASS，新 SBOM 433 components、0 npm CLI components；fresh DB 扫描无命中 |

首次离线 Grype 扫描因本地漏洞数据库超过 5 天而失败，随后使用相同固定 Grype 镜像和隔离的新数据库成功。没有更改阈值、allowlist 或过滤规则。

## 当前状态

本地状态：`LOCAL_ENGINEERING_VERIFIED`。

远端状态：`ENGINEERING_VERIFIED`。SHA `1abe513b0392e367dc4242930a6022dbf4e7bc8e` 的 [Build run 29823851399](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29823851399) 两个 job 全部成功，包含 runtime identity、SBOM、fixable Critical gate、PostgreSQL/Redis 和 17 条 Playwright；[CodeQL run 29823851377](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29823851377) 成功。

发布状态：仍非 production-ready；目标 Staging、恢复、真实样本准确率与 owner UAT 未关闭。

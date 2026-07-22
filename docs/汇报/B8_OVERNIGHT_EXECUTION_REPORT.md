# B8 无人值守收口执行报告

更新日期：2026-07-17

## 1. 执行结论

- 分支：`agent/b8-stable-hardening`
- 审计代码 HEAD：`1213ee8`（本报告后续文档提交不改变被审计代码）
- 上游：`origin/agent/b8-stable-hardening`，代码审计时为零分叉
- Draft PR：[PR #4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 发布判断：`blocked_external`

B8-09 与 RC-00 至 RC-04 的机器可执行实现、回归和文档工作已完成。真实 Staging 发布在 Node 基础镜像 metadata 请求处遇到 registry TLS 握手超时，未执行 Compose `up`，因此 smoke、真实备份恢复、RPO/RTO 和回退仍是 `blocked_external`。财务、OCR/AI 真值、安全复核及授权签字保持人工门禁。

## 2. 本轮提交

| 提交 | 内容 | 主要证据 |
| --- | --- | --- |
| `4142a2e` | API/Worker、Redis、S3、观测基础 | 配置、单元、PostgreSQL |
| `2c2baa7` | 18 服务 Staging、备份恢复、发布回退 | Compose 与脚本门禁 |
| `64f7b21` | B8-09 运行手册和交接 | 文档审查 |
| `f78c35b` | 限定后端测试启动超时 | 后端测试 |
| `01b12fe` | AI intent ReDoS 与本地路径边界 | CodeQL、定向单测 |
| `916ff3e` | Redis 短断后持续重连 | 可观测性单测 |
| `8677ef7` | 对账时保留未知孤儿对象 | 文件存储单测 |
| `019abcb` | 跨账号浏览器状态隔离 | Playwright |
| `d95e3ad` | OCR 事务前准备，避免连接池死锁 | 1/3/5 并发 PostgreSQL |
| `df439eb` | 关闭时有界排空 trace batch | 可观测性单测 |
| `224e49d` | Worker 关闭等待恢复任务 | Worker 单测 |
| `277929c` | 显示真实财务审核 actor | 前端构建 |
| `15b6f1d` | 老板首页保留 Decimal 分值 | Playwright 大数小数用例 |
| `0698f70` | 首页统计改用角色范围内服务端聚合 | 单元、四角色 Playwright |
| `bd544fc` | 集成测试上传目录隔离 | PostgreSQL 60/60 |
| `769e962` | 401 主动跳转测试接受预期导航中断 | Playwright 16/16 |
| `ccc7365` | 空库与上一基线升级迁移门禁 | 24/24、23→24 migration |
| `1213ee8` | 模型监控对齐认证 `/ready` | 真实 GPU 韧性与短时 soak |

以上提交均已推送。未执行 amend、rebase、force push、PR merge、ready-for-review 或 close。

## 3. 自动化证据

| 门禁 | 状态 | 结果 |
| --- | --- | --- |
| 根目录/后端 `npm ci` | `passed` | 147/623 packages；生产依赖审计均为 0 vulnerabilities |
| 前端 build | `passed` | 3,143 modules |
| 后端 build | `passed` | Prisma Client、应用和脚本 TypeScript |
| 后端 Jest | `passed` | 29/29 suites，263/263 tests |
| PostgreSQL | `passed` | 2/2 suites，60/60 tests；两次完整复跑 |
| Playwright | `passed` | 16/16 tests；teardown 残留 0 |
| Prisma | `passed` | format、validate、generate、24/24 status；41 表、27 enums、173 indexes、77 foreign keys |
| 迁移路径 | `passed` | 空库 24 条；上一基线 23 条后升级第 24 条；临时 `_test` 库已清理 |
| Repository hygiene | `passed` | 550 tracked/candidate files |
| Python adapter | `passed` | 运行镜像内 8/8；宿主机 5 passed、3 dependency-skipped |
| Staging 静态配置 | `passed` | 18 services、17 secrets、TLS、固定 tag、私网与只读应用容器 |
| 脚本/Compose | `passed` | 10/10 shell、1/1 PowerShell syntax、staging/model 两份 Compose |
| 模型配置与资产 | `passed` | 四套资产完整；digest/auth/隔离/切换锁/代理边界通过 |
| 真实模型韧性 | `passed` | 文本重启、VL 切换和文本恢复期间 OCR 432 次 readiness 采样 0 失败；最终并发 AI/OCR 均为 HTTP 200 |
| Staging release | `blocked_external` | 基础服务镜像拉取成功；Node build metadata TLS timeout；未执行 `up`、smoke 或 restore drill |
| GitHub Build and acceptance | `passed` | [run 29585926831](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29585926831) |
| GitHub CodeQL | `passed` | [run 29585926840](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29585926840) |

## 4. 执行中发现的问题

- 集成测试存储根目录误扫 E2E fixture：已改为受限专用子目录，第二次 60/60 无错误日志。
- 401 测试与应用主动跳转发生导航竞态：仅接受预期 `ERR_ABORTED`，完整 16/16 通过。
- 模型韧性和 soak 脚本仍调用旧匿名 OCR health：已改为携带 Bearer 的 `/ready`，真实切换通过。
- 本地开发库少最后一条 nullable 增量 migration：审查 SQL 无删表或历史数据改写后已部署，status 与结构校验通过。
- Staging 发布受 registry TLS 超时阻断：按重试上限停止，不使用未知镜像源；文本/OCR容器未受影响。

## 5. 工作区保护

用户原有 IDE 配置、规划/需求文档、模型下载脚本、本地部署教程、模型权重、真实业务数据和私有测试报告均未暂存、未提交、未删除。生成的 staging secret、证书、release 草稿和本地测试报告保持 Git 忽略。

## 6. 剩余门禁

- `blocked_external`：在 H-13 指定 Linux Staging 完成受控 registry、真实 TLS/Redis/MinIO/ClamAV/PostgreSQL、smoke、backup/restore、RPO/RTO 与 rollback。
- `pending_human_decision`：入账粒度，负数/冲销/更正/作废/关账，跨来源重复，MFA/权限矩阵，文件下载和外部 AI 数据政策。
- `awaiting_human_signoff`：财务逐分对账、OCR 17 份标签和 5 份盲测、老板 AI 标准答案、独立代码/安全 Review，以及财务/业务/老板/安全签字。

人工最短执行顺序：

| 顺序 | 负责人 | 输入 | 验收输出 |
| --- | --- | --- | --- |
| 1 | 基础设施负责人 | H-13 服务器、域名、registry、容量和正式 secret | 固定 digest 的 18 服务环境，TLS/健康检查通过 |
| 2 | 运维/DBA | `docs/B8_09_STAGING_RUNBOOK.md` 与 H-14 RPO/RTO | release manifest、smoke、backup/restore drill、RPO/RTO 和 rollback 证据 |
| 3 | 安全 reviewer | PR #4 与 `docs/PR4_REVIEW_GUIDE.md` | 独立 Review 记录，P0/P1 全部关闭 |
| 4 | 财务负责人 | 匿名 UAT manifest、逐分账和 OCR 标签 | 逐分对账、17 份标签、5 份盲测结论 |
| 5 | 财务/业务负责人 | 入账粒度、负数/冲销/更正/关账和跨来源重复方案 | 已签字业务规则与对应验收样例 |
| 6 | 老板/数据负责人 | AI 标准问题、允许数据范围和外发政策 | AI 真值与数据政策签字 |
| 7 | 项目负责人 | 上述全部证据和 `docs/计划/B8_09_PILOT_DAILY_CHECKLIST.md` | 有限试运行批准；未满足时保持人工辅助 |

下一条安全命令（registry 恢复后由人工执行）：

```bash
docker pull node:24.18.0-bookworm-slim
```

拉取成功后重新执行 `npm run staging:release`，不得跳过 smoke 和 restore drill。

# CR-047 Overnight fact sync and handoff

## 目标

把 2026-07-22 夜间实际完成的运行时修复、本机回归、同 SHA GitHub Actions、Friday Demo 状态、外部阻塞和负责人晨间动作同步到唯一可审查文档基线，移除已经过期的“网络阻塞/CI 等待”描述。

## 起始事实

- 最后运行时代码为 `5c16f3e114adf4be59c8dd629827970225de51f5`，`origin/agent/b8-stable-hardening` 与本地一致。
- GitHub Build and acceptance run `29915561659` 与 CodeQL run `29915561810` 均在该 SHA 成功。
- Build 的两个 job 均成功，覆盖应用镜像、后端单元、PostgreSQL/Redis 集成、22 个浏览器 E2E、Syft SBOM 与 Grype 门禁。
- 三次负责人手工彩排、真实 OCR/AI 真值、目标 Staging、告警、签名、异地恢复、独立审查和 owner UAT 仍未完成。
- 工作区含用户未跟踪文档、模型辅助脚本和 IDE 配置；它们不属于本 CR，必须继续保护。

## 修改范围

- 根 README：更新运行时 SHA、远端双绿、本机回归、Demo 与生产边界。
- 后端 README：更新 51 migrations、473 单元、125 集成、22 E2E 和运行镜像/install-script 基线。
- `NEXT_TODO.md`：删除过期网络阻塞，改为三次彩排、真实样本、目标资源与 UAT 的当前清单。
- 汇报索引与历史进度页：新增当前夜间总述入口，旧进度页明确标为历史快照。
- 夜间总述：记录功能意义、失败复现、最终证据、GitHub artifact、回滚、受保护资产和晨间三件事。
- commit-review 索引：把当前树已经远端验证的条目标为远端树验证，并登记 CR047。

## Schema、API、UI 与财务影响

- Schema/migration：无变化，仍为 51 个 migration。
- API、DTO、权限与 UI：无变化。
- 财务金额、审批、幂等、记录可见性和报告口径：无变化。
- 最后运行时代码仍是 `5c16f3e`；CR047 只包含 Markdown。

## 事实核验

| 状态 | 证据 | 结果 |
| --- | --- | --- |
| `PASS` | GitHub Build and acceptance run `29915561659` | 2/2 jobs；所有步骤成功 |
| `PASS` | GitHub CodeQL run `29915561810` | completed/success |
| `PASS` | Build artifacts | gitleaks SARIF、application container evidence、R5 image identity evidence 均绑定 `5c16f3e` |
| `PASS` | 最终 `npm run demo:reset` | 51 migrations；合成账号、模板和 3 行 fixture 就绪 |
| `PASS` | 最终 `npm run demo:test` | 1/1；23.3 秒；3 条正式记录，总额 `13422.21`；结束后清理 |
| `PASS` | 最终 `npm run demo:verify` | 环境、账号、项目、模板、fixture 与 Mock provider 配置可复验 |
| `PASS` | `npm run check:docs` | 144 files；220 local links |
| `PASS` | `npm run check:hygiene` | 865 tracked or candidate files |
| `PASS` | `git diff --cached --check` | 由本 CR 提交前最终门禁记录 |

## 保留的失败与限制

- 首次 `git diff --cached --check` 因 9 处 Markdown 强制换行尾空格失败；已改为显式空行后重新执行，不把该文档质量失败隐藏。
- CR044 的远端 471/473 失败、CR046 首次缺 `TEST_REDIS_URL`、普通 build 后 staging bundle 配置失败和只读开发库结构差异均在夜间总述保留；没有用最终绿色删除失败证据。
- 本机 Docker Scout 因未登录 Docker ID 没有运行；只引用同 SHA 远端 Syft/Grype，不冒充本机扫描。
- 没有读取或覆盖私有 Staging `.env`、`.secrets`、`.runtime`、`.release`、`.evidence`。
- 没有触碰常驻 Qwen/PaddleOCR 容器，没有提交真实数据、凭据、模型权重或用户未跟踪资产。
- `CONDITIONAL_GO` 仅适用于周五合成 Demo，不是生产批准。

## 回滚

使用 `git revert <CR047-sha>` 可撤销本次文档同步；不会改变运行时代码或数据库。回滚后 README/TODO 会恢复过期状态，因此若只需修正文案，应优先新增更正提交，不重写历史。

## 下一步

1. 负责人按 runbook 完成三次人工 Demo 彩排并记录偏差。
2. 人工审查 Draft PR #4，保持 Draft，不 merge、不标记 Ready。
3. 在 Git 外准备经授权真值样本与目标 Staging/registry/告警/异地备份资源清单。

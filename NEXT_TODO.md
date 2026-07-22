# FINANCE-AGENT 下一步执行清单

更新日期：2026-07-23 交接基线

分支：`agent/b8-stable-hardening`

最后运行时代码：`5c16f3e114adf4be59c8dd629827970225de51f5`

Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)

## 当前结论

- 周五合成 Demo 技术闭环为 `CONDITIONAL_GO`：登录、Excel 导入、AI 建议、财务修改、第二财务批准、3 条正式记录、ReportSnapshot 与叙述依据均有自动化证据。
- 运行时代码 `5c16f3e` 的本机回归、GitHub Build and acceptance 与 CodeQL 均通过；PR #4 保持 Draft，可供人工审查。
- 当前不是 production-ready。目标 Linux Staging、真实告警、真实镜像签名、真实异地恢复、真实 OCR/AI 真值、三次人工彩排、独立审查和 owner UAT 均未完成。
- AI 只提供受控建议；财务批准前不生成正式可见记录；报告金额只来自固定查询、Decimal 与 canonical ReportSnapshot。这些安全边界不得为演示或赶进度放宽。

## 已完成工程基线

- Prisma：51 个 migration；空库安装与 50→51 升级路径通过。
- 后端单元：51/51 suites、473/473 tests。
- PostgreSQL/Redis 集成：14/14 suites、125/125 tests；覆盖 30,196 与 49,999 行边界。
- Playwright API 模式：22/22；包含 Excel AI、OCR、报告与周五 Demo。
- Friday Demo 专项：1/1；恰好生成 3 条正式记录，金额 `1250.25`、`8765.43`、`3406.53`，合计 `13422.21`。
- 供应链：根目录和后端完整/生产 `npm audit` 均为 0 个已知漏洞；install script 精确批准/拒绝检查 7/7；后端 runtime 镜像无 npm/npx/corepack 且以非 root 用户运行。
- 远端：[`Build and acceptance #46`](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561659) 与 [`CodeQL #43`](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561810) 在同一运行时 SHA 上成功。

以上证据只证明仓库代码与合成/匿名测试行为，不代表真实财务口径、真实模型准确率、目标环境或生产发布已通过。

## 明早优先级

1. 完成三次人工周五 Demo 彩排。
   - 每次按 [`docs/deliveries/2026-07-24/DEMO_RUNBOOK.md`](docs/deliveries/2026-07-24/DEMO_RUNBOOK.md) 从 reset 开始。
   - 记录总耗时、投屏可读性、关键页面停留点和任何偏差；任一金额、记录数或角色不一致立即停止，不现场改数据掩盖问题。
2. 审查 Draft PR #4。
   - 先看 CR-044 至 CR-047，再按功能分组回看 CR-017 至 CR-043。
   - 核对同 SHA CI、供应链 artifact、未决门禁和回滚说明；保持 Draft，不 merge、不标记 Ready。
3. 准备下一轮真实验收输入。
   - 只在仓库外准备已授权、可脱敏且带人工真值的最小 Excel/OCR/财务样本。
   - 同时列出目标 Staging、registry、告警接收端与异地备份目标的负责人和可用时间；凭据不得写入 Git 或问卷。

## 后续必须由负责人或真实环境完成

| 工作 | 当前状态 | 最小输入 | 未提供时的安全行为 |
| --- | --- | --- | --- |
| 三次人工 Demo 彩排 | `NOT_RUN` | 负责人亲自按 runbook 操作并记录 | 只保留 `CONDITIONAL_GO`，不宣称演示验收完成 |
| OCR/AI 真实准确率 | `REAL_SAMPLE_NEEDED` | 已授权真值样本与人工标签 | 继续标明 Mock/合成，仅允许建议和人工复核 |
| 财务口径逐分核对 | `AWAITING_HUMAN_SIGNOFF` | 收入、成本、利润、冲销/重复规则真值 | 只声明框架与合成 Decimal 结果，不固化正式口径 |
| 目标 Linux Staging | `BLOCKED_EXTERNAL` | 主机、域名、证书、对象存储、授权配置 | 不运行会读取本地私密资产的目标命令，不声称部署通过 |
| 告警、registry 签名、异地恢复 | `BLOCKED_EXTERNAL` | 真实接收端、可信根/凭据、独立故障域与 RPO/RTO | 保持合成契约，发布失败关闭 |
| 独立审查、owner UAT、Go Live | `AWAITING_HUMAN_SIGNOFF` | 独立审查结论与负责人明确签收 | PR 保持 Draft，不 merge、不转 Ready、不生产部署 |

## Codex 可继续自主维护

- 修复新出现且可本地复现的 P0/P1 回归，并为每个独立修改建立 commit-review。
- 保持依赖、Prisma、单元、集成、E2E、镜像和文档门禁；不以删除断言或静默 Mock 获取绿色。
- 在收到经授权真值或目标环境后执行对应验收，原样记录失败、耗时和限制。
- 更新 README、汇报、Draft PR 和阻断矩阵，但不替代负责人作业务签收或生产授权。

## 每个后续提交的门禁

- 一个独立主题对应一个 `docs/commit-reviews/CR-XXX_*.md` 并更新索引。
- 只暂存有意文件；不提交 `.env`、secrets、模型权重、真实数据、备份、上传文件或受保护的未跟踪资产。
- 先跑定向测试，再跑受影响的单元、PostgreSQL/Redis、Playwright、Prisma、build、audit、docs、hygiene 与 `git diff --check`。
- 未运行写 `NOT_RUN`，外部阻塞写 `BLOCKED_EXTERNAL`，真实样本不足写 `REAL_SAMPLE_NEEDED`。
- 正常 push 当前分支；不使用 `reset --hard`、force push 或历史改写；不合并、不标记 Ready。

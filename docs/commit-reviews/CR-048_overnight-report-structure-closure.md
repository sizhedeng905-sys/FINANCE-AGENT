# CR-048 Overnight report structure closure

## 目标

纠正 CR047 夜间总述虽有完整事实、但没有严格采用任务书规定的“一至十一”章节顺序，也缺少独立关键文件技术附录的问题。保持所有运行时、测试和外部门禁结论不变。

## 失败复现与根因

- 将 `docs/汇报/OVERNIGHT_FUNCTIONAL_SUMMARY_2026-07-23.md` 与夜间任务书第十二节逐项对照。
- CR047 版本把“明确未做、Demo 影响、测试、GitHub、剩余工作”等内容放入了不同编号，并以能力声明替代“十一、技术附录”。
- 根因是收口时优先合并事实内容，没有再次执行强制模板的章节级核对。
- 这是文档验收失败，不是运行时或财务行为失败；不能通过改名为“等价内容”跳过。

## 修改范围

- 严格重排夜间总述为任务书指定的一至十一结构。
- 每项功能补齐“之前 / 现在 / 对负责人有什么用 / 在哪里看到 / 验证状态 / 限制”。
- 测试表补充 Staging 合成门禁、目标 `NOT_RUN`、本机扫描 `BLOCKED_EXTERNAL` 和保留的中间失败。
- GitHub 章节补充运行时 SHA、文档追溯方式、push/PR/worktree 状态和受保护资产。
- 增加技术附录，逐项列 SHA/CR、关键文件、技术改动、功能意义、回滚影响和限制。

## Schema、API、UI 与财务影响

- Schema/migration、API、权限、UI：无变化。
- 财务金额、审批、幂等、BusinessRecord、ReportSnapshot 与 AI 边界：无变化。
- 最后运行时代码仍为 `5c16f3e`；CR048 只修改 Markdown。

## 测试证据

| 状态 | 命令 | 结果 |
| --- | --- | --- |
| `PASS` | 任务书章节逐项人工对照 | 一至十一、技术附录和真实性规则均有对应内容 |
| `PASS` | `npm run check:docs` | 145 files；221 local links |
| `PASS` | `npm run check:hygiene` | 866 tracked or candidate files |
| `PASS` | `git diff --cached --check` | 提交前重跑，要求 exit 0 |

运行时代码没有变化，因此不借 CR048 重复声明新的 473/125/22 证据；它引用 `5c16f3e` 的已完成本机和远端结果。最终 Demo reset/verify 在 CR047 push 后再次执行并通过，测试库处于明确合成基线。

## 攻击与边界

- 保留 CR044 远端失败、CR046 首次 Redis 配置失败、staging bundle 配置失败和开发库只读差异，不以最终绿色覆盖。
- 不把文档 HEAD 的 pending CI 写成运行时 PASS。
- 不读取或提交 `.env`、secrets、真实数据、模型权重或用户未跟踪资产。
- 不把 `CONDITIONAL_GO` 扩大为 production-ready。

## 限制

- 提交无法在自身内容中可靠写入自己的 SHA；最终 CR048 SHA 通过 `git log --follow` 追溯，并在交付消息中明确报告。
- 三次人工彩排、真实模型/财务真值、目标 Staging 与 owner UAT 仍未完成。
- CR048 push 后触发的 docs-only CI 可暂为 `PENDING`；不为追逐动态状态制造无限文档提交。

## 回滚

使用 `git revert <CR048-sha>` 只会恢复 CR047 的报告结构和索引，不改变运行时或数据库。若需要更正文案，优先新增可审查更正，不改写历史。

## 下一步

1. 正常 push，保持 PR #4 Draft。
2. 有界观察 CR048 workflow；若出现真实回归，读具体 step/log 后处理。
3. 剩余工作转交负责人彩排、真实样本、目标资源和 owner UAT。

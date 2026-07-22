# CR-049 Excel AI E2E retry isolation

## 目标

修复文档 HEAD `4e55dca` 的 GitHub Build #48 中唯一失败的浏览器场景，使 Excel AI 审核证据测试既使用精确 locator，也能在 CI retry 或重复执行时从隔离状态开始。

## 失败复现

- Workflow：[Build and acceptance run 29917551053](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29917551053)。
- 应用镜像 job、Prisma、build、473 单元和 125 PostgreSQL/Redis 集成均成功。
- Playwright 为 21 passed / 1 failed。
- 首次执行：截断的 mapping `outputHash` 同时出现在“AI 调用事实”和展开证据行，`evidenceCard.getByText(...)` 命中 2 个元素并触发 strict-mode failure。
- retry：首次执行已保存映射并产生 Mapping Profile；重试复用同一测试库，建议接口返回 `profile_reused`，不再满足测试所需的 `needs_finance_review` 新建议路径。

## 根因

1. Locator 只限定到整张证据卡，没有限定到刚展开的表格证据行。
2. Playwright CI retry 会启动新 worker，但不会自动清理 PostgreSQL 状态；该测试缺少自身的持久化状态前置清理。

## 修改范围

- 该状态型场景开始时调用仓库既有 `backend/scripts/cleanup-e2e.mjs`。
- 清理脚本继续强制数据库名以 `_test` 结尾，只删除 `E2E ` 标识的任务、记录、Profile、AI 证据与文件，并受 60 秒进程超时约束。
- hash 断言限定到 `.ant-table-expanded-row`，并使用 exact text；仍要求实际 mapping output hash 出现在展开证据中。
- 不接受 `profile_reused` 作为替代成功，不降低审核证据断言，不关闭 CI retry。

## Schema、API、UI 与财务影响

- Schema/migration、API、产品 UI：无变化。
- 财务审批、AI 建议、Mapping Profile、BusinessRecord 与报告运行时行为：无变化。
- 仅 E2E 测试隔离和 locator 精度变化。

## 测试证据

| 状态 | 命令/场景 | 结果 |
| --- | --- | --- |
| `FAIL` | CR048 GitHub Build #48 浏览器 E2E | 21 passed / 1 failed；首次 locator 重复，retry 状态污染 |
| `NOT_RUN` | 本机 Chromium + CI retry 配置 + `--repeat-each=2` | 本机缺 Playwright Chromium 1228；4 次均在 browser launch 前失败，0 场景执行；未临时下载 |
| `PASS` | 本机 Edge + `--retries=1 --repeat-each=2 --workers=1` | 2/2；30.9 秒；第二次开始前清理首次 Profile/record/task |
| `PASS` | 全量 `npm run test:e2e` | 22/22；约 1.4 分钟 |
| `PASS` | `npm run demo:test` | 1/1；22.2 秒；3 条记录，总额 `13422.21` |
| `PASS` | `npm run check:docs` | 146 files；222 local links |
| `PASS` | `npm run check:hygiene` | 867 tracked or candidate files |
| `PASS` | `git diff --cached --check` | 提交前最终执行，要求 exit 0 |

## 攻击与边界

- 非 `_test` 数据库会被既有清理脚本拒绝；不增加绕过开关。
- 清理失败会直接让测试失败，不吞异常或带脏状态继续。
- 重复执行仍必须重新获得真实 Mock AI 建议并走人工审核，不允许旧 Profile 掩盖测试路径。
- 精确 locator 校验展开行内 hash，不使用 `.first()` 隐藏卡片内的重复语义。
- 不触碰用户本地开发库、真实上传、模型容器、Staging secrets 或外部 Provider。

## 限制

- 该清理策略只用于此状态型 E2E；不把数据库清理引入产品运行时。
- 本机没有下载 CI 所需 Chromium；Linux Chromium 路径必须由新 SHA 的 GitHub Actions 验证。
- CI retry 仍可能暴露其他测试的独立状态问题；发现后应逐项修复，不能全局忽略 retry。
- Build #48 的 R5 fixture SBOM/Grype 因 E2E 红灯被跳过；最后运行时 `5c16f3e` 的 Build #46 对应步骤已通过，但 CR049 仍需自己的远端验收。

## 回滚

使用 `git revert <CR049-sha>`。回滚不涉及数据库 migration，但会恢复已复现的 strict locator 和 retry 污染风险。回滚后至少重跑目标场景两次和完整 Playwright。

## 下一步

1. 本机执行重复目标场景、全量 E2E 和 Friday Demo。
2. 正常 push，核对新 SHA 的 Build 两个 job、末端 R5 扫描与 CodeQL。
3. 通过后更新 PR 说明；不为动态 CI 状态追加无意义提交。

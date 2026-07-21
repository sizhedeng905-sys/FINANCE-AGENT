# 2026-07-21 夜间持续执行报告

## 基线

- 仓库：`sizhedeng905-sys/FINANCE-AGENT`
- 分支：`agent/b8-stable-hardening`
- Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 起始 SHA：`7a0fded95aa1fb78658c1dd173bdb33264ec539c`
- 当前远端 SHA：`7d363f6`；CR-014 正在本地收口
- 用户未跟踪文件、模型、本地数据、`.env`、上传物和本地扫描证据均保持未暂存。

## 执行台账

| 顺序 | CR | 主题 | 状态 | 下一动作 |
| --- | --- | --- | --- | --- |
| D | CR-009 | Production-safe system registry 复核 | `VERIFIED_NO_CODE_CHANGE` | 保留原实现 |
| A | CR-010 | 后端运行镜像移除无用 npm/Corepack | `ENGINEERING_VERIFIED` | 保持持续扫描 |
| B | CR-011 | Excel 到经营报告演示 E2E | `REMOTE_ENGINEERING_VERIFIED` | 人工三次演练 |
| C | CR-012 | 2026-07-24 可重复演示包 | `REMOTE_ENGINEERING_VERIFIED / HUMAN_REHEARSAL_NOT_RUN` | 人工三次演练 |
| E | CR-013 | Excel AI 前端 advisory bridge | `REMOTE_ENGINEERING_VERIFIED` | 保持人工草稿失败关闭边界 |
| F | CR-014 | Excel AI 审核决定与 provenance | `LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING` | 提交并观察 Build/CodeQL；继续确认页证据摘要 |

## CR-009 复核

- 阅读 CR 文档、汇报、实际 diff 与启动/acceptance 代码。
- `npm run system:acceptance` 重新通过：43 migrations；并发 bootstrap 精确 changed/unchanged；11 prompts、1 deployment、7 routes、1 audit；11 类业务计数均为 0；Mock、API、Worker 和漂移拒绝均成功。
- [Build run 29821449158](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29821449158)：PostgreSQL/E2E job 成功，容器 job 仅因最终镜像的全局 npm fixable Critical 失败。
- [CodeQL run 29821448996](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29821448996)：成功。
- 结论：registry 没有可复现缺陷，不修改、不另造 bootstrap。

## CR-010 当前证据

- 失败测试先证明 runtime image 和 Staging migration 的旧边界不满足任务书。
- 定向 Jest、50/464 单元、14/124 PostgreSQL + 强制 Redis、43 migration 双路径、system acceptance、双端构建、runtime、Staging 配置、17/17 Playwright 和双端 production audit 均通过。
- 本地镜像以 `10001:10001` 和默认 entrypoint 运行；npm/npx/Corepack 不存在，Node/OpenSSL/本地 Prisma 和编译入口有效。
- 新 SBOM 不再含基础镜像全局 npm 依赖树；固定 Grype 使用新数据库扫描通过，没有降低门禁。
- SHA `1abe513` 的 [Build run 29823851399](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29823851399) 与 [CodeQL run 29823851377](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29823851377) 均成功，容器供应链门禁已远端关闭。

## CR-011 当前证据

- 新增三行纯合成 Excel：`1250.25`、`8765.43` 公式缓存、`3406.53`，人工真值合计 `13422.21`。
- 财务 A 上传并选定工作表/表头；公式不执行且保留 warning；上传者不能审批。
- 批准前正式列表为 0、项目 structure 记录集合与金额不变、老板报告不变；通用 GET/PATCH/confirm/DELETE 均返回统一 404。
- 财务 B 重新校验并批准；同一 Idempotency-Key 重放返回同一结果，最终恰好 3 条 confirmed Excel 记录。
- 项目 structure、老板报告和 Snapshot 增量均为 3 条与 `13422.21`；`sourceDigest` 和 canonical `snapshotHash` 均从来源重算一致。
- 单条 E2E 1/1、完整 Playwright 18/18、后端 50/464、PostgreSQL + 强制 Redis 14/124、migration 双路径、双端 build、runtime 与双端 audit 全部通过。
- 提交 `aa7230a` 已随 CR-012 推送；SHA `66749b3` 的 Build run `29828098638` 与 CodeQL run `29828098718` 均成功。

## CR-012 当前证据

- 新增 `demo:reset/verify/api/web/test`，只接受 loopback PostgreSQL 和精确库名 `finance_agent_test`，production 与外部凭据失败关闭。
- 配置/攻击测试 6/6；实际 production 命令 exit 1；43 migration reset、账号/项目/模板/金额 verify 均通过。
- API/Web 实际启动后 readiness 与 200 smoke 通过，停止后无端口残留。
- 一键故事线收紧前后连续两次 1/1：用例 15.1-15.2 秒、总耗时 21.5-21.7 秒，每次 teardown 均清理任务、3 条记录、快照、文件引用和磁盘产物。
- 后端 50/464、runtime 4/4、前后端 build、43 migration 双路径、96 docs/167 links、768 candidates 与双端 production audit 全部通过；14/124 PostgreSQL/Redis 全量沿用 CR-011 同一业务基线，本提交未重复运行。
- `docs/deliveries/2026-07-24/` 已包含 Runbook、验收、限制和 2-4 周计划；三次人工演练明确为 `NOT_RUN`。

## CR-013/CR-014 当前证据

- CR-013 已随 SHA `7d363f6` 推送；[Build run 29831004356](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29831004356) 两个 job 与 [CodeQL run 29831004341](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29831004341) 均成功。
- CR-014 要求映射保存携带 expected task/review version；服务端在同一事务核验最新 AI task、canonical 输出哈希、版本向量、冻结模板、source/evidence、转换与最终字段，并持久化 accept/edit/reject/ignore、actor、revision 和最终结果。
- 攻击回归覆盖缺失/过期版本、旧输出、跨任务/模板、哈希和目标字段篡改、非法 edit、并发保存及重放；成功路径只生成四条审核决定、audit/ledger，不生成 BusinessRecord。
- 当前本地证据为 50/464 unit、完整 PostgreSQL/Redis 11 suites / 111 个实际执行测试（3 suites / 14 tests 按既有条件跳过）、Excel 专项 Playwright 6/6、44 migrations 双路径和双端 build。CR-014 的最终定向回归、文档门禁、提交与远端同 SHA 检查仍在执行。

## 周五演示判断

当前为 `CONDITIONAL_NO_GO`：CR-010 至 CR-013 已远端全绿，任务 B 自动化主故事和任务 C 离线运行包均有同 SHA 证据；三次人工演练仍为 `NOT_RUN`。CR-014 的服务端审核证据链已在本地通过，不依赖真实 OCR 或本地大模型，也不替代人工演练和 owner UAT。

## 恢复点

CR-014 提交前第一条命令：

```bash
npm run check:docs
```

随后执行 Excel AI 审核决定专项集成、后端 build、文档/repository/staged hygiene、diff 审查和提交。正常 push CR-014 并检查同 SHA Build/CodeQL；本地工程继续进入确认页 AI 审核证据摘要。

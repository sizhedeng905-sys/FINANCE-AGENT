# 2026-07-21 夜间持续执行报告

## 基线

- 仓库：`sizhedeng905-sys/FINANCE-AGENT`
- 分支：`agent/b8-stable-hardening`
- Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 起始 SHA：`7a0fded95aa1fb78658c1dd173bdb33264ec539c`
- 当前远端 SHA：`5580ce3`；本地 HEAD `2a59509`，CR-015 推送受阻，CR-016 正在本地收口
- 用户未跟踪文件、模型、本地数据、`.env`、上传物和本地扫描证据均保持未暂存。

## 执行台账

| 顺序 | CR | 主题 | 状态 | 下一动作 |
| --- | --- | --- | --- | --- |
| D | CR-009 | Production-safe system registry 复核 | `VERIFIED_NO_CODE_CHANGE` | 保留原实现 |
| A | CR-010 | 后端运行镜像移除无用 npm/Corepack | `ENGINEERING_VERIFIED` | 保持持续扫描 |
| B | CR-011 | Excel 到经营报告演示 E2E | `REMOTE_ENGINEERING_VERIFIED` | 人工三次演练 |
| C | CR-012 | 2026-07-24 可重复演示包 | `REMOTE_ENGINEERING_VERIFIED / HUMAN_REHEARSAL_NOT_RUN` | 人工三次演练 |
| E | CR-013 | Excel AI 前端 advisory bridge | `REMOTE_ENGINEERING_VERIFIED` | 保持人工草稿失败关闭边界 |
| F | CR-014 | Excel AI 审核决定与 provenance | `REMOTE_ENGINEERING_VERIFIED` | 保持服务端事实链和攻击回归 |
| G | CR-015 | 第二财务确认页证据摘要 | `LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL` | 网络恢复后正常推送 |
| H | CR-016 | 批准快照与本批正式记录定位 | `LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL` | 提交后与 CR-015 一并等待网络恢复 |

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

## CR-013 至 CR-015 当前证据

- CR-013 已随 SHA `7d363f6` 推送；[Build run 29831004356](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29831004356) 两个 job 与 [CodeQL run 29831004341](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29831004341) 均成功。
- CR-014 要求映射保存携带 expected task/review version；服务端在同一事务核验最新 AI task、canonical 输出哈希、版本向量、冻结模板、source/evidence、转换与最终字段，并持久化 accept/edit/reject/ignore、actor、revision 和最终结果。
- 攻击回归覆盖缺失/过期版本、旧输出、跨任务/模板、哈希和目标字段篡改、非法 edit、并发保存及重放；成功路径只生成四条审核决定、audit/ledger，不生成 BusinessRecord。
- CR-014 已随 SHA `5580ce3` 推送；[Build run 29834746500](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29834746500) 两个 job 与 [CodeQL run 29834746264](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29834746264) 均成功。
- CR-015 在确认页分页显示来源列、AI 建议、人工决定、最终字段、操作者、revision、模板/转换/evidence 与哈希。任务/账号/分页切换的晚到请求被丢弃，证据读取失败时批准按钮失败关闭，纯人工空集合保持可用。
- CR-015 当前本地证据为单场景 1/1、Excel AI 专项 3/3、完整 Playwright 21/21 和前端 production build；teardown 清理后磁盘文件残留为 0。本地提交 `2a59509` 连续三次因连接重置或无法连接 `github.com:443` 推送失败，已按规则标记外部阻断。
- CR-016 先以周五 E2E 复现批准后跳入未过滤记录页，再让 URL、Store 与真实 API 使用同一个 `importTaskId`；确认页只读展示 `excel-approval/1.0` 批准人、记录数、revision 与哈希，并可返回同批正式记录。周五 1/1、Excel 4/4、完整 Playwright 21/21、runtime 4/4 和 build 通过。

## 周五演示判断

当前为 `CONDITIONAL_NO_GO`：CR-010 至 CR-014 已远端全绿，任务 B 自动化主故事和任务 C 离线运行包均有同 SHA 证据；三次人工演练仍为 `NOT_RUN`。CR-015/CR-016 的审核与批准证据链已在本地通过，但尚未推送取得同 SHA CI，也不替代人工演练和 owner UAT。

## 恢复点

CR-016 提交前第一条命令：

```bash
npm run check:docs
```

随后执行文档/repository/staged hygiene、diff 审查和提交。GitHub 网络恢复后正常 push 当前分支并检查 CR-015/CR-016 最新 SHA 的 Build/CodeQL；在此之前继续保持 `REMOTE_PUSH_BLOCKED_EXTERNAL`，PR 保持 Draft。

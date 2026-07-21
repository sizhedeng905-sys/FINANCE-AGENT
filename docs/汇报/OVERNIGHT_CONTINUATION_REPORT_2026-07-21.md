# 2026-07-21 夜间持续执行报告

## 基线

- 仓库：`sizhedeng905-sys/FINANCE-AGENT`
- 分支：`agent/b8-stable-hardening`
- Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 起始 SHA：`7a0fded95aa1fb78658c1dd173bdb33264ec539c`
- 当前 SHA：`1abe513b0392e367dc4242930a6022dbf4e7bc8e`；CR-011 尚未提交
- 用户未跟踪文件、模型、本地数据、`.env`、上传物和本地扫描证据均保持未暂存。

## 执行台账

| 顺序 | CR | 主题 | 状态 | 下一动作 |
| --- | --- | --- | --- | --- |
| D | CR-009 | Production-safe system registry 复核 | `VERIFIED_NO_CODE_CHANGE` | 保留原实现 |
| A | CR-010 | 后端运行镜像移除无用 npm/Corepack | `ENGINEERING_VERIFIED` | 保持持续扫描 |
| B | CR-011 | Excel 到经营报告演示 E2E | `LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING` | 提交、push、观察 Build/CodeQL |
| C | 待分配 | 2026-07-24 可重复演示包 | `NOT_STARTED` | CR-011 远端绿色后开始 |
| E | 待分配 | Excel AI 前端 advisory bridge | `DEFERRED_BY_GATE` | A-C 稳定后开始 |

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

## 周五演示判断

当前为 `CONDITIONAL_NO_GO`：CR-010 已远端全绿，任务 B 的自动化主故事也已本地通过；但 CR-011 新 SHA 尚未取得远端绿色，任务 C 的离线运行包和三次人工演练记录仍未完成。主故事不依赖真实 OCR 或本地大模型。

## 恢复点

CR-011 提交前第一条命令：

```bash
npm run check:docs
```

随后依次执行 repository/staged hygiene、diff 审查、提交、正常 push，并检查该 SHA 的 Build 与 CodeQL。远端绿色后进入任务 C，不先做 Excel AI UI。

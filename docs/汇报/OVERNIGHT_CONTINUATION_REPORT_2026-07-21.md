# 2026-07-21 夜间持续执行报告

## 基线

- 仓库：`sizhedeng905-sys/FINANCE-AGENT`
- 分支：`agent/b8-stable-hardening`
- Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
- 起始 SHA：`7a0fded95aa1fb78658c1dd173bdb33264ec539c`
- 当前 SHA：提交前仍为 `7a0fded95aa1fb78658c1dd173bdb33264ec539c`
- 用户未跟踪文件、模型、本地数据、`.env`、上传物和本地扫描证据均保持未暂存。

## 执行台账

| 顺序 | CR | 主题 | 状态 | 下一动作 |
| --- | --- | --- | --- | --- |
| D | CR-009 | Production-safe system registry 复核 | `VERIFIED_NO_CODE_CHANGE` | 保留原实现 |
| A | CR-010 | 后端运行镜像移除无用 npm/Corepack | `LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING` | 提交、push、观察 Build/CodeQL |
| B | 待分配 | Excel 到经营报告演示 E2E | `NOT_STARTED` | CR-010 远端绿色后开始 |
| C | 待分配 | 2026-07-24 可重复演示包 | `NOT_STARTED` | 任务 B 通过后开始 |
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

## 周五演示判断

当前为 `CONDITIONAL_NO_GO`：既有核心业务 E2E 通过，但 CR-010 新 SHA 尚未取得远端绿色，而且任务 B 的完整“Excel 到确定性经营报告”演示证据尚未建立。主故事不依赖真实 OCR 或本地大模型。

## 恢复点

CR-010 提交前第一条命令：

```bash
npm run check:docs
```

随后依次执行 repository/staged hygiene、diff 审查、提交、正常 push，并检查该 SHA 的 Build 与 CodeQL。远端绿色后进入任务 B，不先做 Excel AI UI。

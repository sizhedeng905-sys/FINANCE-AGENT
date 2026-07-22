# CR-044 Prisma format gate recovery

## 目标

恢复 Draft PR #4 的 Prisma 格式门禁，使远端 `Validate Prisma schema and migrations` 不再在后续构建、PostgreSQL/Redis 集成和 Playwright E2E 之前提前失败。

## 失败复现与起始事实

- 起始本地 SHA：`5222553bcd74c56c39a9a2b1e8e2ffd2dfeff677`。
- 起始 upstream：`4288253c90630b5294a71e1d4f93d6e73defe660`。
- `cd backend && npx prisma format --check`：`FAIL`，exit 1，提示存在未格式化文件。
- 远端 upstream 的 Build and acceptance 在同一门禁类型上失败，后续测试未执行；旧 SHA 的其他绿色结果不能替代本修复的同 SHA CI。

## 根因

近期给 `User`、`ReportNarrative` 和 `ReportNarrativeReviewDecision` 增加关系字段后，schema 语义已经过 migration 和业务测试，但提交前没有再次执行 Prisma formatter。CI 已有正确的 `prisma format --check`，缺陷是提交内容未满足已有门禁，不是 CI 缺少规则。

## 修改范围

- 仅由 Prisma 6.19.3 formatter 调整 `backend/prisma/schema.prisma` 的字段列对齐空格。
- 没有新增、删除或重命名 model、字段、relation、index、constraint、enum 或 migration。
- 不增加重复的 Git hook；完整本地验收命令保留在本审查记录中，避免 docs-only 提交被不稳定的服务依赖阻塞。

## Schema、API、UI 与财务影响

- Schema 语义：无变化。
- Migration：无新增或修改；仍为 51 个既有 migration。
- API/UI：无变化。
- 财务金额、状态、审批、幂等和正式写库：无变化。
- 周五 Demo：运行行为无变化；本 CR 只恢复远端门禁继续执行的条件。

## 攻击与边界检查

- 审查 formatter diff，确认只有空格对齐，未把语义变更伪装成格式修复。
- 数据库命令只使用 `127.0.0.1` 上的 `finance_agent_test` 和脚本临时创建的 `_test` 数据库。
- 未读取或输出 `.env.test` 中的凭据，只输出协议、loopback 主机和测试数据库名。
- 空库安装和上一版到当前版升级均真实执行；临时数据库由现有脚本清理。
- 工作区中未提交的 CR045 供应链文件与用户未跟踪资产没有进入本 CR 的暂存范围。

## 测试证据

| 状态 | 命令/场景 | 结果 |
| --- | --- | --- |
| `FAIL` | `cd backend && npx prisma format --check`（修复前） | exit 1，真实复现格式门禁红灯 |
| `PASS` | `cd backend && npx prisma format --check`（修复后） | 所有 Prisma 文件格式正确 |
| `PASS` | `cd backend && npx prisma validate` | schema 有效 |
| `PASS` | `cd backend && npx prisma generate` | Prisma Client 6.19.3 生成成功 |
| `PASS` | `npm run test:e2e:prepare` | loopback 测试库完成 51 migration 检查、清理和合成 seed |
| `PASS` | 隔离环境 `prisma migrate status` | 51 migration，测试库已是最新 |
| `PASS` | 隔离环境 `scripts/verify-database.ts` | 51 个应用表无缺失、无意外表；245 个索引、101 个外键 |
| `PASS` | `cd backend && npm run db:migration-paths` | 空库 51/51；升级路径 50→51；exit 0，约 11.8 秒 |

远端 Build and acceptance 与 CodeQL：提交并 push 前为 `NOT_RUN`；必须绑定本 CR 的新 SHA 重新判定。

## 限制

- 本 CR 不能证明远端 CI 已恢复；只有 push 后同 SHA 的完整 workflow 可以关闭该门禁。
- 本 CR 不代表真实业务数据库升级或生产部署已执行。
- 三次人工 Demo 彩排和 owner UAT 保持 `NOT_RUN`。

## 回滚

如需回退，仅对本提交使用 `git revert <sha>`。回退会重新引入 Prisma 格式门禁失败，但不会改变数据库语义；禁止使用 `reset --hard`、rebase 或 force push。

## 下一步

1. 提交并有限重试 push，核对同 SHA 的 PostgreSQL integration and E2E 与 CodeQL。
2. 执行完整周五 Demo 组合，确认 3 条正式记录与总额 `13422.21`。
3. 继续独立的 CR045 依赖、安装脚本与应用镜像扫描刷新。

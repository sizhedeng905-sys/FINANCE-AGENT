# R9.3A 导入确认事务超时恢复报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally`
> 对应问题：`R9-CONFIRM-RECOVERY-001`

## 问题与复现

R9.3 全量 PostgreSQL/Redis 回归首次出现 30,196 行已全部处理、30,196 条暂存记录已生成，但最终发布结果变为 `confirmation_failed`。第一次运行随后出现数据库连接连锁错误，因此没有据此修改代码；隔离重跑和保留容器日志后确认 PostgreSQL 没有 OOM 或退出。

第二次默认 PostgreSQL 全量运行稳定复现：WAL checkpoint 持续约 153 秒，最终发布事务达到 Prisma 120 秒事务上限并返回 `P2028`。旧 `isTransientDatabaseError` 只识别连接、超时和连接池错误，不识别事务 API 超时或写冲突，导致可恢复故障被错误固化为终态失败。相同运行中的 49,999 行在 checkpoint 结束后正常通过，证明问题不是数据内容或审批哈希不一致。

## 修复

- 将 Prisma `P2028`（事务 API 超时/关闭）和 `P2034`（写冲突/死锁）加入后台确认的可恢复数据库错误集合。
- 可恢复错误不会确认或删除暂存记录，也不会写终态失败；当前 Worker 释放租约并把 `leaseUntil` 设为已过期。
- 现有 reaper 从 PostgreSQL 持久事实领取新租约和新 attempt，重新校验批准快照、来源、模板、账号、项目权限和完整性后再发布。
- 恢复仍受 `IMPORT_CONFIRM_MAX_ATTEMPTS` 限制。不可恢复的业务校验、账号停用、模板变化和审批快照失效继续失败关闭。
- 稳定记录 ID、唯一约束、项目写锁和最终事务保证重试不会重复 `BusinessRecord`、ledger 或通知。
- 集成性能摘要增加安全的 `errorMessage` 字段，失败时可区分终态业务错误与通用后台故障；不记录原始文件、凭据或 SQL 参数。

## 测试证据

| 命令/场景 | 结果 | 说明 |
| --- | --- | --- |
| PostgreSQL 定向 transient recovery | 1 suite / 3 tests passed | P1001、P2028、P2034 各注入一次；第二租约完成，记录数精确且 `confirmationAttempts=2` |
| 修复前默认全量 integration | 12/13 suites、110/111 tests passed | 30,196 行在 157.872 秒进入错误终态；PostgreSQL 存活、无 OOM，作为红灯证据保留 |
| 修复后默认全量 integration | 13/13 suites、113/113 tests passed | 41 migrations、seed、PostgreSQL 全业务和三类 Redis suite 全绿 |
| `npm run build` | exit 0 | Prisma generate、应用与脚本 TypeScript 构建 |
| `npm test` | 47 suites / 428 tests passed | 后端全量单元回归 |
| `git diff --check` | exit 0 | 无空白错误 |

修复后全量集成耗时 426.246 秒。30,196 行在一次真实 P2028 后由自动 reaper 接管，于 167.004 秒完成并只发布一次；49,999 行于 98.177 秒完成。依赖容器检查为 running、OOM false，测试结束后临时容器已清理。

## 剩余风险

1. 本机 30,196 行耗时距 180 秒测试预算仅约 13 秒，不能外推为目标服务器容量结论。
2. H13 必须在目标磁盘、PostgreSQL WAL/checkpoint 参数和真实并发下重跑 5,000/30,196/49,999/50,000 行边界，记录 p95/p99、连接、WAL、checkpoint 和恢复次数。
3. 若目标环境频繁触发 P2028，应先优化数据库 I/O、索引和事务设计，不得只增大超时或无限重试。
4. 当前自动恢复最多三次，达到上限后保持失败关闭并要求人工调查；不会静默部分入账。

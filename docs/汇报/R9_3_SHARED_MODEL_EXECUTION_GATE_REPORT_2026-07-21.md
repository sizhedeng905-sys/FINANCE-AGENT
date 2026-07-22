# R9.3 多实例模型执行门验收报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally`
> 对应问题：`R9-SCALE-001` / `B8-STAGING-003`（模型子项）

## 结论

AI 文本、Paddle OCR 与会执行真实推理的模型健康探针已从单进程队列迁移为可显式选择的 `memory|redis` 执行门。生产配置强制 `MODEL_EXECUTION_GATE_STORE=redis`；Redis 在启动或运行中不可用时失败关闭，不会回退到进程内状态，也不会绕开模型并发预算。

R9.1-R9.3 的登录、上传和模型三类代码层共享控制至此均已关闭本地工程子项。提供的 Staging Compose 仍固定为单 API、单 Worker；H13/H14 尚未给出并验收目标服务器拓扑、容量、恢复和回退，因此不能据此宣称横向扩容或 production-ready。

## 实现边界

- Redis Lua 以一个原子操作清理过期租约、排队、获取或释放许可；使用 Redis `TIME`，不依赖不同主机本地时钟。
- 每个部署使用 FIFO ticket ZSET、等待租约 ZSET、活跃执行租约 ZSET、序列和共享并发上限。多个实例提交不同上限时，活动周期采用最保守值。
- 原始部署键只在进程内使用；Redis key 与公开 snapshot 标签使用 SHA-256 摘要，避免暴露 Provider URL、模型或配置身份。
- 全局队列长度和等待超时由 Redis 原子状态约束。等待者崩溃、执行实例崩溃或未正常释放时，短租约由后续原子操作回收。
- 长任务按执行租约三分之一周期续租。续租失败会中止正在执行的 Provider 请求并失败关闭。
- `ResilientHttpClientService` 合并请求超时和执行门信号；租约中止不会继续重试，也不会把共享控制故障计入 Provider 熔断失败。
- AI HTTP、Paddle OCR 与 OCR task Worker 都传递执行门信号；真实推理型健康探针使用同一部署键，不能另开旁路耗尽 GPU。
- readiness 与 metrics 从 Redis 读取当前进程已观察到的部署键之共享状态。它们不是全集群部署发现机制；持久任务总量仍以 PostgreSQL 队列指标为准。
- `memory` 仅用于本地开发和普通单元测试。生产校验拒绝 `memory`、非法模式、缺失 Redis URL、越界队列/租约/轮询参数和不安全的参数关系。

## 配置

```text
MODEL_EXECUTION_GATE_STORE=memory|redis
MODEL_MAX_QUEUE=20
MODEL_QUEUE_WAIT_TIMEOUT_MS=60000
MODEL_EXECUTION_LEASE_MS=30000
MODEL_QUEUE_WAITER_LEASE_MS=5000
MODEL_QUEUE_POLL_MS=100
```

Staging Compose 固定设置 `MODEL_EXECUTION_GATE_STORE=redis`。Redis 只保存可过期运行许可，不保存业务任务事实；Import/OCR/AI 的持久状态、审计和恢复依据仍在 PostgreSQL。

## 本地测试证据

| 命令/场景 | 结果 | 说明 |
| --- | --- | --- |
| 定向 model/config/health/metrics/staging Jest | 5 suites / 105 tests passed | 内存兼容、生产配置、健康旁路关闭、租约中止与静态 Compose 门禁 |
| Redis 专项 integration Jest | 1 suite / 6 tests passed | 双实例 100 路并发、FIFO、全局队列、等待超时、长任务续租、崩溃恢复、断连失败关闭和 key 脱敏 |
| `npm run build` | exit 0 | Prisma generate、应用与脚本 TypeScript 构建 |
| `npm test` | 47 suites / 428 tests passed | 后端全量单元回归 |
| `npm run test:integration` | 13 suites / 113 tests passed | 41 migrations、seed、PostgreSQL 全量业务回归和三类强制 Redis 集成 |
| `git diff --check` | exit 0 | 无空白错误 |

完整集成最终耗时 426.246 秒；30,196 行场景在一次真实事务超时后由相邻恢复修复接管，于 167.004 秒完成，49,999 行场景于 98.177 秒完成。PostgreSQL 与 Redis 均保持运行、无 OOM；临时测试容器已清理，仅用户原有 Qwen text 与 Paddle OCR 常驻容器继续运行。

## 仍待完成

1. H13/H14 指定目标服务器、正式拓扑、Redis 高可用/容量、恢复与保留政策。
2. 在目标 Linux Staging 执行真实多 API/Worker release、故障注入、restore、RPO/RTO 和 rollback；当前 Compose 不擅自扩容。
3. 本地提交成功推送后等待 GitHub Build/CodeQL 运行；远端证据出现前状态只写 `engineering_verified_locally`。
4. 不合并 Draft PR、不转 Ready、不部署生产，直到 H12-H16 和最终人工 UAT 完成。

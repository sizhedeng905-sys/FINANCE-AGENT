# R9.2 多实例上传准入验收报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally`
> 对应问题：`R9-SCALE-001` / `B8-STAGING-003`（上传子项）

## 结论

上传并发数、在途字节和请求速率已从单进程 `Map` 升级为可显式选择的 `memory|redis` 存储。生产配置强制 `UPLOAD_ADMISSION_STORE=redis`；Redis 在启动或运行中不可用时失败关闭，不回退到进程内状态。

本阶段只关闭上传子项。模型并发与等待队列仍为进程内状态，Compose 继续固定为单 API、单 Worker；整个 `R9-SCALE-001` 保持 `in_progress`，不得据此宣称已可横向扩容或 production-ready。

## 实现边界

- Redis Lua 在一个原子操作内清理过期租约、记录速率尝试，并检查每用户并发数与在途字节预算。
- Redis 使用服务器 `TIME`，不依赖不同 API 主机的本地时钟。
- 用户 ID 经规范化后仅以 SHA-256 摘要进入 Redis key；活跃成员使用随机 UUID，Redis 不保存原始用户标识。
- 活跃上传使用短租约。拦截器在请求存活期间按租约三分之一间隔续租；实例崩溃或连接丢失后，过期槽位由下一次原子操作回收。
- 正常完成和下游同步异常均释放 reservation；共享存储健康时，HTTP Observable 在释放完成后才结束响应。客户端取消时也触发幂等释放。
- 速率窗口在实例重启后保留；并发拒绝仍计入速率尝试，与原单机语义一致。
- Redis 数据结构异常、租约丢失或连接中断均返回 503/失败关闭；不会静默切回 `memory`。
- 本地开发和普通单元测试可显式使用 `memory`。生产校验拒绝 `memory`、非法存储模式、缺失 Redis URL 和越界租约。

## 配置

```text
UPLOAD_ADMISSION_STORE=memory|redis
UPLOAD_ADMISSION_LEASE_MS=30000
UPLOAD_MAX_CONCURRENT_PER_USER=5
UPLOAD_MAX_INFLIGHT_MB_PER_USER=260
UPLOAD_RATE_WINDOW_MS=60000
UPLOAD_RATE_MAX_PER_USER=60
```

Staging Compose 已固定 `UPLOAD_ADMISSION_STORE=redis`。CI 的 PostgreSQL/E2E job 已有固定 digest Redis 8.2.3 service，并以 `REQUIRE_REDIS_INTEGRATION=true` 强制真实 Redis suite；缺少测试地址时直接失败，不跳过。

## 本地测试证据

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| 定向 config/upload/staging Jest | 3 suites / 81 tests passed | 内存语义、异步释放、生产配置和 Compose 静态门禁 |
| Redis 专项 integration Jest | 1 suite / 4 tests passed | 双实例 100 路竞争仅 2 个获准、重启保持速率、续租与崩溃回收、断连 503、原始用户 ID 不进入 key |
| `npm run build` | exit 0 | Prisma generate、应用与脚本 TypeScript 构建 |
| `npm test` | 47 suites / 422 tests passed | 后端全量单元回归 |
| `npm run test:integration` | 12 suites / 105 tests passed | 41 migrations、seed、PostgreSQL 全量业务回归与强制 Redis 集成 |
| `git diff --check` | exit 0 | 无空白错误 |

完整集成耗时 258.106 秒；30,196 行场景 22.573 秒，49,999 行场景 100.328 秒。测试使用一次性 PostgreSQL/Redis 容器，结束后已清理；仅用户原有的 Qwen text 与 Paddle OCR 常驻容器继续运行。

## 仍待完成

1. R9.3：模型并发与等待队列改为共享控制，覆盖公平释放、等待超时、实例重启和 Provider 故障。
2. 本地 R9.1、R9.1A、R9.2 提交仍需成功推送并等待 GitHub Build/CodeQL 真实执行；此前状态只写 `engineering_verified_locally`。
3. H13/H14 仍决定目标服务器、正式拓扑、容量、恢复和保留政策；本阶段不部署生产、不合并 Draft PR。

# R9.1 多实例登录限流验收报告

> 日期：2026-07-21
> 状态：`engineering_verified_locally`
> 对应问题：`R9-SCALE-001` / `B8-STAGING-003`（登录子项）

## 结论

登录口令尝试已从单进程 `Map` 升级为可显式选择的 `memory|redis` 存储。生产配置强制 `LOGIN_RATE_LIMIT_STORE=redis`；Redis 未连接或运行中断连时失败关闭，不会回退到进程内状态，也不会签发 JWT。

本阶段只关闭登录子项。上传准入和模型并发/排队仍为进程内状态，Compose 继续维持单 API、单 Worker；`R9-SCALE-001` 保持 `in_progress`，不得据此宣称可横向扩容或 production-ready。

## 实现边界

- Redis Lua 脚本在一个原子操作内检查并占用全局、账号、IP、账号+IP 四层并发预算。
- 账号、IP 和组合键只保存 SHA-256 摘要；Redis key 不包含原始用户名或 IP。
- 尝试使用随机 token 和短租约。进程崩溃、连接丢失或未执行释放时，租约到期后由下一次原子操作回收。
- 租约使用 Redis `TIME`，不依赖不同 API 主机的本地时钟。
- 成功、失败和仅释放使用幂等完成标记；重复完成不会重复累计失败次数。
- 成功登录清除账号与账号+IP 的失败计数，但保留 IP 级防喷洒计数，与旧单机语义一致。
- 认证服务等待共享状态完成后才签发 JWT。凭据正确但共享保护不可用时返回 503，并写认证失败审计。
- 本地开发和普通单元测试仍可显式使用 `memory`；生产环境校验拒绝 `memory`、非法模式、无 Redis URL 和越界窗口/租约。

## 配置

```text
LOGIN_RATE_LIMIT_STORE=memory|redis
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_BLOCK_MS=900000
LOGIN_RATE_LIMIT_LEASE_MS=30000
```

Staging Compose 已固定为 `redis`。CI PostgreSQL/E2E job 增加固定 digest 的 Redis 8.2.3 service，并设置 `REQUIRE_REDIS_INTEGRATION=true`，缺失 Redis 测试地址会直接失败而不是跳过。

## 本地测试证据

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test -- --runTestsByPath test/login-rate-limit.spec.ts test/config.spec.ts` | 2 suites / 66 tests passed | 内存边界、键脱敏、幂等完成、失败关闭、生产配置 |
| Redis 专项 integration Jest | 1 suite / 4 tests passed | 双客户端 100 路并发仅 5 个获准、重启保持、租约恢复、断连 503 |
| `npm run build` | exit 0 | Prisma generate、应用与脚本 TypeScript 构建 |
| `npm test` | 47 suites / 418 tests passed | 最终后端全量单元回归 |
| `npm run test:integration` | 11 suites / 101 tests passed | 41 migrations、PostgreSQL 全量业务回归与强制 Redis 集成 |
| `git diff --check` | exit 0 | 无空白错误 |

完整集成耗时 239.6 秒；其中 30,196 行和 49,999 行导入资源场景均通过。测试使用一次性 PostgreSQL/Redis 容器，结束后已确认无 `finance-agent-r9-*` 容器残留。

补充全量回归的第一次运行出现 1 次既有 Excel 嵌入媒体 shared-string 未解析，结果为 46/47 suites、417/418 tests；该用例隔离复跑及随后未改断言/超时的全量复跑均通过。当前没有把重跑绿色当作根因修复，已登记 `R9-XLSX-STREAM-001` 并继续按失败关闭方向处理。

## 仍待完成

1. R9.2：上传并发、在途字节和速率改为共享原子准入，覆盖跨实例竞争、崩溃租约与存储中断。
2. R9.3：模型并发与等待队列改为共享控制，覆盖公平释放、超时、实例重启和 Provider 故障。
3. 本提交推送后等待 GitHub Build/CodeQL 真实执行；在远端绿色证据出现前，状态只写 `engineering_verified_locally`。
4. H13/H14 仍决定目标服务器、正式拓扑、容量、恢复和保留政策；本阶段不部署生产、不合并 Draft PR。

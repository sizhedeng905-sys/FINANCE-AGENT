# CR-009 Production-safe AI 系统登记验收报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

状态：`ENGINEERING_VERIFIED`

## 1. 目标与结论

CR-009 关闭了“空白 production-like 数据库无法在不写入演示业务数据的情况下建立 AI Prompt、模型部署和任务路由”的工程缺口。

实现复用现有 `AiPromptVersion`、`ModelDeployment`、`TaskModelRoute` 和 `AuditLog`，没有新增平行模型，也没有新增 migration。生产初始化从业务 seed 中分离为三个明确步骤：

```bash
npm run prisma:migrate:deploy
npm run system:bootstrap
npm run system:verify
```

独立空白 `_test` 数据库已验证 43 条 migration、两个并发 bootstrap 精确收敛为 changed/unchanged、Mock Provider 真调用、API/Worker 启动校验和配置漂移拒绝。系统表最终为 11 个 Prompt、1 个 Mock deployment、7 条 route 和 1 条 bootstrap audit；用户、项目、模板、字段、项目模板、业务记录、工单、文件、Excel/OCR 任务及旧模型配置均为 0。

该结论只证明本地工程与合成验收，不代表真实模型准确率、目标 Linux Staging、真实恢复演练、生产凭据或最终 UAT 已完成。

## 2. 配置边界

新增 `AI_SYSTEM_REGISTRY_PROFILE`：

- `development-local-v1`：登记 Mock、Qwen text/VL/embedding 和 PaddleOCR；除 Mock 外默认禁用。
- `mock-safe-v1`：只登记一个显式 Mock deployment 和 7 条建议/报告路由，用于测试与受控 Staging。
- `custom`：从 `AI_SYSTEM_REGISTRY_MANIFEST_JSON` 读取严格 JSON manifest。

新增 `AI_SYSTEM_REGISTRY_STARTUP_MODE=disabled|verify`。production 必须显式选择 profile 且固定为 `verify`；非法值会拒绝启动。自定义 manifest 具备大小、深度、节点、数组和字符串预算，并拒绝未知属性、重复键、原型污染键、控制字符、非法 URL、URL 凭据、query/fragment 和非 HTTPS 外部端点。

部署凭据只允许通过 `secretRef` 指向大写环境变量名，manifest 与数据库均不保存 secret 值。启用的部署缺少对应环境变量时，验证失败关闭。

## 3. 不可变登记与幂等

`system:bootstrap` 在 serializable 事务中取得 PostgreSQL advisory transaction lock，然后执行完整 preflight。两个发布实例并发首次初始化时，`P2002/P2034` 只在三次有界事务预算内重试；空库 acceptance 会同时启动两个 bootstrap 进程，并要求结果精确收敛为一次 `changed`、一次 `unchanged`。

- 同一 Prompt key/version 的内容或 hash 不一致时拒绝覆盖；
- 已退役 Prompt 不允许重新激活；
- 同一 deployment key 的 provider、模型、endpoint、secret ref、任务白名单、并发或超时漂移时拒绝覆盖；
- route priority 或 fallback policy 漂移时拒绝覆盖；
- manifest 外的启用 Prompt、deployment 或 route 失败关闭；
- route 启用但 deployment 禁用时验证失败；
- 只补齐缺失系统行，不覆盖人工维护的启用状态或健康状态。

第一次发生系统变更时写一条 `system_registry.bootstrap` audit，metadata 只含 Schema/profile/manifest hash 和变更计数。完全相同的第二次执行为零写入，也不会增加审计。

## 4. 启动与调用验证

API 和 Worker 共用 `SystemRegistryStartupVerifier`。当启动模式为 `verify` 时，Nest application bootstrap 必须在监听或领取任务前验证当前数据库登记；缺失、漂移、未知启用项或 secret 缺失都会阻止进程就绪。

`system:verify:smoke` 从数据库读取 `excel_column_mapping` 的启用 route 和版本化 Prompt bundle，调用真实 `MockAiProviderService.generate`，再经过严格映射 Schema 和白名单验证。结果必须保持 `NEEDS_FINANCE_REVIEW`，且不会创建 `BusinessRecord`、AI 调用日志或其他业务数据。

## 5. Seed 与 Staging

通用 `prisma/seed.ts` 删除了重复的 Prompt/deployment/route 写入实现，改为调用共享 bootstrap，再继续创建明确的本地演示业务数据。生产和 production-like 环境不得运行该业务 seed。

Staging migration 容器顺序调整为：

```text
migrate deploy -> runtime grants -> system bootstrap -> gated synthetic staging seed
```

Staging 固定使用 `mock-safe-v1 + verify`。合成 seed 仍受原有显式门禁约束，不会因为 system bootstrap 自动运行而进入生产。

## 6. 自动验收证据

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 后端单元 | `passed` | 50 suites / 464 tests |
| PostgreSQL/Redis 集成 | `passed` | 14 suites / 124 tests，普通与强制 Redis 分组均实际执行 |
| System registry 专项 | `passed` | 5 个 PostgreSQL 集成用例，覆盖幂等、零业务写入、Prompt/deployment/route 漂移、未知启用项和 secret ref |
| 空库 system acceptance | `passed` | 43 migrations；两个并发进程精确收敛为 changed/unchanged；11/1/7/1 系统计数；11 类业务计数为 0；API/Worker/Mock/drift 断言通过 |
| Migration 双路径 | `passed` | 空库 43 条及 42 到 43 升级 |
| 前端 runtime | `passed` | 4/4 |
| 前端 build | `passed` | TypeScript 与 Vite production build |
| 后端 build | `passed` | Prisma generate 与 TypeScript build |
| Playwright | `passed` | 17/17，58.2 秒；真实 prepare/seed 顺序与 teardown 清理通过 |
| Production dependency audit | `passed` | 根目录与后端均为 0 vulnerabilities |

空库 acceptance 使用临时随机 `_test` 数据库和固定 digest 的临时 Redis 容器。脚本拒绝非 `_test` 数据库，结束后删除数据库、容器和临时目录；命令失败标签不会输出一次性 Redis 凭据。

## 7. 边界与攻击验证

- 重复 JSON key、`__proto__`、`constructor`、超深/超大 JSON、未知属性和非法枚举被拒绝。
- endpoint 内用户名、密码、query、fragment、私网/loopback 外部字面 IP 和非 HTTPS 外部 URL 被拒绝。
- manifest 的 deployment/task/route 重复、route 越过任务白名单、启用 route 指向禁用 deployment 被拒绝。
- Prompt 内容漂移、deployment 超时漂移、route policy 漂移和 manifest 外启用配置不会被静默修正。
- 两个同时启动的 bootstrap 只产生同一组系统事实，一次执行变更，另一次重放不写 audit。
- 故意把 Mock deployment timeout 从 5000 改为 9999 后，API 启动按预期失败；恢复后再次 verify 通过。
- Mock smoke 只生成建议，不批准、不入账、不写业务事实。

## 8. 运维方式

本地开发可使用默认 `development-local-v1` 且将启动验证保持 `disabled`，先按需运行 bootstrap/verify。production 必须显式设置 profile 并启用启动验证。推荐发布顺序：

```bash
cd backend
npm ci
npm run build
npm run prisma:migrate:deploy
npm run system:bootstrap
npm run system:verify
npm run start
```

Worker 使用同一数据库和同一 manifest/profile 启动，不能由前端参数选择 Provider 或扩大服务端路由。

Migration 与 bootstrap 使用受控发布/迁移数据库角色；API/Worker 运行角色只执行 verify，不能为了初始化而获得 Schema 或系统登记维护权限。

## 9. 剩余风险

- `development-local-v1` 的本地模型项默认禁用；CR-009 没有声明真实 Qwen/Paddle 业务准确率通过。
- 外部 Provider 仍受 H12 数据传输授权约束；未批准时必须继续禁用真实数据调用。
- 外部自定义 endpoint 已阻止私网字面 IP，但受信任配置的 DNS 解析和网络层 egress 仍需目标环境策略共同约束。
- 目标 Linux Staging、真实 secret 注入、模型网络、restore/RPO/RTO/rollback 和 owner UAT 尚未完成。
- 本次没有修改数据库 Schema，因此没有新增 migration；回滚代码不会自动删除已经创建的系统登记行，应先恢复兼容 manifest 或按受控运维流程处理。

## 10. 下一步

下一工程子块是 Excel AI 前端审核闭环：接入真实建议 API，显示 Prompt/模型/Mock 来源与 warning，支持逐列接受、修改、拒绝和重新校验，并在最终批准快照中冻结实际 MappingDecision/provenance。AI 不可用时继续走完整手工路径。

# CR-009：Production-safe AI 系统登记初始化

## 1. 提交目的

把 Prompt Registry、模型部署和任务路由从“随演示 seed 一起写入”拆成可在空白 production-like PostgreSQL 独立执行的系统初始化步骤，并在 API/Worker 启动时验证数据库登记与代码/环境 manifest 完全一致。初始化必须幂等、可审计、失败关闭，且不得创建用户、项目、模板、工单、记录、文件或导入任务等业务数据。

## 2. 范围与非范围

本提交新增严格系统 manifest、事务 bootstrap/verify、Nest 启动门禁、Mock 真调用 smoke、空库 acceptance 脚本和相应单元/PostgreSQL 测试；复用现有 `AiPromptVersion`、`ModelDeployment`、`TaskModelRoute`、`AuditLog` 与 Provider，不新增平行表。

本提交不新增 migration，不启用真实外部 Provider，不改变 AI 只能建议的边界，不实现 Excel/OCR 新 UI，不修改财务审批状态机，不执行目标 Linux Staging 发布，也不宣称真实模型准确率或生产 UAT 通过。

## 3. 修改文件

- `backend/src/model-runtime/system-registry-manifest.ts`：内置 profile、严格 custom manifest、规范化 hash 与安全边界。
- `backend/src/model-runtime/system-registry-bootstrap.ts`：serializable 事务、advisory lock、`P2002/P2034` 有界重试、preflight、增量创建、审计和完整验证。
- `backend/src/model-runtime/system-registry-startup-verifier.ts`、`model-runtime.module.ts`：API/Worker 共用启动门禁。
- `backend/src/model-runtime/system-registry-smoke.ts`、`system-bootstrap.ts`、`system-verify.ts`：CLI 和 Mock 真调用。
- `backend/scripts/verify-system-bootstrap.mjs`：随机空白 `_test` 库、临时 Redis、API/Worker/漂移验收和清理。
- `backend/prisma/seed.ts`：移除重复系统登记实现，改用共享 bootstrap；演示业务 seed 行为保留。
- `backend/src/config/*`、`.env.example`、`package.json`：配置导出、production 校验、环境样例和命令。
- `deploy/staging/compose.yaml`：migration 后先执行 system bootstrap，再执行受控合成 seed；API/Worker 固定启动验证。
- `backend/test/*`：配置、manifest、Staging 契约和 PostgreSQL 集成攻击用例。
- `README.md`、`backend/README.md`、`NEXT_TODO.md`、实施进度、汇报/提交审查索引和本报告：更新当前证据、运维步骤和下一任务。

## 4. 数据与状态机影响

没有 Schema 变化或新 migration。首次 bootstrap 可创建 11 个当前 Prompt 版本以及 profile 定义的 deployment/route，并在实际发生变化时写一条 `system_registry.bootstrap` audit；相同 manifest 重放为零写入。

系统登记只管理缺失行和不可变配置，不覆盖现有 deployment/route 的运行启用状态或健康状态。旧 Prompt 版本可以保留，但同 key 的当前版本会成为唯一 active 版本；退役当前版本不会被重新激活。业务任务状态机、审批快照、BusinessRecord、ledger 和 ReportSnapshot 不变。

## 5. API 与权限影响

没有新增 HTTP API。新增的是进程启动前置条件和受控运维 CLI：

- `npm run system:bootstrap`
- `npm run system:verify`
- `npm run system:verify:smoke`
- `npm run system:acceptance`

前端不能通过请求参数选择 profile、Provider、deployment 或启动模式。API 与 Worker 从相同服务端环境和数据库读取登记；production 的 `verify` 不能关闭。Mock smoke 不创建身份或业务数据，也不绕过现有认证接口。

## 6. 安全与隐私影响

自定义 manifest 通过现有严格 JSON parser 处理，并施加大小、深度、节点、数组和字符串预算；未知字段、重复 key、原型污染 key、控制字符和非法结构失败关闭。endpoint 禁止内嵌凭据、query/fragment；外部 endpoint 必须 HTTPS，私网/loopback 字面地址被拒绝。

secret 只能以 `secretRef` 保存环境变量名，不能嵌入 manifest 或数据库。启用部署缺少 secret 环境变量时启动失败。bootstrap/audit/startup 日志只记录 profile、manifest SHA-256 和计数。空库验收中的一次性 Redis 凭据不进入失败命令标签；`.env`、Token、模型权重和真实数据未进入提交。

## 7. 测试证据

- `npm test -- --runInBand`：PASS，50/50 suites，464/464 tests，24.019 秒。
- `npm run test:integration`：PASS，11 suites / 110 tests；3 个 Redis-required suites / 14 tests 按条件跳过。
- 临时固定 digest Redis 下强制执行 3 个 Redis suites：PASS，3/3 suites，14/14 tests，13.093 秒。合计 14/14 integration suites、124/124 tests 均被实际执行。
- `npm run test:integration -- --runTestsByPath test/integration/system-registry-bootstrap.integration-spec.ts`：PASS，1 suite / 5 tests。
- `npm run system:acceptance`：PASS，43 migrations、两个同时启动的 bootstrap 精确收敛为 changed/unchanged、11/1/7/1 系统计数、11 类业务计数为 0、Mock/API/Worker/漂移拒绝全部通过，20.3 秒。
- `npm run db:migration-paths`：PASS，空库 43 migrations 与 42 到 43 升级，48 tables、34 enums、224 indexes、89 foreign keys。
- `npm run test:runtime`：PASS，4/4。
- 根目录 `npm run build`：PASS，8.2 秒；后端 `npm run build`：PASS。
- `npm run test:e2e`：PASS，17/17，58.2 秒；真实 prepare/seed 顺序与 teardown 清理通过。
- 根目录和后端 `npm audit --omit=dev --audit-level=high`：PASS，均为 0 vulnerabilities。
- 文档、repository hygiene、staged hygiene 和最终 diff 检查在提交暂存后执行并记录为最终门禁，不以历史结果代替。

## 8. 新增边界与攻击用例

- production 缺 profile、禁用 startup verify 或使用非法模式时拒绝配置。
- strict JSON 的未知字段、重复键、原型污染键、超深结构、超预算响应和非法 Unicode/控制字符被拒绝。
- 外部 HTTP、URL 凭据、query/fragment、localhost/private literal IP 被拒绝。
- deployment/task/route 重复、route 越过任务 allowlist、启用 route 指向禁用 deployment 被拒绝。
- Prompt 内容、deployment 配置、route policy 漂移不会被 bootstrap 自动覆盖。
- 未登记但启用的 Prompt/deployment/route 会阻止 verify。
- 启用 secret-backed deployment 但环境变量缺失时失败关闭。
- 并发/重复 bootstrap 由 advisory transaction lock、唯一约束和三次事务重试预算收敛；两个真实进程同时首次运行只能得到一次 changed 和一次 unchanged，不新增第二条 audit。
- API/Worker 在数据库登记漂移时不能进入 ready；Mock smoke 只能返回 `NEEDS_FINANCE_REVIEW`。
- acceptance 拒绝非 `_test` 数据库，并在成功或失败后清理临时数据库、Redis 和目录。

## 9. 迁移、部署与回滚

没有新 migration。production 发布顺序为 `migrate deploy -> system:bootstrap -> system:verify -> API/Worker start`；migration/bootstrap 使用发布角色，运行账号只 verify，不能扩大为系统维护角色。Staging Compose 已采用同样顺序，并把合成 seed 保持在单独受控步骤。

回滚应用代码前必须确保目标版本认识当前数据库中的 Prompt/deployment/route。代码回滚本身不会删除系统登记，以避免破坏审计与历史任务解释；如 manifest 不兼容，应先按受控运维变更停用或恢复兼容版本。不能通过重新运行演示 seed 修复 production 登记。

## 10. 已知限制与剩余任务

- `development-local-v1` 只登记本地模型并默认禁用真实 deployment；真实 Qwen/Paddle 业务准确率仍为 `REAL_SAMPLE_NEEDED`。
- H12 未授权外部 Provider 真实数据传输，外部调用继续失败关闭。
- 外部 endpoint 的私网字面地址已阻断，但 DNS/egress 还需要目标基础设施策略；CR-009 不把配置校验冒充网络隔离。
- 目标 Linux Staging、正式 secret 注入、restore/RPO/RTO/rollback、独立安全复核和 owner UAT 尚未完成。
- 下一提交进入 Excel AI 前端审核闭环，不能把 system bootstrap 完成误写为 AI 产品闭环完成。

## 11. 审查者检查清单

- [ ] production 不运行演示 `prisma:seed`
- [ ] 空白库只创建预期系统登记与一条变更 audit，业务计数保持 0
- [ ] 两个并发 bootstrap 精确收敛为 changed/unchanged，重放不增加 audit
- [ ] Prompt/deployment/route 内容漂移失败关闭，不自动覆盖
- [ ] secret 只以环境变量引用存在，日志和 manifest 不含值
- [ ] API 与 Worker 都在 `verify` 模式下校验同一 manifest
- [ ] Mock smoke 经过真实 Provider 接口和严格输出校验，但不入账
- [ ] custom manifest 的 JSON、URL、白名单和资源预算攻击被拒绝
- [ ] Staging 顺序为 migration、runtime grants、system bootstrap、受控 synthetic seed
- [ ] `.env`、模型、真实数据和受保护未跟踪文件未进入提交
- [ ] 全量 unit/integration/Playwright/migration/build/audit/docs/hygiene 证据与实际命令一致
- [ ] Draft PR 保持 Draft，不 merge、不标记 Ready

## 12. 状态

`ENGINEERING_VERIFIED`。production-safe system registry 的代码路径、空库初始化、幂等、漂移拒绝、API/Worker 启动校验和 Mock 合成调用已通过自动化证据；真实模型准确率、目标环境、生产凭据、恢复演练、独立复核和最终 UAT 仍未关闭，因此项目仍不是 production-ready。

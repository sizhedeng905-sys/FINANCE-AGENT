# CR-012：可重复周五演示交付包

## 1. 提交目的

把 CR-011 的自动化故事线整理为一套可由现场演示者重复执行的本地交付包，并增加安全命令，确保演示只会使用本机 `finance_agent_test`、现有 migration/cleanup/seed/fixture、Mock AI/OCR 和真实 API，不会误连 production、远程数据库或外部 Provider。

## 2. 范围与非范围

本提交新增 `demo:reset/verify/api/web/test`、其 fail-closed 单测和 `docs/deliveries/2026-07-24/` 五份运行材料；同时更新本地运行、E2E、README、进度与夜间执行记录。

本提交不修改数据库 Schema、业务 API、审批状态机、报表计算、前端页面、模型服务或 OCR；不提交 `.env.test`、生成的 Excel/PDF、真实凭据、模型权重或真实公司数据。三次人工演练没有执行，保持 `NOT_RUN`。

## 3. 修改文件

- `backend/scripts/demo-environment.mjs`：只读解析 `.env.test`，验证本机精确测试库，复用 E2E 准备链，核验 seed/fixture，并以固定 Mock 配置启动 API/Web。
- `backend/scripts/demo-environment.test.mjs`：覆盖 production、远程主机、错误库名、非 PostgreSQL、外部凭据清除、Vite 配置和 Decimal fixture 边界。
- `package.json`：增加 6 个演示命令。
- `docs/deliveries/2026-07-24/`：交付说明、5-8 分钟 Runbook、验收表、限制和 2-4 周计划。
- README、LOCAL_SETUP、E2E、进度、CR/汇报索引和夜间报告：同步真实状态。

## 4. 数据与状态影响

没有 migration。`demo:reset` 先要求 loopback PostgreSQL 且数据库名精确为 `finance_agent_test`，再调用现有 `prepare-e2e.mjs`：generate、migrate deploy、精确清理 E2E 前缀数据、demo seed、生成合成 fixture。它不会接受仅以 `_test` 结尾的任意远程库，也不会通过 `SEED_ALLOW_NONSTANDARD_DATABASE` 放宽。

`demo:verify` 只读取并核对 `finance`、`财务`、`boss` 三个 active 账号，`太和中转项目`、`运输费用模板`、启用关系和合成 Excel 的 3 行金额；不打印数据库 URL、密码或 JWT secret。

## 5. 权限与身份

演示仍使用真实后端会话和角色守卫。财务 A `finance` 上传，财务 B `财务` 审批，老板 `boss` 只读报告；seed 密码 `123456` 仅在交付文档中标为非生产凭据。脚本没有传入或伪造 role、approvedBy 或项目归属。

## 6. 安全与隐私

- `NODE_ENV=production` 在读取配置和接触数据库前被拒绝。
- 只接受 `postgres|postgresql`、loopback host 和精确库名 `finance_agent_test`。
- `.env.test` 的值明确覆盖当前 shell 中同名值，避免误用遗留 production DB/JWT 变量。
- 子进程固定本地文件存储/basic 扫描、内存共享控制、Mock AI/OCR、外部 Provider disabled；AI/OCR/S3 凭据被清空，基础 URL 固定 loopback。
- Web 子进程清除所有继承的 `VITE_*`、数据库/JWT、Provider/S3 和 credential-like 变量，再只设置 API 模式、固定本机 API URL 和超时。
- 日志只输出脱敏数据库描述、合成 fixture hash 和无秘密的 seed 元数据。

## 7. 测试证据

- `npm run demo:config:test`：PASS，6/6；覆盖 `.env.test` 对遗留 shell 凭据的显式优先级。
- 实际 production 命令负测：PASS，exit 1，提示 `Demo commands refuse to run with NODE_ENV=production.`。
- `npm run demo:reset`：PASS，43 migrations、无待执行 migration，cleanup/seed/fixture/verify 全部成功。
- `npm run demo:verify`：PASS；3 个账号、项目、模板、当天 3 行、公式证据和 `13422.21` 匹配。
- `demo:api` + `demo:web` 实际 smoke：PASS；`/api/health/ready` 的 database/storage/models 为 ok，Web 200 且存在 root；测试后 `3101/4173` 无监听残留。
- `npm run demo:test`：收紧前后连续两次均 PASS，1/1；用例 15.1-15.2 秒，总耗时 21.5-21.7 秒；每次 teardown 均清理 1 个任务、3 条记录、1 个快照、1 个文件引用，文件残留 0。
- 本提交最终回归：后端 50/50 suites、464/464 tests；前端 runtime 4/4；前后端 build；43 migration 空库与 42 -> 43 升级路径；文档 96 files/167 links；repository hygiene 768 candidates；双端 production audit 0 vulnerabilities。
- CR-011 的 PostgreSQL + 强制 Redis 全量基线为 14/124，完整 Playwright 为 18/18。本提交没有业务/Schema 改动，未再次运行 6 分钟大表集成全量；数据库主路径由最终 `demo:test` 实跑。

## 8. 攻击与边界用例

- production、remote PostgreSQL、错误数据库、MySQL、缺少 TEST_DATABASE_URL 和过短 JWT secret 均失败关闭。
- 当前 shell 中的外部 AI/OCR/S3/Redis 值不能扩大演示配置，敏感 key 不传给子进程。
- 金额只接受恰好两位普通十进制；`1250.2` 和指数形式被拒绝，fixture 合计使用 bigint 分币。
- 脚本不接受客户端目标状态、不调用外部模型，也不修改 CR-011 的批准/幂等/发布隔离断言。
- 三次人工演练状态没有因自动化通过而伪造为 PASS。

## 9. 迁移、部署与回滚

无 migration、容器或 production 配置变化。回滚可移除根 scripts、两个 demo 脚本和交付文档；不会改变业务数据模型。演示命令不属于 production entrypoint。

## 10. 限制

- 三次连续人工演练为 `NOT_RUN`，因此周五状态仍为 `CONDITIONAL_NO_GO`。
- CR-011 与 CR-012 已随 SHA `66749b3` 推送；Build run `29828098638` 与 CodeQL run `29828098718` 均成功。
- 真实 OCR/AI/财务真值、目标服务器、恢复和 owner UAT 仍未关闭。
- `basic` 扫描、local storage 和 memory controls 只适用于本地合成演示，不代表 production 配置。

## 11. 审查清单

- [ ] production、远程或非精确 demo 库在任何写操作前被拒绝
- [ ] reset 复用现有 migrate/cleanup/seed/fixture，没有第二套初始化逻辑
- [ ] 账号、项目、模板、金额和 Provider 状态由 verify 实查
- [ ] API/Web 使用固定本机地址，外部凭据与 `VITE_*` 不泄漏
- [ ] 双财务职责分离、批准前隔离、幂等和 Snapshot 断言仍由 CR-011 证明
- [ ] 三次人工演练仍是 `NOT_RUN`
- [ ] 文档没有宣称真实准确率、目标环境或 production-ready
- [ ] 用户未跟踪资产、`.env`、生成文件和模型未暂存
- [ ] Draft PR 保持 Draft，不 merge、不标记 Ready

## 12. 状态

`REMOTE_ENGINEERING_VERIFIED / HUMAN_REHEARSAL_NOT_RUN`。本地交付包、命令负测、服务 smoke、自动化故事复验和远端 CI 已通过；三次人工演练尚未完成。

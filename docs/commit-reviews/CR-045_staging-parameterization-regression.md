# CR-045 Staging parameterization regression

## 目标

修复 `staging-deployment.spec.ts` 对 CR036 参数化部署契约的过期断言，使后端全量单测继续验证真实的安全默认与 registry 边界，而不是固定在旧的硬编码文本。

## 失败复现与起始事实

- 基线 SHA：`e312f3fa21c2d01e509ad93c3ef1f24e436d8b02`。
- `cd backend && npm test`：`FAIL`，51 个 suite 中 50 通过、1 失败；473 个 test 中 471 通过、2 失败。
- 初始失败断言仍要求固定 `S3_ENDPOINT` 和固定 `finance-agent` registry 前缀。
- 修正这两处后，定向重跑又暴露同一测试块中被前一失败遮住的固定 gateway bind address 断言。

## 根因

CR036 已把对象存储 base URL、gateway bind address 和 registry prefix 移入统一的 `deployment-environment` 契约，并保留本地 loopback/HTTPS 默认与目标环境失败关闭校验。结构性 Jest 测试仍查找参数化前的固定字符串，因此运行代码与测试契约发生漂移。

## 修改范围

只修改 `backend/test/staging-deployment.spec.ts` 的三条结构断言：

- `S3_ENDPOINT` 必须引用 `STAGING_OBJECT_BASE_URL`，默认仍为 `https://objects.finance-agent.local:9443`；
- gateway 端口必须引用 `STAGING_GATEWAY_BIND_ADDRESS`，默认仍为 `127.0.0.1`；
- release 的 PostgreSQL/MinIO 镜像必须使用经过校验的 `settings.registryPrefix`。

没有修改 Compose、release、target profile、registry、签名、业务代码或运行配置。

## Schema、API、UI 与财务影响

- Schema/migration：无变化。
- API/UI：无变化。
- 财务金额、审批、幂等、正式写库与 Demo 数据：无变化。
- Staging 运行行为：无变化；本 CR 仅让测试重新检查当前真实契约。

## 攻击与边界检查

- 没有删除 immutable image、tag drift、错误 URL、错误 registry、private network、loopback 默认或 digest lock 断言。
- `deployment-environment.test.mjs` 继续覆盖不匹配域名/端口、非法 registry 和不安全 target 模式。
- release 仍先使用受控 registry prefix 构建候选镜像，再由 image lock 与扫描链固定 immutable digest。
- 真实 target 在没有 digest/signature/authorization 证据时仍失败关闭；本 CR 不生成外部通过声明。
- 仅测试文件和审查文档进入本提交；CR046 依赖工作区和用户未跟踪资产不暂存。

## 测试证据

| 状态 | 命令/场景 | 结果 |
| --- | --- | --- |
| `FAIL` | `cd backend && npm test`（修复前） | 50/51 suite；471/473 test；2 个旧断言失败 |
| `FAIL` | `npx jest test/staging-deployment.spec.ts --runInBand`（首轮修复后） | 11/12；暴露被遮住的 gateway bind 旧断言 |
| `PASS` | `npx jest test/staging-deployment.spec.ts --runInBand`（最终） | 1/1 suite；12/12 test；约 2.9 秒 |
| `PASS` | `cd backend && npm test`（最终） | 51/51 suite；473/473 test；22.6 秒 |
| `PASS` | `npm run staging:config:test` | 12/12 test；参数化 local/target/非法输入契约通过 |

远端 Build and acceptance 与 CodeQL：本 CR push 前为 `NOT_RUN`；必须绑定本 CR 新 SHA 判定。

## 限制

- 这是测试回归修复，不证明真实 target Staging、registry 或签名可用。
- 目标环境、真实 registry 和真实签名仍为 `BLOCKED_EXTERNAL`。
- PR #4 必须继续保持 Draft。

## 回滚

仅使用 `git revert <sha>`。回滚会重新引入与当前参数化运行配置不一致的测试失败，但不会改变运行时行为或数据库。

## 下一步

1. push 并观察同 SHA 的后端单测、PostgreSQL integration and E2E 与 CodeQL。
2. 继续 CR046 依赖、安装脚本、镜像和日志泄露扫描刷新。
3. 最终全量回归后重新 reset/verify 周五 Demo 基线。

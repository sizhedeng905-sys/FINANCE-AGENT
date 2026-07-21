# FINANCE-AGENT 下一步执行清单

更新日期：2026-07-21
分支：`agent/b8-stable-hardening`
Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)

## 当前结论

- Excel staging P0 已由 CR-002 至 CR-005 关闭：未发布记录不可见、不可通过通用接口修改，最终发布具备内容、版本、状态、数量和 affected-row 围栏。
- Prompt 真执行已由 CR-006 关闭：版本化 `userPromptTemplate` 真正进入 Provider，请求与输出的脱敏 provenance 已进入现有 AI 审计链。
- 单一项目负责人治理由 CR-007 集中到 `docs/owner-input/`；不再等待多角色姓名、日期或签字。
- 文档信息架构由 CR-008 收口：报告、审计和验收证据集中到 `docs/汇报/`，计划与检查清单集中到 `docs/计划/`，并由 `npm run check:docs` 检查已跟踪 Markdown 本地链接。
- production-safe AI 系统登记由 CR-009 收口：空白库仅初始化 11 个系统 Prompt、受控 ModelDeployment/TaskModelRoute 和一条变更审计；两个并发初始化进程精确收敛为 changed/unchanged，配置漂移会阻止 API/Worker 启动。
- CR-010 已移除 runtime npm/npx/Corepack，并保留项目内 Prisma、Node、OpenSSL 和默认 entrypoint；SHA `1abe513` 的 Build 与 CodeQL 均成功，容器 fixable Critical 门禁已关闭。
- CR-011/CR-012 已建立“Excel 到经营报告”演示 E2E 与安全 `demo:*` 交付包，SHA `66749b3` 的 Build/CodeQL 双绿；三次人工演练保持 `NOT_RUN`。
- CR-013 已把真实 Excel AI 建议接入财务草稿，SHA `7d363f6` 的 Build/CodeQL 双绿；AI 不能自动保存、校验、跳转或入账。
- CR-014 已由服务端核验并持久化四类人工决定、AI Task、输出/版本向量哈希、证据、最终字段和操作者，SHA `5580ce3` 的 Build/CodeQL 双绿。
- CR-015 已在第二财务确认页展示服务端审核证据，证据读取失败时批准失败关闭；本地提交 `2a59509` 完成 21/21 E2E，但连续三次无法连接 GitHub，尚未推送。
- CR-016 已在本地完成不可变批准快照展示、按 `importTaskId` 定位正式记录和双向跳转；同时修复 Store 丢弃 `dataLayer/importTaskId` 查询参数。完整 Playwright 21/21、runtime 4/4 和 build 通过，等待本地提交与网络恢复。
- 产品内四角色、后端鉴权、职责分离和不同财务账号审批保持不变。
- 当前不是 production-ready，也尚未达到完整“AI 产品闭环”。

## 已有工程证据

- 后端全量单元：50 suites / 464 tests（CR-014 服务端基线）。
- PostgreSQL/Redis 全量：11 suites / 111 个实际执行测试；仓库既有 3 suites / 14 tests 按条件跳过（CR-014 当前完整基线）。
- Playwright 当前基线：21/21；包含 Excel AI 审核证据、批准快照定位和周五演示故事线。
- CR-009 system registry 专项：5 个 PostgreSQL 集成测试；独立空库 acceptance 覆盖 43 migrations、bootstrap/verify、Mock 调用、API/Worker 启动和漂移拒绝。
- Prisma migration：44 条空库路径与上一版本升级路径（CR-014 基线）。
- 前后端 production build、runtime 4/4、文档链接和 repository hygiene 已通过；CR-016 不含 migration 或后端写路径变更。

以上只证明对应提交的工程行为，不代表真实 OCR 准确率、财务逐分对账、目标云环境、恢复演练或 owner UAT 已通过。

## 自动推进顺序

1. 恢复远端后推送 CR-015/CR-016。
   - CR-015 本地提交为 `2a59509`；三次正常 push 分别遇到连接重置或无法连接 `github.com:443`。
   - 网络恢复后正常 push 当前分支，分别按实际新 SHA 检查 Build 与 CodeQL；禁止借用 CR-014 绿色，不 force push。
2. 完成三次人工周五演练。
   - 按 [`docs/deliveries/2026-07-24/DEMO_RUNBOOK.md`](docs/deliveries/2026-07-24/DEMO_RUNBOOK.md) 每次从 reset 开始，如实填写验收表；未执行前保持 `NOT_RUN`。
3. 真实样本校准。
   - 由项目负责人提供不入 Git、已授权和带真值的最小 Excel/OCR/财务样本；分别测量解析、OCR、映射和人工修正。
   - 未提供前保持 `REAL_SAMPLE_NEEDED`，不把 Mock/合成结果写成真实准确率。
4. 报告人工复核与来源展开。
   - 草稿、接受、退回/拒绝状态机；受保护 API、版本并发和 audit。
   - 前端分页调用 `/reports/snapshots/:id/sources`；AI 仍不计算金额。
5. Staging、模型网络和完整 smoke。
   - API/Worker 与模型使用受控 Docker network、服务 DNS、相同 secret reference、健康/超时/并发/kill switch。
   - 本地合成 smoke 自动完成；真实目标云环境保持 `EXTERNAL_RESOURCE_NEEDED`。

## 项目负责人输入

- 已确认决定：[`docs/owner-input/OWNER_DECISIONS.md`](docs/owner-input/OWNER_DECISIONS.md)
- 待回答问题：[`docs/owner-input/OPEN_QUESTIONS.md`](docs/owner-input/OPEN_QUESTIONS.md)，每批最多十题；未回答时采用失败关闭默认。
- 真实样本：OCR 17/5 真值、财务逐分对账、汇总/重复样例、老板标准问答。
- 外部资源：目标云服务器、域名/证书、对象存储、GPU/registry/告警、外部 Provider 详情、独立审计服务和恢复目标。

## 每个提交的门禁

- 一个可独立审查主题对应一个 `docs/commit-reviews/CR-XXX_*.md`，并更新索引。
- 文档移动或新增后运行 `npm run check:docs`，不得提交失效的仓库内链接。
- 先有失败复现或明确基线，再修改行为；不删断言、不静默回 Mock、不吞错误。
- 只暂存本提交有意文件，不提交 `.env`、真实数据、模型权重、备份、上传文件或受保护未跟踪资产。
- 运行受影响单元、真实 PostgreSQL/Redis、API/Playwright、Prisma、build、audit、hygiene 和 `git diff --check`；未运行明确写 `NOT_RUN`。
- 正常 push 到当前分支并更新 Draft PR #4；不 merge、不标记 Ready、不 force push。

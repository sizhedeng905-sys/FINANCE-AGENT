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
- CR-009 的远端 PostgreSQL/E2E 与 CodeQL 均成功；唯一红灯来自后端最终镜像中无运行用途的全局 npm 依赖。CR-010 已在本地移除 runtime npm/npx/Corepack，并保留项目内 Prisma、Node、OpenSSL 和默认 entrypoint；新 SHA 远端 CI 尚待确认。
- 产品内四角色、后端鉴权、职责分离和不同财务账号审批保持不变。
- 当前不是 production-ready，也尚未达到完整“AI 产品闭环”。

## 已有工程证据

- 后端全量单元：50 suites / 464 tests。
- PostgreSQL/Redis 全量：14 suites / 124 tests；无 Redis 与强制 Redis 分组均已实际执行。
- Playwright P0 基线：17 tests。
- CR-009 system registry 专项：5 个 PostgreSQL 集成测试；独立空库 acceptance 覆盖 43 migrations、bootstrap/verify、Mock 调用、API/Worker 启动和漂移拒绝。
- Prisma migration：43 条空库路径与 42→43 升级路径。
- 前后端 production build、runtime 4/4 和两套 production dependency audit 已通过；最终 repository hygiene 在 CR-009 暂存后复验。

以上只证明对应提交的工程行为，不代表真实 OCR 准确率、财务逐分对账、目标云环境、恢复演练或 owner UAT 已通过。

## 自动推进顺序

1. 恢复供应链绿色基线。
   - 提交 CR-010 并确认同一新 SHA 的 Build 与 CodeQL 均成功。
   - 不降低 Grype 阈值，不增加无依据 allowlist。
2. 建立周五演示 E2E 与交付包。
   - 用合成 Excel 证明批准前正式记录/项目结构/报告不变，第二财务批准后每行一条、逐分一致且重复提交不重复入账。
   - 建立 `docs/deliveries/2026-07-24/` 的演示稿、验收证据、限制和下一波计划。
3. Excel AI 前端审核桥接。
   - 接入真实 `/import-tasks/:id/ai-suggestions`，建议只能进入页面草稿。
   - 显示候选模板、理由、warning、Prompt/模型/Mock 来源；支持逐列接受、修改、拒绝和忽略。
   - 后续独立提交服务端 MappingDecision/provenance；AI 失败时保持完整手工路径。
4. OCR 并发和 AI 采纳闭环。
   - `expectedVersion` 与 `expectedReviewRevision` 强制必填并覆盖 stale 409。
   - 原始值、AI 建议、人工值、bbox/evidence 和 provenance 可复核；采纳后重新做确定性校验。
5. 报告人工复核与来源展开。
   - 草稿、接受、退回/拒绝状态机；受保护 API、版本并发和 audit。
   - 前端分页调用 `/reports/snapshots/:id/sources`；AI 仍不计算金额。
6. Staging、模型网络和完整 smoke。
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

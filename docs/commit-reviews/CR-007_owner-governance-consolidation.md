# CR-007：单一项目负责人治理与开放问题收口

## 1. 提交目的

消除旧 H01-H16 文档把多角色姓名、日期和签字当作工程阻塞的治理偏差，将当前项目负责人的已确认决定、失败关闭默认、真实样本缺口、外部资源缺口和最多十个未决功能问题集中到稳定入口，避免重复询问和状态漂移。

## 2. 范围与非范围

本提交只调整治理、进度、README 和审查文档，不修改运行时代码、数据库、API、环境变量或部署配置。

项目只有一名项目负责人，不再要求多角色签字；这不改变产品内 `employee`、`finance`、`reviewer`、`boss` 的权限隔离、职责分离和不同财务账号审批。Excel/OCR 上传者仍不能批准自己的导入。真实样本、目标环境、独立审计和 owner UAT 也没有被文档变更冒充为已完成。

## 3. 修改文件

- `docs/owner-input/OWNER_DECISIONS.md`：新增唯一已确认决定台账、安全默认、真实样本和外部资源缺口。
- `docs/owner-input/OPEN_QUESTIONS.md`：新增十个待负责人选择的功能问题；每题 2-3 个选项、建议项在前并写明未回答默认。
- `docs/FINANCE_AGENT_HUMAN_DECISIONS_UAT_SIGNOFF_2026-07-18.md`：降为 H01-H16 历史索引，移除多角色签字门禁并映射新状态词。
- `docs/FINANCE_AGENT_OWNER_PRODUCT_DECISION_QUESTIONNAIRE_2026-07-20.md`：保留原始答案，仅更新 Codex 回填状态与最新第二财务约束。
- `NEXT_TODO.md`：替换 PR #3/B7 旧清单，记录 CR-002 至 CR-006 证据和 production bootstrap 后续顺序。
- `README.md`、`docs/IMPLEMENTATION_PROGRESS.md`：同步当前治理、门禁、下一动作和状态术语。
- `docs/commit-reviews/README.md` 与本文：登记 CR-007。

## 4. 数据与状态机影响

没有数据库、migration 或业务状态机变化。新增的状态词只用于项目治理和证据分类：`SAFE_DEFAULT_ACTIVE`、`OWNER_CONFIRMATION_NEEDED`、`OWNER_CONFIRMED`、`REAL_SAMPLE_NEEDED`、`EXTERNAL_RESOURCE_NEEDED`、`ENGINEERING_VERIFIED` 和 `OWNER_UAT_VERIFIED`。

旧 H01-H16 编号保持可追溯，不删除历史问卷或历史工程报告。未回答问题不会改变数据库事实；运行时继续采用既有失败关闭行为。

## 5. API 与权限影响

没有 API 契约或权限代码变化。文档明确区分“项目只有一名负责人”和“产品仍有四角色”：后端继续从 Token 解析当前用户，客户端不能伪造角色、审核人或项目归属；Excel/OCR 正式提交继续要求不同财务账号。

## 6. 安全与隐私影响

本提交不读取或记录 `.env`、Token、真实业务原文、模型权重、备份或上传隔离目录。开放问题只要求功能选择，不要求在 Git 中粘贴真实敏感数据、secret 或生产资源值。

未确认的负数、确认后更正、扫描 bypass、外部 AI、保留删除、报告合理性和灾备目标均有显式失败关闭默认。空白受保护 Prompt Catalog 没有被 Codex 伪造或暂存。

## 7. 测试证据

- Owner 问题结构检查：PASS，10 个问题；每题 2-3 个选项；建议选项均位于第一项。
- 关键文档路径检查：PASS，owner decisions、open questions、M5.2 与 M6 证据文件均存在。
- 严格 Markdown 本地链接检查：PASS，9 个变更文档中的 88 个本地链接均存在。
- `git diff --check`：PASS，无行尾空格或 patch 格式错误。
- `npm run check:hygiene`：PASS，736 个 tracked/candidate 文件；`npm run check:hygiene:staged`：PASS，本提交 9 个文件。
- 第一次完整链接脚本：INVALID_RUN；根目录文档的父路径为空导致 PowerShell 非终止错误，脚本错误地继续输出 PASS。修正为根目录使用 `.` 且设置严格错误模式后，88/88 链接通过；第一次结果不计入证据。
- 后端单元、PostgreSQL/Redis、Playwright、Prisma 和前后端 build：NOT_RUN；本提交不修改任何可执行代码、Schema、依赖或构建配置，沿用 CR-006 当前工程基线但不把历史结果写成本提交复验。
- GitHub PR #4：检查时 CodeQL 已成功，Application container、PostgreSQL integration/E2E 和 JavaScript/TypeScript CodeQL 仍在运行；不把 pending check 写为通过。

## 8. 新增边界与攻击用例

- 开放问题超过十个、单题少于两个/多于三个选项或建议项不在首位时，结构检查失败。
- 原问卷 Q15-C 不能被解释为放宽 Excel/OCR 自审批；最新第二财务规则显式优先。
- 不再因姓名、日期、多方签字为空而停止可自动完成的工程工作。
- owner decision 不得被描述为真实样本、独立审计、目标环境或生产 UAT 已通过。
- 未回答问题必须能定位到明确安全默认，不能静默采用宽松行为。

## 9. 迁移、部署与回滚

无 migration、seed、配置或运行时部署变化。该提交可与应用版本独立发布。

回滚只需回退文档提交；不会修改数据库或业务数据。若回滚，旧文档会重新出现多角色签字门禁，因此不建议在后续工程继续依赖旧状态词。

## 10. 已知限制与剩余任务

- `OPEN_QUESTIONS.md` 中十项尚未由负责人选择，当前保持 `SAFE_DEFAULT_ACTIVE`。
- OCR/财务/汇总/重复/老板问答真值仍为 `REAL_SAMPLE_NEEDED`。
- 目标云、Provider、恢复资源和独立审计仍为 `EXTERNAL_RESOURCE_NEEDED`。
- 项目负责人尚未完成 `OWNER_UAT_VERIFIED`。
- 受保护的 Prompt Catalog 与补充任务书仍为空且未暂存；运行时继续使用已审计 registry。
- 下一个工程提交必须实现 production-safe、幂等、配置驱动且 hash 漂移失败关闭的 AI bootstrap。

## 11. 审查者检查清单

- [ ] 原始问卷答案保留，Codex 只修改回填解释
- [ ] 已确认决定和未决问题各有唯一入口，未重复询问已回答事项
- [ ] 开放问题不超过十个，每题 2-3 个选项且建议项在前
- [ ] 每个未回答问题都有失败关闭默认
- [ ] 单一负责人没有放宽四角色、第二财务、后端鉴权或职责分离
- [ ] 真实样本、外部资源、独立审计和 owner UAT 没有被标记完成
- [ ] 旧 H 文档明确是历史索引，不再要求多角色签字
- [ ] 未跟踪受保护资产、`.env`、模型和真实数据没有进入提交

## 12. 状态

`ENGINEERING_VERIFIED`（仅限治理台账、状态映射和文档一致性；开放业务问题、真实样本、外部资源与 owner UAT 仍未关闭）

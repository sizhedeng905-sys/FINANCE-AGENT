# 2026-07-23 夜间自主执行功能总述

> 分支：`agent/b8-stable-hardening`
>
> Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
>
> 夜间起始 SHA：`5222553bcd74c56c39a9a2b1e8e2ffd2dfeff677`
>
> 最后一个运行时代码 SHA：`5c16f3e114adf4be59c8dd629827970225de51f5`
>
> 报告生成时间：2026-07-22 19:51:25（Asia/Shanghai）
>
> 事实口径：合成验证不等于真实业务验证，本机通过不等于目标服务器通过。

## 一、30 秒结论

- 昨晚最重要的成果：恢复了被 Prisma 格式和陈旧测试阻断的远端主验收，并把依赖安装与后端运行镜像收紧到可审查、可失败关闭的边界。
- 今天可以直接看到或使用：周五 Excel 主闭环仍可完整演示；昨晚无新增用户功能，主要完成故障修复、安全加固、全量回归和发布准备。
- 周五演示判断：`CONDITIONAL_GO`。自动化闭环和最终 Demo 复核通过，仍需负责人完成三次手工彩排。
- 当前最大红灯：CR048 的 Build #48 在浏览器 E2E 暴露了证据 locator 与 retry 状态污染；CR049 已在本机完成重复场景、22 个 E2E 和 Demo 修复回归，新 SHA 远端结果仍待确认。
- 上线判断：仍不可上线；还缺目标环境、真实告警、registry 签名、异地恢复/RPO/RTO、真实财务/OCR/AI 验收、独立审查和负责人签收。

## 二、昨晚功能上做了什么

### 1. 恢复远端数据库工程门禁

- 昨晚之前：`schema.prisma` 没有通过仓库固定 Prisma 6.19.3 的 formatter，远端在入口退出，后续 build、集成、E2E 与扫描不执行。
- 现在：只修正 schema 排版；字段、关系、索引、约束和 migration 均未改变。远端主作业已经完整通过。
- 对你有什么用：GitHub 审查者能看到完整验收，不再只看到入口红灯。
- 你在哪里能看到：后台能力，界面不可见；在 PR #4 的 Build and acceptance 查看。
- 验证状态：`PASS`，运行时 SHA `5c16f3e`，51 migrations 的空库安装和 50→51 升级均通过。
- 限制：这不证明目标服务器数据库迁移或恢复已经执行。

### 2. 让 Staging 参数化测试与真实契约一致

- 昨晚之前：测试仍断言旧固定对象存储地址、镜像前缀和 bind 值，远端后端单测 471/473，集成与 E2E 被跳过。
- 现在：测试断言服务端受控的参数化默认表达式和 release registry 前缀；部署实现与安全约束未放宽。
- 对你有什么用：未来更换目标地址或 registry 时，测试会验证配置契约而不是把合法参数化误判为失败。
- 你在哪里能看到：后台测试能力，界面不可见；代码位于 `backend/test/staging-deployment.spec.ts`。
- 验证状态：定向 12/12、本机单元 473/473、远端完整作业 `PASS`。
- 限制：真实目标 Staging 仍未运行。

### 3. 收紧依赖安装和运行镜像

- 昨晚之前：带 install script 的 lockfile 依赖没有形成完整仓库契约；后端 runtime 依赖由完整安装后 `npm prune` 产生。
- 现在：所有脚本包都必须精确版本批准或明确拒绝；Scarf/`fsevents` 固定拒绝。runtime 从独立 production-only install stage 构建。
- 对你有什么用：新增或升级依赖若带入未复核脚本会直接失败；生产镜像的依赖来源更清晰。
- 你在哪里能看到：后台供应链能力，界面不可见；CI、Dockerfile 和 install-script 检查器可审查。
- 验证状态：策略 7/7，四次 npm audit 均 0 个已知漏洞；本机镜像 17 个用例与远端 Syft/Grype 均通过。
- 限制：audit 只代表查询时的已知公告；本机 Docker Scout 未登录，真实 registry 签名仍未验收。

### 4. 保持周五 Excel 财务闭环

- 昨晚之前：最近证据仍是 3 条记录、总额 `13422.21`，但远端主验收红灯使当前候选不可冻结。
- 现在：最终运行时、本机全量、同 SHA CI 和最终 Demo reset/test/verify 都已通过，测试库最后又单独 reset/verify 到可接手基线。
- 对你有什么用：可以从明确检查点重复演示，不需要现场手工造数据。
- 你在哪里能看到：按 `docs/deliveries/2026-07-24/DEMO_RUNBOOK.md` 操作。
- 验证状态：故事线 1/1；第二财务批准后恰好 3 条正式记录，金额 `1250.25`、`8765.43`、`3406.53`，合计 `13422.21`。
- 限制：AI/OCR 是醒目标识的 Mock/合成路径；三次人工彩排仍为 `NOT_RUN`。

### 5. 修复 Excel AI 证据测试的重复执行隔离

- 昨晚之前：CR048 的 Linux E2E 首次因同一截断 hash 在卡片中出现两次而 strict-mode 失败；retry 又复用了首次留下的 Mapping Profile，返回 `profile_reused`。
- 现在：测试在该状态型场景开始时调用既有 `_test` 安全清理，并只在展开的证据行中精确校验 output hash。
- 对你有什么用：真实功能回归不会因测试自身残留而随机红灯，也不会用宽松 `.first()` 隐藏重复证据。
- 你在哪里能看到：后台测试能力，界面不可见；文件为 `e2e/excel-ai-advisory.spec.ts`。
- 验证状态：重复目标场景 2/2、全量 E2E 22/22、Friday Demo 1/1；CR049 远端 CI 待 push 后确认。
- 限制：本机没有临时下载 CI Chromium，Linux Chromium 仍由 GitHub Actions 验证。

## 三、昨晚修掉了什么问题

| 问题 | 可能造成的后果 | 怎么修的 | 当前证据 | 是否影响周五演示 |
| --- | --- | --- | --- | --- |
| Excel AI 证据 locator 重复且 retry 继承旧 Profile | Linux E2E 21/22，后续 R5 扫描跳过 | CR049 精确展开行 locator + `_test` 状态前置清理 | 目标重复 2/2、全量 22/22、Demo 1/1；远端 pending | 产品行为不变；若不修会降低候选可信度 |
| Prisma format 红灯 | 主 CI 入口退出 | CR044 纯排版修复 | Prisma/migration 本机通过；远端完整主作业成功 | 不改业务行为，但原红灯阻止冻结候选 |
| Staging 测试断言旧固定值 | 后端单测失败，集成/E2E 被跳过 | CR045 对齐参数化契约 | 定向 12/12、本机 473/473、远端成功 | 不改 Demo 功能，关闭验收阻断 |
| install script 无完整批准契约 | 新依赖可执行未复核生命周期脚本 | CR046 精确 allow/deny 与漂移门禁 | 策略 7/7、干净安装、CI 成功 | 无可见变化，降低供应链风险 |
| runtime 依赖由 prune 产生 | 生产依赖边界不够清晰 | CR046 独立 production install stage | 本机 17 个镜像用例；远端 SBOM/Grype 成功 | 无可见变化，降低镜像回归风险 |

## 四、昨晚明确没有做什么

| 工作 | 状态 | 缺少条件 |
| --- | --- | --- |
| 真实目标 Staging | `BLOCKED_EXTERNAL` | 目标主机、域名、证书、对象存储与授权配置 |
| 真实告警接收端 | `BLOCKED_EXTERNAL` | 已授权接收端与凭据 |
| 真实 registry 签名 | `BLOCKED_EXTERNAL` | registry、可信根和签名凭据 |
| 真实异地恢复和 RPO/RTO | `BLOCKED_EXTERNAL` | 独立故障域目标与负责人批准指标 |
| 真实 OCR/AI 准确率 | `AWAITING_HUMAN_CONFIRMATION` | 经授权且带人工真值的样本 |
| 正式财务口径与逐分对账 | `AWAITING_HUMAN_CONFIRMATION` | 收入/成本/利润、冲销和重复规则真值 |
| 三次人工彩排和 owner UAT | `NOT_RUN` | 负责人亲自操作、观察与确认 |
| 部署、合并 PR、标记 Ready | `NOT_RUN` | 本轮明确禁止；生产门禁未关闭 |

## 五、对周五演示有什么影响

- 推荐演示代码 SHA：`5c16f3e114adf4be59c8dd629827970225de51f5`。
- 主闭环：`PASS`，覆盖登录、导入、建议、人工修改、换人审批、正式记录、Snapshot 与叙述依据。
- `npm run demo:test`：夜间在关键修复后和最终收口均通过；最终一次 1/1、23.3 秒，断言恰好 3 条记录和总额 `13422.21`。
- 昨晚新增可展示点：没有新增用户界面；主要是后台验收和供应链加固。
- 不建议现场演示：真实 OCR/AI 准确率、目标 Staging、告警、签名或异地恢复，因为没有真实验收证据。
- 失败时回退方案：稳定 SHA 为 `5c16f3e`；只使用 `git revert`，不使用 `reset --hard` 或 force push；必要时继续使用明确标识的 Mock/离线路径。
- 今天仍需负责人亲自完成：三次彩排、计时、投屏可读性和讲解节奏确认。

## 六、测试和验收证据

| 范围 | 命令/场景 | 结果 | suite/test/pass/fail/skip/耗时 | 对应 SHA | 备注 |
| --- | --- | --- | --- | --- | --- |
| Prisma 初始复现 | `npx prisma format --check` | `FAIL` | exit 1，约 3 秒 | 起始工作树 | 保留真实红灯 |
| Prisma | format / validate / generate | `PASS` | 均 exit 0 | `5c16f3e` | 固定 Prisma 6.19.3 |
| Migration/DB | deploy/status/verify/migration-paths | `PASS` | 51 migrations；50→51；51 表/245 索引/101 外键；约 13 秒 | `5c16f3e` | 仅隔离 `_test` 数据库 |
| System acceptance | bootstrap/Mock/API/Worker/drift | `PASS` | 51 migrations；11 prompts/1 deployment/7 routes/1 audit | `5c16f3e` | 零业务数据；配置漂移拒绝 |
| Runtime/build | runtime 4/4；前后端 build | `PASS` | exit 0 | `5c16f3e` | staging 前端按 CI 环境另行构建通过 |
| 后端单元 | `npm test --prefix backend` | `PASS` | 51/51 suites；473/473 tests；约 22.6 秒 | `5c16f3e` | 全量 |
| PostgreSQL/Redis | `test:integration` | `PASS` | 14/14 suites；125/125 tests；338.072 秒 | `5c16f3e` | 含 30,196/49,999 行 |
| Playwright | `npm run test:e2e` | `PASS` | 22/22；约 1.4 分钟 | `5c16f3e` | API 模式 |
| Demo config/story | config + reset/test/verify | `PASS` | config 6/6；故事线 1/1；23.3 秒 | `5c16f3e` 运行时 | 3 条记录，总额 `13422.21`，Mock 明示 |
| Demo 最终接手态 | 最终单独 reset + verify | `PASS` | 两命令 exit 0 | 文档 HEAD `7a62d6e`，运行时未变 | 测试库已迁移、清理、seed |
| Staging 合成契约 | config/preflight/SBOM/log policy | `PASS` | 12/12、6/6、7/7、4/4 | `5c16f3e` | 不含真实 target |
| 告警/签名/secret/offsite | 合成攻击测试 | `PASS` | 9/9、9/9、9/9、8/8 | `5c16f3e` | 真实资源仍阻断 |
| Backup integrity | 合成 Docker fixture | `PASS` | 9 cases；1 DB ref/2 manifest/6 strong hash | `5c16f3e` | 镜像已清理 |
| Model/proxy | config/lock/proxy checks | `PASS` | 均 exit 0 | `5c16f3e` | 不代表真实模型准确率 |
| 依赖审计 | root/backend full/production | `PASS` | 4 次均 0 vulnerabilities | `5c16f3e` | 查询时已知公告 |
| 应用镜像 | Docker build + image integrity | `PASS` | 本机 17 cases，约 183.4 秒 | `5c16f3e` | 本机扫描 defer；远端 Syft/Grype 通过 |
| 文档/卫生 | docs/hygiene/diff | `PASS` | 146 files/222 links；867 candidates；diff exit 0 | CR049 工作树 | 首次 9 处尾空格失败后已修正 |
| 真实 staging init/check/logs | 私有 target 路径 | `NOT_RUN` | 0 | 不适用 | 会读取/改写私有资产，未获授权不执行 |
| 本机 Docker Scout | CVE scan | `BLOCKED_EXTERNAL` | 0 | 不适用 | 需要 Docker ID；没有冒充通过 |
| GitHub Build | [run 29915561659](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561659) | `PASS` | 2/2 jobs；所有步骤成功 | `5c16f3e` | 单元、集成、22 E2E、镜像、SBOM、Grype |
| GitHub CodeQL | [run 29915561810](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561810) | `PASS` | completed/success | `5c16f3e` | 同 SHA |
| CR048 GitHub Build | [run 29917551053](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29917551053) | `FAIL` | 21/22 E2E；应用镜像/Prisma/build/473 unit/125 integration 通过 | `4e55dca` | locator strict failure；retry 返回 `profile_reused`；R5 跳过 |
| CR049 目标重复场景 | Edge + retry + repeat | `PASS` | 2/2；30.9 秒 | CR049 工作树 | 每次清理旧 E2E Profile/task/record |
| CR049 全量 E2E/Demo | Playwright + Friday Demo | `PASS` | 22/22，约 1.4 分钟；Demo 1/1，22.2 秒 | CR049 工作树 | 产品运行时未改 |

保留的中间失败：CR044 远端 471/473；CR046 首次缺 `TEST_REDIS_URL` 时 11 suites/111 tests 通过、3 Redis suites 收集失败；普通前端 build 后 staging bundle 因本地 API base 正确失败；一次只读 `db:verify` 命中未升级开发库但没有写入。最终正式证据均来自隔离 `_test` 数据库和精确环境。

## 七、GitHub 和提交状态

- 起始 SHA：`5222553bcd74c56c39a9a2b1e8e2ffd2dfeff677`；最后运行时代码 SHA：`5c16f3e114adf4be59c8dd629827970225de51f5`。
- 最终文档基线：CR047 为 `7a62d6e`、CR048 为 `4e55dca`；本次 E2E 修复与事实更新属于 CR049，其 SHA 通过 `git log --follow` 追溯，避免在提交内伪造自引用 SHA。
- 夜间新增生产运行时提交 3 个：CR044-CR046；CR047/048 为文档，CR049 为测试可靠性修复。CR040-CR043 在夜间起点前已本地提交，本夜正常推送。
- Push：CR040-CR048 已推送；CR049 在本报告提交后正常推送。工作树只保留受保护未跟踪资产。
- PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)，`OPEN / DRAFT / MERGEABLE`；未 merge、未标记 Ready。
- Build and acceptance：运行时 [run 29915561659](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561659) `PASS`，对应 `5c16f3e`。
- CodeQL：运行时 [run 29915561810](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561810) `PASS`，对应 `5c16f3e`。
- CR048 CI：CodeQL 通过，Build #48 因 1 个 E2E 失败；CR049 已本机修复，新 SHA CI 待确认。
- 未解决 review/CI：3 个历史 thread 均 resolved/outdated；当前唯一工程红灯是 CR049 远端复验。人工/外部门禁仍开放。
- 已保护且未暂存：`.vscode/`、用户任务书/设计文档、`docs/ai/`、本地模型部署教程、模型下载脚本和 `人工复核.md`；`.env`、secrets、模型权重和本地数据继续由 ignore/私有边界保护。

## 八、还差什么

### Codex 还能继续自主完成

1. 观察 CR049 的 Linux Chromium、R5 SBOM/Grype 与 CodeQL；完成标准是两个 Build job 和 CodeQL 全部成功。
2. 在负责人提供经授权真值后执行 OCR/AI/财务逐项测量；完成标准是原始证据、人工真值、错误分类和版本都可追溯。
3. 在目标资源授权后执行只读 preflight，再按 runbook 做 staging/恢复验收；风险是任何命令都不能读取或覆盖未授权 secret。

### 必须由负责人或真实环境完成

1. 负责人按 Demo Runbook 做三次彩排，记录耗时、投屏和偏差；任一角色、记录数或金额不一致就停止。
2. 在 Git 外准备已授权、可脱敏且带真值的 Excel/OCR/财务样本；不要把原件或凭据提交到仓库。
3. 确认目标 Staging、registry、告警接收端和异地备份目标；凭据放私有 secret provider，不放 Markdown。
4. 审查 PR #4、完成 owner UAT；未明确签收前继续保持 Draft 和生产 `NO_GO`。

## 九、你明早先做这三件事

1. **彩排一次，10-15 分钟。**入口是 `docs/deliveries/2026-07-24/DEMO_RUNBOOK.md`；预期看到第二财务批准、3 条记录和 `13422.21`。任何数字或角色不一致时不要继续，保留页面与日志。
2. **审查 GitHub，10 分钟。**打开 PR #4，先看 CR044-CR048、运行时两个绿色 workflow 和供应链 artifacts；若出现红色/运行中，不要 merge 或转 Ready。
3. **列真实验收输入，10-15 分钟。**在仓库外列出真值样本和 Staging/registry/告警/备份资源；若材料含真实身份、账号或凭据，不要继续粘贴到 Git，先做授权与脱敏。

## 十、回滚和恢复

- 周五稳定检查点 SHA：`5c16f3e114adf4be59c8dd629827970225de51f5`。
- 昨晚运行时代码提交：CR044 `e312f3f`、CR045 `c861197`、CR046 `5c16f3e`。
- 数据库/config：三项均无 migration 或业务数据转换；CR046 改依赖策略和镜像构建，没有扩大 AI/财务功能开关。
- 触发回滚：build、Prisma、单元/集成/E2E、Demo 记录数/金额或同 SHA CI 出现可复现回归。
- 只使用 `git revert <sha>`；不使用 `reset --hard`、rebase、force push 或历史改写。
- 回滚后最小重跑：Prisma format/validate/generate、受影响单元、前后端 build、PostgreSQL/Redis、22 E2E、`npm run demo:test`、镜像/install policy/audit、docs/hygiene/diff。
- CR044/045 回滚会恢复已知 CI 红灯，只应用于定位；CR046 回滚会恢复旧 lockfile 和 prune 型镜像构建。

## 十一、技术附录

| SHA / CR | 关键文件 | 技术改动 | 功能意义 | 回滚影响 | 已知限制 |
| --- | --- | --- | --- | --- | --- |
| `e312f3f` / CR044 | `backend/prisma/schema.prisma` | Prisma 6.19.3 纯格式修复 | 让远端完整验收可执行 | 恢复 format 红灯；无数据回滚 | 不证明目标库迁移 |
| `c861197` / CR045 | `backend/test/staging-deployment.spec.ts` | 对齐参数化默认值、registry 前缀和 bind 契约 | 防止合法参数化被误判 | 恢复 2 条陈旧失败 | 不执行真实 Staging |
| `5c16f3e` / CR046 | `package*.json`、`backend/package*.json`、`backend/Dockerfile`、`.github/workflows/ci.yml`、`backend/scripts/check-install-script-policy*.mjs` | 补丁依赖、install script 精确策略、独立 production dependency stage | 收紧依赖与运行镜像边界 | 恢复旧 lockfile/prune；无 DB 回滚 | 未验证真实 registry/target 日志 |
| `7a62d6e` / CR047 | README、`NEXT_TODO.md`、汇报、commit-review 索引 | 同步夜间事实、远端双绿、Demo 与人工交接 | 给负责人和审查者统一当前基线 | 仅文档回退 | 首版章节未严格贴合任务书，CR048 校正 |
| `4e55dca` / CR048 | 本报告、CR048 review、commit-review 索引 | 严格对齐一至十一结构并补完整技术附录 | 让交接文档可逐项验收 | 仅文档回退 | Build #48 暴露 E2E 重试隔离问题 |
| CR049 | `e2e/excel-ai-advisory.spec.ts`、CR049 review、报告/索引 | 精确展开行 hash locator；状态型场景前清理 E2E 数据 | 消除 strict locator 与 retry Profile 污染 | 仅测试代码，无 migration | 本机未装 CI Chromium；待同 SHA 远端验证 |

远端同 SHA artifacts：`gitleaks-results.sarif`、`application-container-evidence`、`r5-image-identity-evidence`。常驻 `finance-agent-models-qwen-text-1` 与 `finance-agent-models-paddle-ocr-1` 未停止或重建；临时测试 Redis、数据库、fixture 镜像与文件按契约清理。

# 2026-07-23 夜间自主执行功能总述

> 分支：`agent/b8-stable-hardening`
>
> Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
>
> 夜间起始 SHA：`5222553bcd74c56c39a9a2b1e8e2ffd2dfeff677`
>
> 最后运行时代码 SHA：`5c16f3e114adf4be59c8dd629827970225de51f5`
>
> 执行窗口起点：2026-07-22 18:47:06（Asia/Shanghai）
>
> 本报告收口时间：2026-07-22 19:38:31（Asia/Shanghai）
>
> 事实口径：合成验证不等于真实业务验证，本机和 CI 通过不等于目标服务器或生产上线通过。

## 一、30 秒结论

- 昨晚到本次收口新增的工作没有改变业务界面或财务口径，重点是恢复远端验收、修正过期测试断言，并收紧依赖安装与运行镜像。
- 周五可展示闭环保持完整：登录 -> Excel 导入 -> AI 建议 -> 财务修改 -> 第二财务审批 -> 3 条正式记录 -> ReportSnapshot -> 老板叙述依据。
- 推荐演示运行时冻结在 `5c16f3e`。本机全量回归、Friday Demo 专项、GitHub Build and acceptance 与 CodeQL 已全部通过。
- 周五判断为 `CONDITIONAL_GO`：技术闭环可演示，但三次负责人手工彩排尚未执行。
- 生产判断为 `NO_GO`：目标 Linux Staging、真实告警、真实镜像签名、真实异地恢复、真实 OCR/AI 真值、独立审查和 owner UAT 均未完成。
- Draft PR #4 已可供 GitHub 审查，但必须继续保持 Draft，不合并、不标记 Ready。

## 二、功能上完成了什么

### 1. 恢复 Prisma 远端验收入口

- 问题：`schema.prisma` 没有通过仓库固定 Prisma 6.19.3 的 formatter，远端会在早期门禁退出。
- 修改：只执行 schema 排版修复，不改字段、关系、索引、约束或 migration。
- 功能意义：主 CI 能继续运行 build、单元、PostgreSQL/Redis、浏览器 E2E 与供应链扫描。
- 证据：format/validate/generate、51 migration 空库安装、50→51 升级路径均通过。
- 对 Demo 的影响：无业务行为变化；移除了远端验收红灯。

### 2. 修正 Staging 参数化测试

- 问题：测试仍断言旧的固定对象存储地址、镜像前缀与 bind 值，和已参数化实现不一致。
- 修改：断言服务端受控的环境变量默认表达式和 release registry 前缀；不改变部署实现，不放宽安全约束。
- 功能意义：参数化 Staging 仍能被回归测试，主 CI 不再因陈旧测试停止。
- 证据：定向 12/12、后端 51/51 suites 与 473/473 tests、远端完整作业通过。
- 对 Demo 的影响：无业务行为变化。

### 3. 收紧依赖安装脚本

- 所有 lockfile 中带 install script 的包必须被精确版本批准或明确拒绝。
- 根目录只批准 `esbuild@0.25.12`；后端只批准 Prisma 6.19.3 组件和 `esbuild@0.28.1`。
- Scarf 与 `fsevents` 明确拒绝；新增/过期/冲突/模糊批准均会让检查失败。
- 新增 7 个策略测试，CI 执行 `npm run check:install-scripts` 防止 lockfile 与政策漂移。
- 根目录和后端干净 `npm ci` 后均不存在未复核脚本。

### 4. 收紧后端运行镜像

- build stage 继续使用完整依赖完成 Prisma 与 TypeScript 构建。
- 新增独立 production-dependencies stage，使用干净 `npm ci --omit=dev` 生成生产依赖。
- runtime 只复制生产依赖、构建产物和 Prisma 资产，不再依赖从完整依赖执行 `npm prune`。
- runtime 仍无 npm、npx、corepack，以 UID/GID 10001 非 root 用户运行。
- 远端真实构建、镜像身份检查、固定校验和 Syft SBOM 与 Grype fixable Critical 门禁均通过。

## 三、问题、后果与关闭证据

| 问题 | 可能后果 | 修复 | 当前证据 | 状态 |
| --- | --- | --- | --- | --- |
| Prisma format 红灯 | 主 CI 在入口退出 | CR044 纯排版修复 | 本机 Prisma/migration 通过；远端同 SHA 主作业成功 | `CLOSED` |
| Staging 测试断言旧固定值 | 后端单测失败，集成/E2E 被跳过 | CR045 对齐参数化契约 | 定向 12/12、本机 473/473、远端完整作业成功 | `CLOSED` |
| install script 无仓库级批准契约 | 新依赖可带入未复核生命周期脚本 | CR046 精确 allow/deny + 漂移检查 | 策略 7/7；两处干净安装；CI 门禁成功 | `CLOSED` |
| runtime 依赖由 prune 产生 | 生产依赖边界不够清晰 | CR046 独立 production install stage | 本机 17 个镜像用例；远端镜像/SBOM/Grype 成功 | `CLOSED` |
| 目标环境尚无真实证据 | 本机结果可能不能代表部署现场 | 保持失败关闭，不读取或伪造目标配置 | 明确 `BLOCKED_EXTERNAL` | `OPEN_EXTERNAL` |

## 四、周五 Demo 评估

### 可展示能力

- 四角色真实后端鉴权与职责边界。
- Excel 上传、Sheet/表头选择、分页预览和 AI 映射建议。
- AI 建议只进入财务草稿；财务人工决定、证据、版本向量与摘要可审计。
- 上传者不能自审批；使用另一财务账号完成最终批准。
- 批准后恰好生成 3 条正式记录，金额为 `1250.25`、`8765.43`、`3406.53`，合计 `13422.21`。
- canonical ReportSnapshot 使用固定查询与 Decimal；老板叙述展示 `sourcePath` 依据，AI 不计算金额。
- Demo reset/test/verify 路径明确使用 Mock/合成身份，不冒充真实模型准确率。

### 不应现场宣称或演示

- 真实 OCR/AI 准确率或真实财务对账正确率。
- 目标 Linux Staging、真实外部 Provider、告警送达、registry 签名或异地恢复已通过。
- production-ready、Go Live、独立安全审查或 owner UAT 已完成。

### 决策

- 技术闭环：`PASS`。
- 周五展示：`CONDITIONAL_GO`，条件是负责人完成三次手工彩排且没有角色、记录数、金额、投屏或节奏偏差。
- 生产发布：`NO_GO`。

## 五、测试与验收证据

| 范围 | 命令/场景 | 最终结果 | 数量/耗时 | 对应运行时 SHA | 备注 |
| --- | --- | --- | --- | --- | --- |
| Prisma 初始复现 | `npx prisma format --check` | `FAIL` | exit 1，约 3 秒 | 起始工作树 | 真实记录 CR044 修复前红灯 |
| Prisma | format / validate / generate | `PASS` | 3 个命令均 exit 0 | `5c16f3e` | 固定 Prisma 6.19.3 |
| Migration | 空库安装与上一版升级 | `PASS` | 51/51；50→51，约 13 秒 | `5c16f3e` | 临时 `_test` 数据库已清理 |
| 数据库结构 | `verify-database.ts` | `PASS` | 51 表、245 索引、101 外键 | `5c16f3e` | 0 缺失、0 意外 |
| 后端 build | `npm run build` | `PASS` | exit 0 | `5c16f3e` | Prisma 与两套 TypeScript 构建 |
| 后端单元 | `npm test -- --runInBand` | `PASS` | 51/51 suites；473/473 tests；约 22.6 秒 | `5c16f3e` | 全量 |
| PostgreSQL/Redis 集成 | `npm run test:integration` | `PASS` | 14/14 suites；125/125 tests；338.072 秒 | `5c16f3e` | 包含 30,196/49,999 行；临时 Redis 已清理 |
| 浏览器 E2E | `npm run test:e2e` | `PASS` | 22/22；约 1.4 分钟 | `5c16f3e` | API 模式，含 Excel/OCR/报告/Demo |
| Friday Demo | reset / test / verify | `PASS` | config 6/6；故事线 1/1；约 22.5 秒 | `5c16f3e` | 3 条记录，总额 `13422.21`，Mock 明示 |
| 前后端 build | 根目录/后端 production build | `PASS` | exit 0 | `5c16f3e` | 前端 staging 配置另行精确构建通过 |
| install script | policy tests + repository check | `PASS` | 7/7；frontend 1 allow/2 deny；backend 4 allow/2 deny | `5c16f3e` | 无 pending script |
| 依赖审计 | root/backend，full/production | `PASS` | 4 次均 0 vulnerabilities | `5c16f3e` | 只代表查询时已知公告 |
| 应用镜像 | Docker build + identity/runtime | `PASS` | 本机 17 个用例，约 183.4 秒 | `5c16f3e` | 本机 CVE scan 显式 defer |
| 文档链接 | `npm run check:docs` | `PASS` | 144 files；220 local links | `5c16f3e` + CR047 文档 | 新文件已进入暂存索引后检查 |
| 仓库卫生 | `npm run check:hygiene` | `PASS` | 865 tracked or candidate files | `5c16f3e` + CR047 文档 | 受保护未跟踪资产仍不暂存 |
| staged diff | `git diff --cached --check` | `PASS` | 由 CR047 提交前最终门禁记录 | `5c16f3e` + CR047 文档 | whitespace 门禁 |
| GitHub Build | [run 29915561659](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561659) | `PASS` | 2/2 jobs | `5c16f3e` | 单元、集成、22 E2E、镜像、SBOM、Grype 全成功 |
| GitHub CodeQL | [run 29915561810](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29915561810) | `PASS` | workflow success | `5c16f3e` | 同 SHA |

远端 Build 还生成三个同 SHA artifact：`gitleaks-results.sarif`、`application-container-evidence` 和 `r5-image-identity-evidence`。它们有 GitHub 保留期限，不能替代仓库中的长期事实说明。

### 保留的失败与边界记录

- CR044 远端后端单测曾为 50/51 suites、471/473 tests，仅两条旧 Staging 参数化断言失败；该失败直接促成 CR045，未被后续绿色结果删除。
- 第一次 CR046 全量集成未提供 `TEST_REDIS_URL`：11 个 PostgreSQL suites/111 tests 通过，3 个 Redis suites 在收集阶段失败；补齐 loopback Redis 后先定向 14/14，再单命令全量 125/125。
- 普通前端 build 后执行 staging bundle 检查曾因 API base 为本地地址而正确失败；按 CI 的 `VITE_APP_DATA_MODE=api` 与 `VITE_API_BASE_URL=/api` 重新构建后通过。
- 一次未带测试环境的只读 `db:verify` 命中本地开发库并发现其缺少后 10 张表；没有 migration、seed 或写操作。正式证据全部来自名称后缀为 `_test` 的隔离数据库。
- 本地 Docker Scout 需要 Docker ID，故本机 CVE scan 为 `BLOCKED_EXTERNAL`；远端同 SHA Syft/Grype 已通过，二者没有混写。

## 六、GitHub、提交与可审查性

- 夜间起始 SHA：`5222553bcd74c56c39a9a2b1e8e2ffd2dfeff677`。
- 起始 upstream：`4288253c90630b5294a71e1d4f93d6e73defe660`；CR040-CR043 当时已在本地，夜间恢复网络后正常推送。
- 夜间新增运行时提交：

| CR | SHA | 标题 | 运行时/数据变化 | 回滚影响 |
| --- | --- | --- | --- | --- |
| CR044 | `e312f3f` | `fix: restore Prisma format gate` | 仅 schema 排版；无 migration/API/数据变化 | 可独立 revert；恢复格式红灯 |
| CR045 | `c861197` | `test: align staging parameterization assertions` | 仅测试；无运行时/数据变化 | 可独立 revert；恢复陈旧断言 |
| CR046 | `5c16f3e` | `build: harden dependency install and runtime image` | 依赖补丁、安装策略和镜像构建；无 migration/API/财务口径变化 | 可独立 revert；恢复旧 lockfile/prune 构建 |

- CR040-CR046 已正常 push，`origin/agent/b8-stable-hardening` 与最后运行时 SHA 一致。
- PR #4 为 OPEN、DRAFT、MERGEABLE；没有被合并或标记 Ready。
- 审查入口：先看 CR044-CR047，再按 Excel、OCR、报告、Staging 与供应链分组回看 commit-review 索引。
- CR047 为事实同步文档提交，不改变最后运行时 SHA；其实际 SHA 使用 `git log --follow` 追溯。

## 七、明确未完成的工作

| 工作 | 状态 | 原因 | 当前保守行为 |
| --- | --- | --- | --- |
| 三次人工 Demo 彩排 | `NOT_RUN` | 必须由负责人操作、计时与观察投屏 | 保持 `CONDITIONAL_GO` |
| OCR/AI 真实准确率 | `REAL_SAMPLE_NEEDED` | 缺经授权且带真值的样本 | Mock/合成明确标识，AI 仅建议 |
| 财务正式口径与逐分对账 | `AWAITING_HUMAN_SIGNOFF` | 需要负责人确认业务真值 | 只声明合成 Decimal 框架通过 |
| 目标 Linux Staging | `BLOCKED_EXTERNAL` | 缺目标主机、域名、证书与授权 | 不读取本地私密资产，不声明部署通过 |
| 真实告警接收端 | `BLOCKED_EXTERNAL` | 缺已授权接收端和凭据 | 只保留合成 delivery 契约 |
| registry 签名 | `BLOCKED_EXTERNAL` | 缺真实 registry、可信根和签名凭据 | mutable/unverified release 失败关闭 |
| 异地 restore、RPO/RTO | `BLOCKED_EXTERNAL` | 缺独立故障域目标和批准指标 | 不宣称灾备达标 |
| 独立审查、owner UAT、Go Live | `AWAITING_HUMAN_SIGNOFF` | 不能由 Codex 自行签收 | PR 保持 Draft，不部署生产 |

真实 Staging 的 `.env`、`.secrets`、`.runtime`、`.release` 和 `.evidence` 均为本地私有资产。本轮没有读取、覆盖或提交它们，也没有运行会改写这些资产的 `staging:init`/真实 `staging:check`。

## 八、你明早先做这三件事

1. **做三次 Demo 彩排，每次约 10-15 分钟。**按交付 runbook 从 reset 开始，记录耗时和偏差；若角色、3 条记录或总额 `13422.21` 不一致，立即停止并保留现场。
2. **在 GitHub 审查 PR #4，每次约 10 分钟。**先看 CR044-CR047 和两个同 SHA 绿色 workflow，再检查 `application-container-evidence`、`r5-image-identity-evidence` 与未决门禁；不要 merge 或转 Ready。
3. **准备真实验收最小输入，约 15 分钟列清单。**在 Git 外准备已授权且带真值的 Excel/OCR/财务样本，并列出目标 Staging、registry、告警与异地备份资源；不要把凭据、原件或模型权重放入仓库。

## 九、回滚与恢复

- 周五稳定运行时检查点：`5c16f3e114adf4be59c8dd629827970225de51f5`。
- 触发回滚：build、Prisma、单元/集成/E2E、Demo 记录数/金额或同 SHA CI 出现可复现回归。
- 只使用 `git revert <sha>`；禁止 `reset --hard`、rebase、force push 和历史改写。
- CR044-CR046 没有 migration，也没有业务记录转换；无需数据库降级。
- 回滚 CR046 会恢复旧 lockfile 和 prune 型镜像构建，因此必须重跑两次干净 `npm ci`、前后端 build、后端单元/集成、22 E2E、镜像、install policy 与 audit。
- 回滚 CR045/CR044 会恢复 CI 红灯，仅用于定位，不应作为 Friday Demo 的首选检查点。
- 任一回滚后最小重跑：Prisma format/validate/generate、受影响测试、前后端 build、`npm run demo:test`、docs、hygiene 与 `git diff --check`。

## 十、受保护资产与仓库卫生

- 未跟踪的用户文档、IDE 配置、本地模型下载脚本、模型目录和真实/本地数据辅助资产均未暂存。
- 常驻 Qwen 文本模型与 PaddleOCR 容器未停止、删除或重建。
- 临时测试 Redis、数据库、应用镜像和备份测试 fixture 已按各测试契约清理。
- `.env`、Token、secrets、模型权重、真实公司原件和数据库导出均未进入提交。

## 十一、能力声明

### 自动化证据已证明

- 合成 Excel/OCR 审核入账、职责分离、幂等发布、ReportSnapshot grounding 和受控 Mock Provider 技术链。
- 51 migrations、473 单元、125 PostgreSQL/Redis 集成、22 Playwright API-mode E2E。
- install script 漂移门禁、非 root runtime、SBOM、fixable Critical Grype 和 CodeQL。

### 仅合成/匿名样本证明

- 大行数导入边界、OCR 证据复核、AI 字段建议、报告叙述和本地/Mock Provider 降级。
- 告警、签名、secret 生命周期、异地备份证据契约与目标预检框架。

### 尚未证明或授权

- 真实业务 OCR/AI 准确率、正式财务口径和真实数据逐分一致。
- 目标 Staging、外部 Provider、生产告警、签名、异地恢复与 RPO/RTO。
- 独立审查、负责人 UAT、生产部署和 Go Live。

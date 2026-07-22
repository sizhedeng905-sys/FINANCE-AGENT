# CR-008：汇报与计划文档信息架构

## 1. 提交目的

整理 `docs` 顶层长期累积的阶段报告、审计、验收结果和计划文件，让项目负责人可以分别从 `docs/汇报/README.md` 与 `docs/计划/README.md` 判断当前证据和后续动作；同时建立可重复执行的仓库内 Markdown 链接门禁，防止目录整理留下静默失效链接。

## 2. 范围与非范围

本提交移动 51 份报告/审计/验收/矩阵/收口材料和 4 份计划/检查清单/准备材料，新增两个目录索引，重算已跟踪 Markdown 的相对链接与显式路径引用，并新增 `npm run check:docs`。

架构、安全、本地安装、模型部署、运行手册、项目负责人决策、文档模板和逐提交审查继续保留各自职责位置。本提交不修改运行时代码、数据库、migration、API、权限、Provider、模型、部署配置或业务状态机，也不把历史报告结论提升为当前生产证据。

## 3. 修改文件

- `docs/汇报/`：集中 51 份既有结果材料并新增总索引；文件内容除链接和路径引用重算外不改写历史结论。
- `docs/计划/`：集中 4 份既有计划材料并新增总索引；根目录 `NEXT_TODO.md` 仍作为当前活动清单。
- `backend/scripts/check-markdown-links.mjs`、`package.json`：新增只读取 Git 已跟踪 Markdown 的本地链接检查命令。
- `README.md`、`backend/README.md`、`NEXT_TODO.md`、实施进度、运行手册、历史报告和既有提交审查：更新迁移后的路径和当前 CR 编号。
- `docs/commit-reviews/README.md` 与本文：登记 CR-008，并将 production-safe bootstrap 顺延到 CR-009。

## 4. 数据与状态机影响

没有数据库或业务数据变化，没有 migration、seed、任务状态、审批快照、幂等键或 ReportSnapshot 变化。Git 将原文件识别为重命名，历史内容和 `git log --follow` 追溯能力保留。

CR-008 只新增文档治理结论 `ENGINEERING_VERIFIED`，不改变任何产品状态或人工/外部门禁。

## 5. API 与权限影响

没有 API、DTO、鉴权、角色或项目范围变化。产品内四角色、第二财务审批、上传者禁止自审批和服务端 current user 规则均保持不变。

链接检查器只读取 `git ls-files --cached '*.md'` 的文件集合，不访问网络、数据库、对象存储、模型服务或应用 API。

## 6. 安全与隐私影响

本提交未读取、移动或暂存 `.env`、Token、模型权重、真实业务数据、上传文件、备份和隔离区。开始时已登记的未跟踪本地提示词、模型脚本和用户资产继续保持未跟踪；整理期间新出现的未跟踪 owner work plan 也未被暂存或改写。

链接门禁忽略 HTTP(S)、其他 URI、纯页内锚点和 Windows 绝对路径，只验证仓库内相对目标；URI 解码失败或目标逃逸仓库根目录会失败关闭。

## 7. 测试证据

- 归档计数：51 份汇报材料、4 份计划材料，两个目录索引存在。
- Markdown 链接重算：56 个相对链接；显式旧路径替换：139 处；55 个旧仓库路径的精确残留扫描为 0。
- `node --check backend/scripts/check-markdown-links.mjs`：PASS。
- `npm run check:docs`：PASS，89 个已跟踪 Markdown、152 个仓库内本地链接；首次在索引已登记但本文尚未创建时正确报 1 个缺失目标，记为 `EXPECTED_FAIL`，不计作通过。首次联合 PowerShell 命令没有传播中间原生命令退出码，最终复验已对每一步显式检查 `$LASTEXITCODE`。
- `npm run check:hygiene`：PASS，741 个 tracked/candidate 文件；`npm run check:hygiene:staged`：PASS，本提交 71 个 staged 文件。
- `git diff --cached --check`：PASS。
- `npm run build`：PASS，退出码 0，7.731 秒；确认新增 package script 和文档路径没有破坏前端 production build。
- 后端单元、PostgreSQL/Redis、Prisma、Playwright 和 Staging：`NOT_RUN`；本提交不修改对应运行时代码、Schema、依赖或部署行为，历史结果不冒充本次复验。
- 两次早期一次性链接重算为 `INVALID_RUN`：Windows Git 的中文路径 C 风格转义被错误当作真实路径。脚本产生的临时工作区改动全部从本轮干净基线恢复，随后使用显式 `core.quotePath=false` 重算；无错误输出被计入最终证据。

## 8. 新增边界与攻击用例

- 同时移动来源文档和目标文档时，链接按来源旧位置解析、目标新位置映射、来源新位置重算，不能做盲目字符串拼接。
- 目标文件只移动而引用文件不移动、引用文件只移动而目标不移动、两者同时移动三种情况均由最终全仓链接门禁覆盖。
- 带 query/fragment、尖括号目标和 reference-style link 保留后缀并验证实际文件目标。
- 非法 URI 编码和逃逸仓库根目录的相对链接失败关闭。
- Markdown fenced code block 不作为可点击链接解析；本次迁移另做旧完整路径精确扫描，确保示例中的旧路径也没有残留。
- 检查范围只包含已跟踪 Markdown，避免把受保护的本地草稿和真实资料误纳入提交或误当成发布文档。

## 9. 迁移、部署与回滚

没有数据库或运行时迁移。部署产物和服务无需变化，文档目录调整可以独立发布。

回滚时整体回退本提交即可恢复旧路径、引用和 package script；不能只回退文件移动而保留新链接，也不能只回退链接而保留新目录。GitHub 在新提交落地后会按重命名保留历史。

## 10. 已知限制与剩余任务

- 受保护的未跟踪需求书、提示词和本地工作计划没有擅自移动，因此工作区视图中仍可能看到少量 `docs` 顶层本地文件；它们不属于本提交的已跟踪信息架构。
- 链接门禁验证文件目标存在，不验证 Markdown 标题自动生成的 fragment 是否存在。
- 外部 HTTP(S) 链接不访问网络验证，避免文档检查受外部可用性影响。
- production-safe AI bootstrap 未在本提交实现，已顺延为 CR-009。
- 真实样本、目标 Staging、独立审查和 owner UAT 状态不因文档整理改变。

## 11. 审查者检查清单

- [ ] `docs/汇报/README.md` 能覆盖全部阶段报告、审计、验收和收口材料
- [ ] `docs/计划/README.md` 能定位计划、检查清单、PR 准备和当前 `NEXT_TODO.md`
- [ ] `docs` 顶层只保留架构、运行、安全、部署、负责人决策等参考文档
- [ ] 51 个报告移动和 4 个计划移动均被 Git 识别为 rename
- [ ] `npm run check:docs` 对缺失、非法编码和仓库逃逸目标失败关闭
- [ ] README、进度、旧报告和提交审查中的仓库路径均指向新位置
- [ ] 历史报告正文没有被借整理之名改写结论
- [ ] 未跟踪提示词、模型、本地计划、真实数据和 `.env` 未进入提交
- [ ] CR-009 仍明确是 production-safe bootstrap，未被文档提交冒充完成

## 12. 状态

`ENGINEERING_VERIFIED`（仅限已跟踪文档信息架构、索引和仓库内链接完整性；运行时能力、真实样本、目标环境和生产授权状态不变）

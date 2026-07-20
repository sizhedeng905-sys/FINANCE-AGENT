# M4 OCR AI 分类、证据映射与财务复核报告

日期：2026-07-20
分支：`agent/b8-stable-hardening`
状态：`passed`（工程、Mock、合成 PostgreSQL 与浏览器验收）

## 实现范围

- 复用 `OcrTask/OcrAttempt/OcrCorrection`、OCR IR、`AiPromptVersion/AiTask/AiCallAttempt/AiCallLog`、Provider、项目模板白名单、鉴权、audit 和 ledger，没有创建平行 OCR 或 AI 台账。
- `POST/GET /api/ocr-tasks/:id/ai-suggestions` 只向模型发送有预算的页面几何、稳定 evidence ref、有限 OCR 片段和当前项目启用模板版本；不发送原文件、完整 OCR 文本、凭据或其他项目数据。
- 服务端冻结并核对 source/IR/file hash、模板版本、Prompt/Schema、Provider/模型、转换、校验、脱敏、授权和策略版本。AI 只能返回 `NEEDS_FINANCE_REVIEW`，不能批准、应用任意表达式或创建 `BusinessRecord`。
- OCR source ref 必须绑定同来源 block/token/candidate evidence；未知字段、越界 evidence、来源未覆盖和跨页冲突失败关闭或保持未映射。Provider 重复候选保留为 alternatives，不静默择一。
- 每次人工修改形成新的 `reviewRevision`，保存必填原因、`MANUAL_OVERRIDE` 和 evidence refs，并原子清除旧校验快照。旧任务版本或旧审核版本提交返回 409。
- `POST /api/ocr-tasks/:id/revalidate` 对当前 source IR、原文件 hash、模板字段、类型、必填项、证据归属、重复和跨页冲突重新执行确定性校验，保存 `ocr-validation/1.0` 内容寻址快照。
- 前端显示任务/审核版本、原值、人工值、冲突候选、AI Provider/模型/Prompt、置信度“仅供参考”、未映射来源和阻断项。旧校验失效或存在阻断错误时确认按钮禁用。
- PDF 使用固定 `pdfjs-dist 6.1.200` 和随构建发布的本地 Worker，不请求 CDN。文件仍从现有鉴权预览接口读取；服务端对原 PDF 强制 attachment/octet-stream 时，前端只依据任务中锁定的 MIME 元数据交给 PDF.js 解析。
- bbox 按原 PDF 页码和 OCR IR 页面尺寸叠加。坐标尺寸缺失或旋转变换尚不能可靠复现时不绘制高亮，只显示 evidence ref，避免误导财务人员。

## 数据库迁移

- `20260720173000_ocr_review_revisions`
- 新增 task/review/validation revision、snapshot/hash/rule/version/time，以及 correction reason/revision/override/evidence refs。
- 数据库 CHECK 约束非负 revision、快照字段一致性、非空修正原因、固定 `MANUAL_OVERRIDE` 和 evidence JSON 数组。

验证结果：空库 35/35 migrations、已有库 34→35 升级、Prisma generate/validate 和后端 build 均通过。

## 自动化证据

```text
M4.1 targeted backend
2 suites / 16 tests passed

M4.1 AI ingestion PostgreSQL
1 suite / 5 tests passed

M4.2 targeted OCR backend
2 suites / 11 tests passed

M4.2 backend full
46 suites / 403 tests passed

M4.2 PostgreSQL OCR revision/revalidation scenario
passed

M4.3 frontend production build
passed，3,147 modules；PDF Worker 随产物发布

M4.3 backend build
passed

M4.3 Playwright real API OCR flow
1/1 passed
覆盖 Mock AI 零入账、PDF 画布/bbox、390px 视口、人工修订、旧校验失效、重新校验和确认

Playwright full regression
17/17 passed

frontend runtime config
4/4 passed

root/backend production dependency audit
0 vulnerabilities / 0 vulnerabilities
```

PostgreSQL/单元攻击断言还覆盖：employee/reviewer 越权、模式 disabled、kill switch、跨项目模板、非法字段/转换/evidence、无证据、跨页冲突、陈旧 source/hash、任务状态变化、未知 JSON、Provider 失败，以及正式记录数保持为 0。

## 未完成与边界

- 本报告只证明工程、Mock 和合成样本链路，不代表真实 PaddleOCR 或 Qwen 分类/映射准确率通过。H04/H05 的 17 份标签和 5 份盲测仍需独立人工证据。
- `AI_INGESTION_MODE` 默认 `disabled`；Playwright 仅在隔离测试进程中显式设置 `suggest + mock`。H12 未批准时，外部 Provider 对真实数据保持关闭。
- M4 不负责正式批准入库。现有直接确认 API 尚未完成 M5 要求的最终事务重鉴权、自审批策略、不可变批准快照、expected payload hash 和统一幂等 commit；前端禁用不能替代后端安全边界。
- 旋转页面当前保守不画 bbox；后续只有在坐标变换版本可确定重放并有测试时才启用旋转高亮。
- 集成启动仍会出现既有测试存储调和日志 `非法文件路径`；测试通过，但该日志噪声没有在 M4 中伪装为已修复。
- GitHub 推送仍受此前 `github.com:443` 连续两次连接失败影响；当前只声明本地证据，远端 CI 未验证。

## 下一步

进入 M5：统一 Excel/OCR 财务审核命令，强制最终事务重鉴权、自审批策略、current validation、expected version/hash、不可变批准快照和幂等 commit；任何阻断错误不得产生部分正式记录。

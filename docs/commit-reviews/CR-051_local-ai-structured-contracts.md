# CR-051 Local AI structured contracts

## 目标

让 Qwen3-14B-AWQ 在本地 OpenAI-compatible 服务上稳定完成 Excel/OCR 建议、报告叙述和老板助手链路，同时保持服务端严格白名单、Schema 校验和人工审批边界。

## 根因

- vLLM grammar 不支持 JSON Schema 的部分关键字，例如 `uniqueItems`，导致请求在模型生成前失败。
- Excel 分类输入把展示上下文与可引用 evidence 混在一起，模型容易返回服务端无法核验的引用。
- 映射 Prompt 没有完整表达必填字段、来源全覆盖和字段类型对应的转换白名单。
- 报告叙述允许模型自行改写标题和摘要，严格 grounding 会正确拒绝这种文字漂移。

## 修改

- 只在发送给本地 vLLM 的 grammar 投影中移除不支持的 `uniqueItems`；原始输出继续通过完整服务端 Schema 校验。
- Excel 分类输入升级为 v1.1，明确可引用 evidence、Sheet 上下文和候选模板显示信息。
- Excel 映射输入升级为 v1.2，冻结必填字段、来源分区和逐字段转换键白名单。
- OCR 映射加入相同的字段级转换约束。
- Prompt Registry 更新 Excel 分类 v3、Excel 映射 v3、OCR 映射 v2 和报告叙述 v5。
- 报告叙述输入升级为 v1.2，模型必须逐字复制服务端 `title` 和 `requiredSummary`；Mock 和真实 Provider 使用同一契约。
- 增加严格输出、注入边界、Provider 输入和版本哈希回归。

## 安全边界

- AI 仍只能生成 `NEEDS_FINANCE_REVIEW` 建议，不能批准或写入 `BusinessRecord`。
- 模型返回的模板、字段、转换键和 evidence 必须来自本次服务端白名单。
- 报告数字来自 canonical ReportSnapshot；模型不能计算、补齐或修改金额。
- 外部 Provider 保持关闭，本次只验证本地 Qwen 和显式 Mock。

## 真实本地链路证据

- Excel：本地 Qwen 完成分类与 4 个字段映射，另一财务批准后生成 1 条正式记录，金额 `8765.43`。
- OCR：PaddleOCR-VL 提取证据，人工纠错并由另一财务批准后生成 1 条正式记录，金额 `1280.50`。
- 报告：两条来源生成总成本 `10045.93` 的 canonical Snapshot；Qwen `report_narrative:v5` 生成 11 个已 grounding claims，经财务和老板两级接受。
- 老板助手：Qwen 基于固定工具结果回答支出 `10045.93`、记录数 `2`，没有走 fallback。

## 测试证据

- 报告定向：3 suites，14/14 tests passed。
- 后端全量单元：52 suites，479/479 tests passed。
- PostgreSQL/Redis：125 total，111 passed，14 skipped，0 failed。
- 前端 runtime：4/4 passed。
- Playwright：22/22 passed。
- 前后端生产构建通过。

## 回滚

使用 `git revert <CR-051-sha>`。历史 Prompt 版本仍保留用于审计；回滚后应重新执行 Prompt Registry 启动核验，不能把新任务解释为旧契约。

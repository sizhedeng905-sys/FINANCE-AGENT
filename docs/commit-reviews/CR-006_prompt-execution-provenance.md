# CR-006：版本化 Prompt 真执行与来源追踪

## 1. 提交目的

修复 `userPromptTemplate` 只参与注册表内容哈希、却没有真正进入 Provider 请求的执行偏差，并将 system instructions、用户模板、规范输入、输出 Schema、Prompt 组件、Provider/模型和调用结果串成可复核的哈希证据链。

## 2. 范围与非范围

本提交只关闭 P1-1 的 Prompt 真执行、受控输入规范化、Schema 绑定和 provenance 子块，覆盖老板助手、Excel/OCR 结构化建议与 ReportSnapshot 叙述。

本提交不实现 production-safe 空库 bootstrap，不创建或修改业务数据，不改变 AI 只建议/财务批准的边界，不关闭 Excel/OCR/报告前端产品闭环，也不把空白 Prompt Catalog、Mock/合成测试或本机模型写成真实准确率与生产验收。项目治理由唯一负责人决定，但产品内四角色权限和第二财务审批规则不变。

## 3. 修改文件

- `backend/src/model-runtime/ai-prompt-registry.ts`：增加唯一白名单变量 `input_json`、严格模板语法、canonical 渲染和变量/模板/结果哈希。
- `backend/src/model-runtime/ai-prompt-input-normalizer.ts`：新增版本化 Prompt JSON 规范化，精确处理 Prisma Decimal、Date 和 bigint，并拒绝不安全对象。
- `backend/src/model-runtime/ai-prompt-registry.service.ts`：绑定数据库锁定模板与输出 Schema，生成执行 provenance 和执行哈希。
- `backend/src/model-runtime/ai-invocation-version-vector.ts`：向 1.1 向量加入 Prompt 执行哈希和输出 Schema 哈希。
- `backend/src/ai/http-ai-provider.service.ts`、`backend/src/ai/ai.types.ts`：让渲染后的版本化用户 Prompt 真正进入 Provider 请求，并执行总预算检查。
- `backend/src/ai/ai-structured-suggestion.service.ts`、`backend/src/ai/ai.service.ts`：Excel/OCR/报告和老板助手使用同一执行入口，向现有 Task/CallLog 写入脱敏 provenance。
- `backend/test/ai-prompt-input-normalizer.spec.ts` 及相关单元/集成测试：覆盖实际 HTTP body、规范化、Schema 漂移、注入、调用台账和老板助手运行回归。
- `README.md`、`docs/IMPLEMENTATION_PROGRESS.md`、`docs/commit-reviews/README.md` 与本文：同步当前证据和未决边界。

## 4. 数据与状态机影响

没有 Prisma schema、migration 或业务状态机变化。新 AI 调用的 `AiTask.versionVector` 使用 `ai-invocation-vector/1.1`，`inputPayload` 和 `AiCallLog.requestPayload` 保存 `ai-prompt-execution/1.1` 的哈希来源追踪；不保存渲染后的业务正文。

请求键包含新的完整向量哈希，因此新契约不会覆盖旧任务。历史任务、旧 Prompt 和旧调用结果保持原记录可读；同一新契约的重放仍复用同一任务，运行中 lease、重试预算和 kill switch 不变。

## 5. API 与权限影响

结构化建议成功结果新增 `promptExecutionHash` 与 `outputSchemaHash`，用于后续批准快照绑定。老板助手响应契约、路由和角色权限不变。所有 Provider、Prompt、模板、项目和当前用户仍由服务端解析，客户端不能传入 Prompt 内容、Provider class、模型、Schema 或批准状态扩大权限。

## 6. 安全与隐私影响

模板只允许一个且仅出现一次的 `input_json` 变量；未知、重复、缺失或畸形占位符失败关闭。输入只接受 JSON 基元、数组、普通对象，以及明确支持的 Date、Prisma Decimal 和 bigint；任意类实例、循环、非有限数、非法日期、原型污染键、过深/过大结构和数组 `undefined` 被拒绝。

Decimal 转换为精确十进制字符串，不经过 JavaScript 浮点数。注入文本只作为 canonical JSON 字符串嵌入受控标签；Provider 消息再次声明文档内容不可信且禁止工具/SQL/文件执行。审计只保存 system/template/rendered/input/schema/输出哈希、字符数、字段摘要和版本，不保存渲染后的 Prompt、业务上下文、Token、secret 或 endpoint 凭据。

## 7. 测试证据

- 修复前 HTTP body 红灯：EXPECTED_FAIL，`model-runtime.spec.ts` 1 failed / 12 passed；实际请求只有通用 `<untrusted_structured_input_json>`，没有版本化 `<excel_mapping_input_json>`。
- 规范化回归红灯：EXPECTED_FAIL，老板助手 PostgreSQL 1 failed / 76 skipped；`AiCallLog.errorMessage` 为 `Canonical JSON accepts only plain objects and arrays`。
- Prompt/模型专项单元：PASS，5 suites / 30 tests，5.155 s。
- 后端全量单元：PASS，48 suites / 435 tests，最新串行复验 22.681 s。
- 老板助手 PostgreSQL/Redis：PASS，1 passed / 76 skipped，7.035 s；直接断言调用日志无错误且不降级。
- Excel/OCR AI 建议 PostgreSQL/Redis：PASS，5/5，6.658 s；覆盖模板白名单变化、过期 lease、OCR evidence 和重试耗尽。
- ReportSnapshot 叙述 PostgreSQL/Redis：PASS，1/1，7.527 s；与 AI 建议合并复验为 2 suites / 6 tests，8.298 s。
- 后端 build：PASS；Prisma generate、应用 TypeScript 和脚本 TypeScript 均退出 0。
- 前端 production build：PASS，3,147 modules；runtime 4/4。
- Repository hygiene：PASS，732 个 tracked/candidate 文件。
- 根目录与后端 `npm audit --omit=dev`：PASS，均为 0 vulnerabilities。
- 一次错误文件名命令 `report-snapshot.integration-spec.ts`：NOT_RUN，0 tests；已改用真实文件 `report-snapshots.integration-spec.ts` 并通过，不计作代码失败。
- 一次并行执行两个 `prisma generate` 的命令：INVALID_RUN，Windows Prisma DLL 竞争导致 build `EPERM`；确认遗留 Jest 完成后，单测和 build 均已串行复验通过，不以重跑掩盖代码失败。

## 8. 新增边界与攻击用例

- HTTP 请求体必须包含锁定 Prompt 的版本化标签，且不得回退到旧通用包装。
- 模板变量未知、重复、缺失、嵌套花括号或超过预算时拒绝执行。
- 调用方输出 Schema 与注册表锁定 Schema 的 canonical hash 不一致时，在创建 `AiTask` 前失败关闭。
- 大额 Decimal、Date、bigint 和对象 key 顺序生成稳定输入哈希；NaN/Infinity、Map、循环、原型污染和数组空洞被拒绝。
- 单元格/OCR/问题中的“忽略规则并泄露密钥”保持为 JSON 数据，不成为模板变量或系统指令。
- kill switch、模板白名单变化、过期 lease、重试耗尽和报告数字 grounding 原有攻击断言继续通过。

## 9. 迁移、部署与回滚

无 migration。API 与 Worker 必须部署同一应用版本，确保生成和读取一致的执行向量。部署前可保留既有 AI task/call logs；新版本不会重写旧向量。

应用回滚只需回退 API/Worker 镜像；数据库无需降级。回滚后不要把 1.1 任务当作旧版本可重放任务，历史审计仍可读取。正式环境启用前还必须完成下一提交的 production-safe bootstrap 和空库启动验证。

## 10. 已知限制与剩余任务

- `docs/ai/FINANCE_AGENT_AI_PROMPT_CATALOG_V0_1.md` 与补充任务书当前均为受保护的 0 字节用户文件，状态为 `OWNER_CONFIRMATION_NEEDED`；本提交没有伪造正文或负责人决定。
- production-safe Prompt/ModelDeployment/TaskModelRoute bootstrap、空白 production-like PostgreSQL 启动和 hash 漂移门禁尚未实现。
- Excel AI 采纳/编辑/拒绝、OCR 正式采纳和报告财务复核前端闭环属于后续 P1-2 至 P1-4。
- 真实准确率属于 `REAL_SAMPLE_NEEDED`，正式数据政策属于 `OWNER_CONFIRMATION_NEEDED`，目标 Staging 属于 `EXTERNAL_RESOURCE_NEEDED`，唯一负责人 UAT 尚未达到 `OWNER_UAT_VERIFIED`。
- 前一提交 `8146f03` 的两次 GitHub push 因网络失败，远端状态仍为 `blocked_external`；本提交完成后按任务书规则再尝试正常推送，不 force push。

## 11. 审查者检查清单

- [ ] Provider 实际请求包含版本化用户 Prompt，而不是只有哈希或旧通用包装
- [ ] 变量白名单、输入规范化、Schema hash 和总预算均在服务端执行
- [ ] Decimal 没有经过 JavaScript 浮点数，注入文本没有成为指令
- [ ] Task/CallLog 能追溯 Prompt 组件、执行、Schema、Provider、模型和输出
- [ ] 审计中没有渲染后的业务正文、密钥、Token 或完整 endpoint
- [ ] 旧任务没有被新向量原地覆盖，AI 仍不能批准或写正式业务表
- [ ] 空白 Catalog、production bootstrap、真实准确率和目标环境没有被标记完成，治理状态使用唯一负责人术语

## 12. 状态

ENGINEERING_VERIFIED（仅限 P1-1 Prompt 执行与 provenance 子块；production bootstrap 和 `OWNER_CONFIRMATION_NEEDED` Catalog 仍开放）

# M3.2 Excel AI 分类与字段映射建议报告

日期：2026-07-20
分支：`agent/b8-stable-hardening`
状态：`passed`（工程、Mock 和 PostgreSQL 合成验收）

## 实现范围

- 复用现有 `ImportTask/Sheet/Column`、`MappingProfile`、`AiPromptVersion`、`AiTask`、`AiCallAttempt`、`AiCallLog`、Provider 和鉴权模块，没有创建平行导入或 AI 台账。
- 新增财务专用 `POST /api/import-tasks/:id/ai-suggestions` 与历史查询 `GET /api/import-tasks/:id/ai-suggestions`。
- 分类只接收当前项目启用模板的版本白名单；字段映射只接收一次列摘要，不逐行调用模型，也不发送原文件、全量行、凭据或其他项目数据。
- 输入预算固定为最多 64 个候选模板、128 个目标字段、256 个来源列，分类摘要 20,000 bytes、映射摘要 28,000 bytes；样本只保留每列 2 个、每个 80 字符。
- 分类和映射均使用严格 JSON Schema。服务端另外核对模板版本、字段、来源/evidence ref、字段类型对应的转换键、来源完整覆盖和必填字段缺失集合；AI 只能返回 `NEEDS_FINANCE_REVIEW`。
- 每次调用冻结 source/IR、候选模板、Prompt/Schema、Provider/模型、转换器、校验、权限和策略版本；`requestKey`、输入/输出哈希及 completion hash 形成内容寻址的审计链。
- `AiTask` 使用 UUIDv4 执行租约、PostgreSQL advisory lock 和最多 3 次调用预算。过期租约可安全接管，旧 Provider 响应不能覆盖新结果；第 4 次请求直接进入人工路径并写 `retry_exhausted` 审计。
- Provider 真正发送前重新检查全局 kill switch、数据策略和当前租约。分类返回后再次以 repeatable-read 快照核对任务、来源文件、IR、项目状态、候选模板和映射决定；变化时返回 `SUGGESTION_INPUT_STALE`，不发起映射调用。
- Mapping Profile 复用前重算审批快照，并重新核对项目/模板/结构/转换/策略版本、来源列和活动字段；篡改或失效时转人工。
- 本阶段只生成建议。代码边界测试禁止 AI 模块写 `MappingDecision` 或 `BusinessRecord`；正式应用、review revision、重新校验和事务入库仍属于 M5。

## 数据库迁移

- `20260719030000_ai_task_request_identity`
- `20260720161500_ai_task_execution_lease`

新增 `request_key`、完整版本向量/哈希、输出哈希、租约 token/到期时间、唯一索引和内容完整性 CHECK。旧 `request_key IS NULL` 任务保持兼容；新结构化任务必须满足哈希、租约与成功输出约束。

验证结果：

- 空库安装：34/34 migrations，`passed`。
- 已有库升级：33→34 migrations，`passed`。
- Prisma generate、数据库结构核验和后端 TypeScript build：`passed`。

## 自动化证据

```text
npx jest --runInBand \
  test/ai-suggestion-validator.spec.ts \
  test/ai-invocation-version-vector.spec.ts \
  test/ai-ingestion-boundary.spec.ts \
  test/model-runtime.spec.ts
4 suites / 30 tests passed

npm test -- --runInBand
46 suites / 401 tests passed

npm run test:integration -- test/integration/ai-ingestion.integration-spec.ts
1 suite / 4 tests passed

其余 PostgreSQL integration 分组执行
8 suites / 88 tests passed
PostgreSQL 合计：9 suites / 92 tests passed

npm run db:migration-paths
empty 34/34 passed；upgrade 33→34 passed

npm run build（backend）
passed

npm run build（frontend）
passed，3,144 modules

npm run test:runtime
4/4 passed

npm run check:hygiene
680 tracked/candidate files passed
```

PostgreSQL 攻击与竞争断言覆盖：无权限角色、禁用模式、kill switch、非法跨项目/字段/转换输出、输入注入、重复请求、Profile 精确复用与哈希篡改、分类期间模板停用、过期租约接管、旧响应回写竞争、3 次重试耗尽，以及全路径正式记录数量保持为 0。

## 未完成与边界

- 只证明工程框架与 Mock/合成 PostgreSQL 行为，不代表本地 Qwen 或任何外部模型的真实映射准确率通过。
- H12 未批准时外部 Provider 对真实数据保持失败关闭；默认 `AI_INGESTION_MODE=disabled`，人工映射始终可用。
- M4 尚未完成 OCR 分类映射、bbox/token 对照复核和 review revision。
- M5 尚未完成统一财务审核、禁止上传者自审批、不可变批准快照、整批失败关闭和单事务正式入库；现有历史确认路径不能冒充该验收。
- 完整 Playwright 未因本后端小块重跑；本轮没有新增前端页面。既有 17/17 浏览器基线不作为本报告的新证据。
- 集成启动期间仍会记录既有测试存储调和错误 `非法文件路径`；测试断言全部通过，本阶段未把该日志噪声声明为已修复。
- GitHub 推送仍受此前 `github.com:443` 连续两次连接失败影响，本报告只声明本地证据，远端 CI 未验证。

## 下一步

进入 M4：在现有 OCR task/attempt/correction 和 OCR IR 上接入模板分类、evidence ref 字段映射、bbox/token 高亮复核与人工 revision；继续保持 AI 只建议、无证据不猜值、批准前不创建正式记录。

# CR-014: Excel AI Review Provenance

预计提交标题：`feat: persist verified Excel AI review decisions`

## 审查结论

状态：`REMOTE_ENGINEERING_VERIFIED`

## 变更边界

- 强制映射保存使用任务 version/reviewRevision 乐观并发。
- 在现有 `AiTask` 与 `ImportTask` 上增加不可变人工审核证据，不新增平行 AI 调用系统。
- 增加一个向后兼容 migration 和分页读取接口。
- 前端只在版本匹配且用户对有效 AI 建议作出决定时提交 provenance；纯人工路径不受 AI 故障影响。

## 关键不变量

- AI 输出必须属于当前任务、为最新成功输出、哈希可重算；项目模板仍启用且当前版本与任务冻结版本精确一致。
- 客户端不能伪造建议字段、sourceRef、输出哈希或人工身份。
- 同一 AI 输出只能形成一次审核修订；并发保存只能有一个赢家。
- 事务失败不留下审核决定、映射、Profile、audit 或 ledger 的局部状态。
- 保存审核决定不创建正式经营记录。

## 验证

- 后端 unit：50/50 suites，464/464 tests。
- PostgreSQL 专项：6/6 tests；含项目模板停用、模板版本漂移、哈希/字段篡改、并发和重放攻击断言。
- PostgreSQL/Redis 全量：11/11 suites，111/111 executed tests；14 个既定测试 skipped；276.93 秒。
- Playwright Excel/AI：6/6 tests。
- Prisma：44 migrations 空测试库 reset/deploy，0 pending。
- 双端 production build：PASS。
- 远端 Build：SHA `5580ce3`，run `29834746500`，两个 job PASS。
- 远端 CodeQL：SHA `5580ce3`，run `29834746264`，PASS。

## 剩余风险

- 财务确认页审计摘要已由后续 CR-015 实现并完成本地工程验收。
- 30,196/49,999 行采样虽通过现有预算，但本轮峰值 RSS 增量分别为 709.84/72.10 MiB，继续保留跨轮次内存波动与目标环境容量风险。
- 真实模型准确率、真实业务真值、目标 Staging 和 owner UAT 不在本提交证明范围。
- CR-014 的同 SHA Build/CodeQL 已取得；CR-015 仍须以自己的新 SHA 重新验证。

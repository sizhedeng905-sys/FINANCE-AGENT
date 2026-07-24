# CR-055 Boss chat claim allowlist

## 目标

修复老板助手在确定性工具没有生成财务 Claim 白名单时，本地模型仍可能从不可信工具数据中复制金额并触发 grounding fallback 的问题。

## 复现

- 问题“现在有哪些待审批事项？”只应调用 `get_pending_approvals`。
- 该工具提供运营信息，但不会生成可供模型声明的财务 Claim。
- 本地 Qwen 曾从工具数据中自行构造金额 Claim，服务端 grounding 正确拒绝，最终响应被标记为 fallback。
- 非 AI 页面和确定性工具结果不受影响。

## 根因

- `boss_chat:v2` 只用文字要求模型复制 Claim 白名单，没有把本次允许的 Claim 数量写进 Provider 的 JSON Schema。
- 当白名单为空但工具数据包含金额时，模型仍可能输出一个结构合法、业务上未授权的 Claim。
- 服务端最终校验能够失败关闭，但正常的待审批查询因此无法稳定使用真实本地模型。

## 修改

- `boss_chat` 升级到 v3，明确唯一白名单是 `allowedFinancialClaims`，不得从 `untrustedToolData` 复制数字。
- 每次请求根据确定性白名单数量创建运行时 Schema，把 `claims.minItems` 和 `claims.maxItems` 固定为同一个值。
- 运行时 Schema 不修改全局 Registry Schema，避免请求之间共享可变状态。
- 调用审计新增 `allowedClaimCount` 和 `runtimeOutputSchemaSha256`，可复核本次模型看到的约束。
- 缺少 `claims` 数组契约时失败关闭，不发送宽松请求。

## 安全与业务边界

- 模型仍不能查询数据库、调用任意工具、批准记录或写入业务表。
- 工具数据继续作为不可信结构化输入；最终回答由服务端 grounding 后确定性渲染。
- 外部 Provider 保持关闭，本次运行只使用本地 `Qwen/Qwen3-14B-AWQ`。
- 该修复不改变报告统计口径、审批状态机或 BusinessRecord。

## 测试证据

定向自动化：

```text
npm --prefix backend test -- --runInBand test/ai.spec.ts test/ai-prompt-registry.spec.ts test/ai-claims.spec.ts test/ai-benchmark.spec.ts
结果：4 suites，98/98 tests passed

npm --prefix backend run build
结果：exit 0
```

真实本地模型：

- Prompt Registry bootstrap/verify 通过，`boss_chat:v3` 为 active。
- 同一老板会话连续执行 7 类问题并持久化 14 条消息。
- 今日汇总：4 个 Claim，收入 `0.00`、支出 `12835.33`、利润 `-12835.33`、记录数 `4`。
- 项目排行：1 个 Claim，太和中转项目支出 `12835.33`。
- 待审批、异常、工单详情、无结果和提示词注入：允许 Claim 数为 `0`，运行时 Schema 哈希一致。
- 7 次调用均为 `openai_compatible` / `Qwen/Qwen3-14B-AWQ`、`success=true`、`fallback=false`。
- 注入问题没有返回 SQL、密钥、系统提示词或跨权限数据。

上述金额来自本地 `_test` 数据库中的合成记录，不代表真实公司数据或正式财务口径。

## 残余风险

- 真实自然语言覆盖率仍需要负责人 UAT；未识别意图会走保守的默认只读报告工具。
- 运营类工具中的金额由确定性渲染器输出，后续仍需单独检查前端是否充分展示工具来源和对象 ID。
- 本提交不宣称真实业务准确率或生产就绪。

## 回滚

使用 `git revert <CR-055-sha>`。回滚后应重新执行 Prompt Registry bootstrap/verify；历史 v3 Prompt 与调用审计仍需保留，不能改写旧调用。

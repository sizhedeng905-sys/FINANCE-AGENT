# CR-056 Boss AI evidence disclosure

## 目标

让老板助手页面展示后端已经返回的调用记录、实际 Provider/模型和财务 Claim 来源，避免金额答案只显示一段文字而无法在界面中继续核对。

## 发现

- 后端 `/api/ai/chat` 已返回 `callLogId`、`provider`、`model` 和通过 grounding 的 `claims`。
- 前端 `ChatBox` 只保留回答文字、工具标签和 fallback 状态，丢弃了上述审计字段。
- 实际金额由确定性工具和 grounding 保护，但负责人无法从页面展开查看范围 ID 和 `sourcePath`。

## 修改

- 扩展 `ChatMessage`，保留调用记录、Provider、模型和 Claim。
- 每条已执行的 AI 回答增加可展开的“数据依据”区域。
- 财务 Claim 展示指标、规范值、业务范围、只读工具和来源路径。
- 没有财务 Claim 的运营类回答明确显示该边界，同时保留调用记录和工具标签。
- `mock` 明确标识为 Mock；`openai_compatible` 明确标识为本地模型，避免静默混淆。
- 增加 Playwright 用例，覆盖有 Claim 和无 Claim 两类回答。

## 安全与业务影响

- 不向页面暴露工具原始数据、Prompt、Token、密钥、SQL 或请求头。
- 不改变 AI 工具选择、grounding、审批、记录写入或报告口径。
- `sourcePath` 只引用既有白名单结构，不是可执行表达式。
- 页面仍以 `fallback` 标签提示需要人工确认的失败关闭状态。

## 测试证据

```text
npm run build
结果：exit 0，TypeScript 与 Vite production build 通过

npx playwright test boss-ai-evidence.spec.ts --config .realdata-test/playwright.live.config.ts
结果：1/1 passed，3.5s
```

浏览器实测：

- 桌面 `1440x1000` 与移动 `390x844` 均能展开证据，无横向溢出。
- 本地 Qwen 回答显示调用记录、`Qwen/Qwen3-14B-AWQ`、3 个逐分一致的 Claim 和来源路径。
- 待审批回答显示零 Claim 边界和调用记录，没有误标为财务汇总 Claim。
- 首次 Playwright 执行因三个公司 Claim 使用同一范围 ID，严格定位器命中三个元素而失败；调整为检查首个可见匹配后，同一功能断言通过。产品代码未通过降低断言掩盖错误。

截图与临时运行配置保存在 Git 忽略的 `.realdata-test/handoff/evidence/browser/`，不包含密码或 Token。

## 残余风险

- 历史会话重新载入接口当前只返回持久化消息正文，不恢复本次即时回答的 Claim 展开状态；当前页面刷新后会开始新会话。
- Ant Design 现有弃用告警仍存在，但本轮 36 个页面没有白屏、未处理异常或业务 API `4xx/5xx`。
- 真实自然语言质量仍等待负责人 UAT，不由本提交宣称通过。

## 回滚

使用 `git revert <CR-056-sha>`。回滚只隐藏前端证据区，不修改后端调用日志或已持久化审计记录。

# CR-013：Excel AI 建议人工草稿桥接

## 1. 提交目的

把后端已有的 Excel AI 分类/映射建议接入真实财务页面，同时维持“AI 只建议、财务决定、显式保存”的边界。修正旧前端把 `/generate-suggestions` 新字段候选误认为 AI 映射的语义混淆。

## 2. 范围与非范围

本提交包含只读任务模板版本、前端建议契约、API/Store、独立建议面板、人工草稿操作、会话隔离和 Playwright 攻击性验收。

本提交不增加 migration，不修改 AI Prompt/Provider 执行，不自动保存 mapping/profile，不重校验或入账，也不持久化接受/修改/拒绝决定。后端审核决定与 provenance 是下一独立提交。

## 3. 关键文件

- `src/components/data/ExcelAiSuggestionPanel.tsx`：AI 建议、warning、证据、provenance 和逐列人工动作。
- `src/pages/data/DataImportMappingPage.tsx`：稳定来源列匹配与本页草稿状态。
- `src/api/importApi.ts`：真实 AI POST/GET；旧接口重命名为新字段定义候选。
- `src/store/importStore.ts`、`resetUserScopedState.ts`：按 task 隔离、竞态失效和登出清理。
- `src/types/dataCenter.ts`：严格建议/历史/provenance 契约。
- `backend/src/import-tasks/import.presenter.ts`：返回冻结 `templateVersion`。
- `e2e/excel-ai-advisory.spec.ts`：真实成功路径与跨模板/503 失败关闭。

## 4. 数据、权限与审计

没有 Schema 或正式数据写入变化。AI POST/GET 继续由后端 JWT 和 finance role 守卫；前端不接受 role、reviewer 或目标状态。建议草稿只存在于当前用户当前任务页面；服务端 AI 调用历史仍由现有 `AiTask/AiCallAttempt/AiCallLog` 审计。

接受/修改/拒绝决定尚未服务端持久化，因此不能宣称这些人工动作已经形成完整审计链。保存 mappings 仍沿用现有显式命令。

## 5. 失败关闭

- 冻结模板版本缺失或与建议版本不同：禁止采纳。
- 来源 ref 不属于当前任务、目标 field 不属于当前模板：禁止采纳。
- disabled/manual/503/网络/Provider 错误：保留人工草稿。
- 任务切换、登出、会话失效：清除结果并令在途请求失效。
- Mock 数据模式不会伪装真实后端 AI 调用。

## 6. 测试证据

- 红灯基线 1/1：缺少入口时按预期失败。
- 前后端 build：PASS。
- 后端 unit：50/50 suites、464/464 tests。
- 专项 Playwright：2/2。
- 完整 Playwright：20/20；清理后残留 0。
- CR-012 同 SHA 远端基线：Build `29828098638`、CodeQL `29828098718` 均成功。

## 7. 回滚

无 migration。回滚可移除建议组件、前端类型/API/Store 状态和 presenter 的只读版本字段；现有人工映射、字段候选和后端 AI 接口不受数据回滚影响。

## 8. 审查清单

- [ ] 页面调用真实 `/ai-suggestions`，旧接口明确标为新字段定义候选
- [ ] provenance、warning、evidence 和 Mock 标识完整可见
- [ ] 采纳只改本页草稿，保存前无 mappings/profile/record 写入
- [ ] 跨模板、未知来源和未知字段失败关闭
- [ ] AI 不可用不清除人工选择
- [ ] task switch/logout/in-flight 结果不会串账号
- [ ] 完整 20/20 Playwright 与 464/464 unit 证据可复验
- [ ] 未把人工动作持久化或真实模型准确率夸大为已完成
- [ ] 用户未跟踪资产、`.env`、模型和真实数据未暂存
- [ ] Draft PR 保持 Draft，不 merge、不标记 Ready

## 9. 状态

`LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING`。

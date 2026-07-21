# CR-013 Excel AI 建议人工草稿桥接报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

## 已实现

- 前端已接真实 `POST /api/import-tasks/:id/ai-suggestions` 和 `GET /api/import-tasks/:id/ai-suggestions`，不再把“新字段定义候选”误称为 AI 映射。
- 映射页显示任务冻结模板版本、建议模板版本、分类理由、warning、置信度、evidence ref、Provider、模型、Prompt、AI Task ID、输出哈希和版本向量哈希；Mock 结果有明确标识。
- 财务可逐列采纳、拒绝、人工修改或明确忽略，也可在同模板且全部建议合法时批量采纳。
- 采纳只进入当前页面草稿。保存前不会调用 mappings 写接口，不会创建 Mapping Profile、触发重校验、跳转确认页或生成 `BusinessRecord`。
- 建议模板与任务冻结模板不一致时禁止采纳；无模板版本、未知来源列或非当前模板字段同样失败关闭。
- AI disabled、manual required、HTTP 503、Provider/网络失败均保留现有人工选择和完整手工映射路径。
- AI 建议与历史按 task ID 隔离；任务切换、退出登录和会话失效会清除结果并使在途请求失效，避免跨任务或跨账号显示。
- 后端任务详情补充只读 `templateVersion`，前端使用 `sourceColumnId` 作为稳定列证据引用。

## 实际测试证据

- 红灯基线：真实上传/解析成功，专项 E2E 在尚不存在的“获取 AI 映射建议”入口按预期失败 1/1。
- `npm run build`：通过；拆分展示组件后再次通过。
- `npm --prefix backend run build`：通过。
- `npm --prefix backend test -- --runInBand`：50/50 suites、464/464 tests 通过。
- `npx playwright test e2e/excel-ai-advisory.spec.ts`：最终 2/2 通过。
- `npm run test:e2e`：20/20 通过，包含原有 18 条业务流程和新增 2 条 AI 草稿边界；teardown 后文件和业务数据残留为 0。
- CR-012 SHA `66749b3` 的 [Build run 29828098638](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29828098638) 与 [CodeQL run 29828098718](https://github.com/sizhedeng905-sys/FINANCE-AGENT/actions/runs/29828098718) 已成功。

## 攻击与边界

- 跨模板响应即使带有字段 ID，也不能写入 Select 草稿；批量和逐列采纳按钮均禁用。
- 503 故障注入后，财务先前手工设定的“明确忽略”仍存在，正式记录查询保持 0。
- 真实成功路径证明逐列采纳、拒绝和后续人工改值在点击“保存映射”前没有任何 `PUT /mappings`。
- 离开任务页再返回，以及退出后由另一财务登录，均不显示上一会话的可应用建议。
- GET 历史响应缺字段时页面采用防御性计数，不允许辅助审计信息令整个映射页崩溃。

## 未实现边界

- 本提交没有保存“接受/修改/拒绝”的服务端审核决定，也没有把 provenance 冻结进批准快照。
- 现有“保存映射”仍是明确的人工命令；后续提交需要携带 expected task version、review revision 和建议来源哈希，由后端校验并审计。
- 本提交使用受控 Mock Provider 验证前后端契约，不证明真实模型准确率或 production-ready。
- 三次现场人工演练仍为 `NOT_RUN`；目标 Linux Staging、真实财务/OCR/AI 真值与 owner UAT 仍未关闭。

## 当前结论

`LOCAL_ENGINEERING_VERIFIED / REMOTE_CI_PENDING`。Excel AI 建议已能安全进入财务草稿，但审核决定持久化与最终批准 provenance 仍是下一独立工程块，不能把本提交描述为完整 AI 审批闭环。

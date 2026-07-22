# CR-024: OCR Correction State Preconditions

提交：`9742d86 fix: require OCR correction state preconditions`

## 审查结论

状态：`SYNTHETIC_ENGINEERING_VERIFIED / REAL_SAMPLE_NEEDED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 目标与红灯复现

- 目标：任何影响 OCR 正式候选值的人工纠错都必须携带服务器返回的 `expectedVersion` 与 `expectedReviewRevision`，并在同一任务锁事务内比较。
- 修复前红灯：省略两个字段的 `PUT /api/ocr-tasks/:id/corrections` 返回 200，实际创建 `OcrCorrection` 并递增 revision；定向 PostgreSQL 测试 1 FAIL。
- 根因：DTO 把两个字段声明为 optional，服务端只在客户端传值时才执行 optimistic concurrency 检查。

## 修改范围

- `CorrectOcrTaskDto.expectedVersion` 与 `expectedReviewRevision` 改为 Swagger/validation 必填字段。
- 服务端在 task lock 事务内无条件比较当前 task version 与 review revision；缺字段由 ValidationPipe 返回 400，旧值返回 409。
- 前端 TypeScript 与显式 Mock 契约同步为必填，避免 API/Mock 模式行为漂移。
- 条件式本地 Paddle E2E 在发送纠错时携带当前版本；本提交未启动或调用真实 Provider。
- 无数据库 migration，无状态枚举变更。

## 财务与安全影响

- 旧页面、并发标签页或省略前提的脚本不能再静默覆盖最新 OCR 人工审核结果。
- 成功纠错仍生成新 revision、保存 correction、清空旧 validation snapshot，并要求重新执行确定性校验。
- AI/OCR Provider 仍不能确认任务或创建 BusinessRecord；最终确认仍要求不同财务和有效 validation snapshot。

## 测试证据

- 红灯定向 PostgreSQL：1 FAIL；缺少版本字段的请求错误返回 200。
- 修复后同一用例：1/1 PASS，76 项按测试名筛选 SKIPPED，8.004s；断言缺字段 400、纠错行 0、正常 revision 递增、旧请求 409。
- 后端 `npm run build`：PASS，包含 Prisma generate 和 TypeScript build，8.4s。
- 前端 `npm run build`：PASS，3,150 modules，8.2s。
- `npm run test:e2e -- e2e/ocr-workflow.spec.ts`：1/1 PASS，20.7s；使用 Mock Provider 与合成 PDF。
- 本地 Paddle `e2e/ocr-real-provider.spec.ts`：`NOT_RUN`；契约已更新，但未启动真实模型服务。
- staged diff check 与 repository hygiene：PASS。

## 限制与回退

- 证据只证明合成数据、Mock OCR 和 PostgreSQL 状态机；真实票据准确率、盲测、GPU 吞吐和长期稳定性仍为 `REAL_SAMPLE_NEEDED`。
- 旧客户端若不发送两个字段会收到 400。这是安全收紧，不提供兼容绕过；客户端应先刷新任务再提交。
- 回退会重新开放无前提覆盖，不是安全回退；应以前滚方式修复调用方。
- GitHub 推送仍受此前网络故障阻塞，未把旧远端 CI 作为本 SHA 证据。

## 下一步

- 审计 OCR AI suggestion 是否冻结最新 task/basis/output/vector/template 与 evidence refs。
- 补每字段 raw OCR、AI 建议、人工最终值、决定、理由和 provenance 的持久化/展示缺口。
- 用 Mock 与合成图片/PDF 覆盖旧响应、篡改、Provider 超时、取消和恢复，不声明真实准确率。

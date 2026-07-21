# B8-04 OCR 精度与异步任务化验收报告

更新日期：2026-07-16

## 结论

B8-04 工程门禁已通过。OCR 金额和精度字段使用十进制字符串，后端拒绝 Provider 返回的 JSON number；运行接口改为持久化排队和后台执行，真实执行槽、lease、heartbeat、取消、超时、重启恢复与实际 attempt 快照均有自动化证据。Mock 与本地真实 Paddle Provider 的 UI 全链路均通过，人工确认前新增经营记录数由 PostgreSQL 前后差值测得为 0。

H-04（17 份 OCR 字段真值）和 H-05（盲测标签冻结）仍为 `blocked_external`。因此本报告只确认工程、执行和防自动入账门禁，不声明真实业务 OCR 准确率达标。

## 精度与契约

- Python 适配器用 `Decimal` 解析 `money` 和精度敏感 `number`，JSON 输出保持字符串，不经过二进制浮点数。
- 后端 canonicalizer 只接受这些字段的字符串结果；Provider 返回 JSON number 时形成阻断性校验错误，人工仅确认告警也不能绕过。
- 往返用例覆盖 `.01`、`.09`、`.99`、2^53 附近、允许的最大金额、负号和千分位。
- OCR 人工纠错请求同样发送十进制字符串；最终仍复用统一 BusinessRecord 金额/日期策略。
- Provider 未返回的文件字段由系统绑定当前 OCR 原文件，模型不能伪造文件引用。

## 异步执行

- `POST /api/ocr-tasks/:id/run` 在数据库事务中写入 `queued`、排队时间、操作者与 requestId 后快速返回。
- Worker 取得 `ModelExecutionGateService` 的真实执行槽后才创建 attempt、切换 `processing` 并取得 lease；排队时间不占 Provider 超时。
- 推理期间定时 heartbeat 续租。服务启动和周期扫描会恢复 `queued` 及 lease 过期的 `processing` 任务。
- 取消 `queued` 任务不会调用 Provider；取消 `processing` 任务会终止当前 attempt 的业务有效性，释放 lease，并丢弃晚到结果。
- retry 重新排队，不在 API 请求内等待模型；前端轮询 `queued`、`processing` 与终态，不再受普通 15 秒请求超时影响。
- 并发上限 1、3、5 均按真实执行槽生效；队列等待超过单次推理时长的用例通过。

## 快照与来源

- 每个 `OcrAttempt` 保存实际执行时的 provider、model、version、endpoint、timeout、并发配置摘要、配置哈希、输入哈希和 secretRef。
- 密钥值仅在内存中的 resolved route 传给 Provider；数据库、API 和报告只保存环境变量引用，不保存真实密钥。
- OCR 确认生成的 BusinessRecord 引用成功的实际 attempt，包括 attemptId、attemptNo 和配置哈希，不再沿用任务创建时的旧部署快照。

## 评测边界

- `unconfirmedAutoRecordCount` 由评测开始和结束时 OCR 来源 BusinessRecord 的数据库数量差计算，不再硬编码。
- 高置信错误率以高置信预测数为分母，并单列金额/数字错误和日期错误。
- 新增 `npm run realdata:ocr-freeze --prefix backend -- --confirmed-by <复核人>`。只有全部盲测标签人工复核后才能生成本地冻结标记；全量/盲测评估会校验标签与划分哈希。
- 标签、冻结标记和明细结果只允许保存在 Git 忽略的 `.realdata-test/`，不会进入仓库。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| Python OCR 适配器 | 5/5 tests |
| 后端单元测试 | 17/17 suites，186/186 tests |
| PostgreSQL 集成 | 53/53 tests；22 migrations；无 pending migration |
| OCR 并发与恢复 | 并发 1/3/5、长排队、heartbeat、queued/processing 取消、重启恢复全部通过 |
| 标准 Playwright | 14/14 tests；teardown 文件残留 0 |
| 真实 Paddle UI | 1/1 test；排队、真实 attempt、人工纠错和确认完整通过 |
| 自动入账防线 | 确认前 PostgreSQL OCR BusinessRecord 差值为 0 |
| 构建 | 前端与后端 production build 通过 |
| Prisma | schema validate 通过 |
| 仓库卫生 | 437 个 tracked/candidate files 通过 |
| 生产依赖审计 | 根目录与后端均为 0 vulnerabilities |

测试使用仓库生成的合成 PDF 和结构化 Mock 数据；本阶段未读取、修改或提交公司真实业务文件、标签、OCR 原文或模型密钥。

## 自动化入口

```powershell
python -m unittest discover -s deploy/model-services/paddle-ocr-adapter/tests -p "test_*.py" -v
npm test --prefix backend -- --runInBand
npm run test:integration --prefix backend
npm run test:e2e
npm run test:e2e:ocr-real
npm run build --prefix backend
npm run build
npm run check:hygiene
```

真实 Provider 用例要求本地 Paddle OCR 服务健康；标准 CI/E2E 继续使用显式 Mock，不会在 Provider 故障时静默伪装为真实结果。

# CR-020: Excel AI Review Batch Integrity

提交：`be499ec47dd7d03d7c99b567ce44c6b5e1068d8b fix: require complete idempotent Excel AI reviews`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 失败复现

- 将 AI 任务固定生成 10 条唯一 `sourceRef` 建议，只提交其中 1 条人工决定。
- 修复前接口错误返回 `200`，允许部分审核被保存；测试期望 `400`，得到可复现红灯。
- 该夹具精确覆盖 10 -> 1 边界，同时保留合法字段、版本和 review basis，避免由无关校验提前拒绝。

## 范围

- 只要请求包含 `aiReview`，服务端要求该批次与 AI 输出的唯一 `sourceRef` 集合严格相等；缺失、重复、未知和额外来源均返回 `AI_REVIEW_BATCH_INCOMPLETE`，且不产生部分写入。
- AI 审核保存必须携带 `Idempotency-Key`；纯手工映射路径保持兼容，不强制该请求头。
- 相同 key 与相同完整请求的并发、重放返回同一结果，只创建一个审核批次、一条审计、一条 ledger 事件；相同 key 修改请求返回 `409`。
- 不同 key 携带旧任务版本或旧审核修订号返回 `409`，不能覆盖已经完成的批次。
- 服务端返回并持久核对 `total / accept / edit / reject / ignore / pending` 计数；审核查询摘要在 repeatable-read 事务中按数据库事实重新计算。
- 前端一旦开始处理任一 AI 建议，就明确展示剩余待处理数并阻止部分保存；完全未采用 AI 建议时仍可走显式手工映射。

## 服务与数据库边界

- task lock、项目锁、完整性校验、审核决定、字段映射、Mapping Profile、审计、ledger 和响应快照位于同一个幂等数据库事务内。
- PostgreSQL 唯一索引约束 `(ai_task_id, source_ref)`，阻止并发或绕过服务写入同一来源的第二份审核事实。
- migration 在创建索引前扫描历史重复；发现重复时失败关闭，不自动合并、删除或改写历史。
- 控制器同时覆盖当前 PUT mappings 和兼容 POST mapping-rules 路径，二者不能绕过幂等请求头。

## 验证

- 红灯复现：修复前 10 条建议只审核 1 条得到 `200`，期望 `400`，FAIL。
- Excel AI 定向 PostgreSQL 集成：1/1 PASS；覆盖缺失 key、10 -> 1、缺少审核体、重复/未知来源、同源与异源并发部分提交、完整四态审核、重放和冲突。
- Excel/OCR AI suggestion PostgreSQL 集成文件：6/6 PASS。
- PostgreSQL 全量集成：11 suites / 111 tests PASS；3 suites / 14 tests 按既有环境门禁 SKIPPED，共 125 tests。
- 并发/幂等断言：相同 key 并发结果完全相等；数据库最终恰好 10 条审核决定、1 条审计、1 条 ledger、1 条幂等记录；直接重复插入被数据库拒绝。
- 服务端审核摘要：`total=10, accept=7, edit=1, reject=1, ignore=1, pending=0`。
- 容量回归：30,196 行耗时 85,349 ms、峰值 RSS 增量 82.01 MB、峰值连接 12；49,999 行耗时 162,739 ms、峰值 RSS 增量 465.71 MB、峰值连接 13。
- 后端单元：50 suites / 464 tests PASS。
- 后端 build：PASS。
- 前端 production build：PASS，3,150 modules。
- Playwright Excel AI API 模式：3/3 PASS。
- 周五 Demo：1/1 PASS；3 条记录，总额 `13,422.21`，grounded snapshot 路径保持通过。
- migration：空库 47 个 PASS；已有 46 个升级至 47 PASS。
- staged repository hygiene、`git diff --cached --check`：PASS。

## 风险与回退

- 当前前端使用按 AI task 生成的稳定 key；同一任务修改请求体后必须创建新的用户操作 key，否则服务端会按设计返回冲突。后续若引入多次草稿修订，应由后端发放或前端按显式操作生成新 key，不能复用旧 key 覆盖事实。
- migration 若发现历史重复会阻止升级；应导出并人工核对重复来源，不得通过放宽索引或自动删行获得绿色迁移。
- 49,999 行容量测试峰值内存接近现有预算边缘，证明本次回归未恶化既有门禁，不代表生产资源已经获批或容量无限。
- 本 CR 仅证明 Mock/合成数据与一次性 PostgreSQL 测试库下的工程边界，不代表真实模型准确率、真实财务口径、外部环境或人工 UAT 通过。

## 后续

- P1：从不可变审核行生成 canonical review digest，冻结进重新校验和批准快照，并在最终提交事务中核对。
- P1：为审核事实增加 append-only 数据库门禁及绕过服务的攻击性集成测试。
- GitHub push 已连续两次因网络连接失败，按任务书标记 `blocked_external`；本地提交和证据保持完整，待网络恢复后正常 push，不 force push。

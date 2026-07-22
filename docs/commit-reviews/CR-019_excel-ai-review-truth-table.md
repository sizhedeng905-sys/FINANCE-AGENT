# CR-019: Excel AI Review Truth Table

提交：`849f8fe7faa635b0a8ff72ce901c1fa5251c0e9f fix: enforce Excel AI review truth table`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 失败复现

- 构造四列完整审核载荷，其中 `reject` 的最终字段仍等于 AI 建议字段，同时调整另一列避免触发重复字段校验。
- 修复前接口错误返回 `200`；测试明确期望 `400`，因此得到可复现红灯。
- 第一版攻击夹具曾同时触发重复字段校验并误绿；已修正夹具，只验证本 CR 的真值缺口，不把旁路拒绝当作证据。

## 范围

- `accept`：未忽略，最终字段必须等于 AI 建议字段。
- `edit` / `reject`：未忽略，必须选择合法且不同于 AI 建议的最终字段。
- `ignore`：最终字段为空且明确忽略。
- 审核原因经 trim 后限制为 2 至 200 字符。
- 前端拒绝当前同值建议时清空该选择；后续选择不同字段时保留显式拒绝语义，并在保存前校验决定与最终字段一致。
- PostgreSQL CHECK 约束阻止矛盾行绕过服务直接写入。

## 服务与数据库边界

- 数据库负责同一审核行内可表达的决定、建议字段、最终字段、忽略状态和原因长度不变量。
- 服务层在 task lock、项目锁和同一事务内继续校验目标字段属于当前项目启用的冻结模板、字段有效、sourceRef/evidence/output/basis 未被篡改。
- migration 在收紧约束前扫描历史行；发现矛盾事实或越界原因会明确失败，不会静默重写不可变审核历史。

## 验证

- 红灯复现：修复前 `reject + suggested field` 得到 `200`，期望 `400`，FAIL。
- Excel AI 定向 PostgreSQL 集成：1/1 PASS；覆盖六类非法组合、四种合法决定和数据库直写攻击。
- Excel/OCR AI suggestion PostgreSQL 集成文件：6/6 PASS。
- 后端单元：50 suites / 464 tests PASS。
- 后端 build：PASS。
- 前端 production build：PASS，3,150 modules。
- Playwright Excel AI API 模式：3/3 PASS。
- 周五 Demo：1/1 PASS；3 条记录，总额 `13,422.21`，grounded snapshot 路径保持通过。
- Prisma schema validate：PASS。
- migration：空库 46 个 PASS；已有 45 个升级至 46 PASS。
- staged repository hygiene 与 `git diff --check`：PASS。

## 风险与回退

- 如果既有环境已保存矛盾审核事实，本 migration 会失败关闭；应先导出、审查并形成保留处置记录，不得修改旧 migration 或自动改写决定。
- 应用回退不能简单删除数据库约束，否则会重新允许矛盾审核事实；只能在有等价约束的替代版本中前滚。
- 本 CR 仅证明 Mock/合成数据下的工程边界，不代表真实 AI 准确率、真实财务口径或生产上线通过。

## 后续

- P0-C：要求一次提交完整覆盖 AI 输出中的每个唯一 sourceRef，并提供严格幂等重放。
- P1：把完整审核 digest 冻结进重新校验和批准快照，再增加审核表 append-only 数据库门禁。
- GitHub push 已连续两次因网络连接失败，按任务书标记 `blocked_external`；本地提交和证据保持完整，待网络恢复后正常 push，不 force push。

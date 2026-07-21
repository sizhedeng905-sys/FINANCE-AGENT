# M3.1 Mapping Profile 结构作用域报告

日期：2026-07-18
分支：`agent/b8-stable-hardening`
状态：`passed`（M3.1 工程与合成/PostgreSQL 验收）

## 实现范围

- 复用既有 `ImportTask`、`ImportSheet`、`ImportColumn`、`MappingDecision`、`MappingProfile` 和 `MappingProfileRule`，没有新建平行导入模块。
- 新增 `excel-structure-fingerprint/1.0`。输入只含工作簿格式、解析器主版本、Sheet 名/顺序、选定表头行、合并区域、列稳定 ID/顺序/表头/推断类型、模板版本和转换注册表版本，不含行级业务值。
- Profile 作用域固定为 `project + template/version + structure fingerprint + transform registry + policy version`，由唯一 `scope_key` 在数据库中约束。
- Profile 记录 `profileVersion`、审批快照哈希、批准人/时间、使用次数、最后使用时间，以及 `active | stale | revoked` 状态。
- 规则按稳定 `sourceColumnId` 保存，支持重复表头；每条规则冻结来源类型、目标字段和白名单 `transformKey`。
- 相同项目、相同结构才自动填充 Profile 映射；跨项目、列顺序/类型/表头结构变化均不复用，也没有模糊相似度静默复用。
- 财务为新结构保存完整映射时，同项目/模板的旧活动 Profile 变为 `stale`；`POST /api/mapping-profiles/:id/revoke` 会撤销 Profile，并清除未提交任务中由它自动填入的决定。
- 新增分页 `GET /api/mapping-profiles`；两个接口仅允许后端鉴权后的 `finance` 角色，撤销写入 `audit_logs` 和 `ledger_events`。
- 迁移会把旧版无项目/无结构指纹的 Profile 保守标记为 `stale` 且不可复用，不猜测历史来源。
- PostgreSQL CHECK 约束拒绝未知转换键、负列序号，以及 `status` 与 `is_active` 的矛盾组合；应用层还会重算审批快照哈希，篡改后 Profile 自动失效。

## 数据库迁移

迁移：`20260719020000_mapping_profile_structure_scope`、`20260719021000_mapping_profile_rule_constraints`

- 空库安装：32/32 migrations，`passed`。
- 已有库升级：31→32 migrations，`passed`。
- Prisma `format`、`validate`、`generate`：`passed`。
- 数据库结构核验：45 个业务表（另含 Prisma ledger）、31 个 enum、195 个 index、82 个 foreign key，无缺失表。

## 测试证据

```text
npm test -- --runInBand mapping-profile-fingerprint.spec.ts
1 suite / 8 tests passed

npm test -- --runInBand
45 suites / 398 tests passed

npm run test:integration -- --testNamePattern "M3 mapping profile structural scope"
1 active suite / 1 test passed（其余按名称跳过）

npm run test:integration -- --testNamePattern "imports a real XLSX with mapping decisions"
1 active suite / 1 historical Excel regression passed（其余按名称跳过）

npm run db:migration-paths
empty 32/32 passed；upgrade 31→32 passed

npm run build
passed
```

PostgreSQL 行为断言覆盖：同项目精确复用、跨项目拒绝复用、列顺序变化失配、旧 Profile 自动 `stale`、新 Profile 重用、撤销后映射清理、任务退回 `mapping`、audit 写入。

## 未完成与边界

- M3.1 只完成安全 Profile 复用，不代表 AI 列分类/映射已经进入真实调用链；该工作属于 M3.2。
- 现有确认接口仍采用历史 `valid_rows_only` 策略，错误行存在时可能部分入账；M5 将替换为 review revision、重新校验、不可变批准快照和整批失败关闭事务。在 M5 完成前不得宣称新审批链通过。
- Profile 复用只自动填充建议，不构成财务批准，也不能跳过最终确认。
- 正式重复策略、财务口径、外部 Provider 数据政策和生产保留仍分别受 H03、H01/H02/H06/H08、H12、H14 约束。
- GitHub 推送在本轮检查点连续两次因 `github.com:443` 连接失败，状态为 `blocked_external`；本地提交和后续独立工作继续进行。

## 下一步

M3.2 接入受 `AI_INGESTION_MODE=suggest` 与 kill switch 控制的一次性列级分类/映射建议，复用现有 Prompt Registry、AI task/call 审计和严格 Schema；模型失败或输出非法时明确转人工，不创建 `BusinessRecord`。

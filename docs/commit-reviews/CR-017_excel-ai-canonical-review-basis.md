# CR-017: Excel AI Canonical Review Basis

提交：`1af210fdcb3394e400381688ef597f084054efb0 feat: bind Excel AI reviews to canonical state`

## 审查结论

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 范围

- 建立 `excel-ai-review-state/1.0`，覆盖 task/project、冻结模板、Sheet/表头、IR/evidence、sourceRef、当前 mapping、候选模板/字段、task version 和 reviewRevision。
- 映射调用将状态哈希绑定到 `ai-invocation-vector/1.2`，并持久化 `ai-review-basis/1.0`。
- AI 映射完成后重新读取状态；人工保存时在 task lock、项目锁和同一事务内再次重建状态并核验。
- 强制验证 `canonicalJsonSha256(versionVector) === versionVectorHash`、input/output hash、AI task ID 和客户端令牌。
- 新审核记录保存 `review_state_hash` 与 `review_basis_hash`；历史记录保持可读，新写入必须带完整基线。
- 前端传递并展示服务端签发的生成状态哈希和审核基线哈希。

## 失败复现

- 在 AI 输出后直接修改 `ImportSheet.selectedHeaderRows`，保持客户端 task version/reviewRevision 不变。
- 修复前接口错误返回 200；测试明确期望 409，因此红灯成立。
- 修复后同一攻击、客户端同步携带新 task version、mapping 基线变化、版本向量正文篡改均稳定返回 409。
- 冲突事务不会留下 AI review、mapping、audit、ledger 或 BusinessRecord 局部写入。

## 验证

- 后端 build：PASS。
- 前端 production build：PASS，3,150 modules。
- 后端单元：50 suites / 464 tests PASS。
- PostgreSQL 全量集成：11 suites / 111 executed PASS；14 tests 按既有环境条件 skipped。
- Excel AI 专项集成：6/6 PASS，包含分类中变化、映射完成后变化、lease 和重试边界。
- Playwright Excel AI API 模式：3/3 PASS。
- 周五 Demo：1/1 PASS；3 条确认记录和 grounded snapshot 故事线未受破坏。
- migration：空库 45 个 migration PASS；已有 44 个 migration 升级到 45 PASS。
- staged repository hygiene：PASS。

## 数据库变更

- 新 migration：`20260722090000_excel_ai_review_basis`。
- 为 `import_ai_review_decisions` 增加两个 nullable SHA-256 字段、格式/成对约束和 basis 索引。
- 字段保持 nullable 是为了诚实兼容无法重建基线的历史审核记录；新应用写入始终填充二者。

## 风险与回退

- 旧 `ai-invocation-vector/1.1` 任务不会被新调用复用；vector schema 变化会生成新的 request key，旧审计事实仍保留。
- 缺少 review basis 的旧 AI 输出不能再用于新审核保存，会转为重新生成建议或人工映射；这是保守失败行为。
- 应用回退时新增 nullable 列可保留，不需要破坏性 down migration。
- 本 CR 只证明 Mock/合成数据下的工程边界，不代表真实模型准确率、真实财务口径或生产上线通过。

## 后续

- P0-B：统一 `accept/edit/reject/ignore` 的最终真值、目标字段和理由约束。
- P0-C：禁止只审核 AI 输出子集后消耗整批输出。
- P1：把完整 AI review digest 纳入重新校验与批准快照，并增加数据库不可变防线。

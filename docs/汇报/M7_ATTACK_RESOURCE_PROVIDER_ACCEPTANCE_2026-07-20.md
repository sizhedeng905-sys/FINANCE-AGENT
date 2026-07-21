# M7 攻击、资源与 Provider 降级验收报告

> 日期：2026-07-20
> 分支：`agent/b8-stable-hardening`
> 起始 HEAD：`2e976c6d`
> Draft PR：[#4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4)
> 状态：`engineering_passed / production_and_human_gates_pending`

## 1. 阶段结论

M7 已完成任务书第 12 节要求的本机攻击、并发、资源和降级联合回归，并修复一项真实并发缺陷：

1. 六个相同 ReportSnapshot 并发请求原先会返回部分 `409`，现通过仅针对 Prisma `P2002/P2034` 的三次有界新事务重试，全部返回同一个不可变快照。
2. 六个相同报告叙述并发请求最多发起一次 Provider 调用，只形成一个 `ReportNarrative`；其他请求返回明确的执行中或内容寻址复用结果。
3. 无 Token、非老板角色、AI 模式禁用和全局 kill switch 均在 Provider 调用前失败关闭。
4. Provider 超时、截断 JSON、严格 Schema 失败、Claim 值篡改、warning 隐藏和无依据事实不会产生正式 Narrative；错误摘要会脱敏。
5. Excel/OCR 的证据、白名单、状态、双人批准、最终重鉴权、整批原子发布、幂等和 Worker 恢复继续通过完整 PostgreSQL 回归。
6. 4,999/5,000/5,001 与 49,999/50,000/50,001 行边界、文件上限减一/恰好上限/超一字节、服务端分页和响应体预算均有自动断言。
7. 本地 Qwen 文本与 PaddleOCR 资产完整且常驻服务健康；VL 与 Embedding 保持按需离线。M7 没有重新宣称真实模型准确率。

本结论只证明当前单 API、单 Worker、本机 PostgreSQL 和合成/匿名测试条件下的工程闭环。目标 Linux Staging、外部 Provider 真实数据、正式财务口径、真实 OCR/AI 准确率、独立安全审查和生产发布仍受 H 门禁约束。

## 2. 红灯与修复

### 2.1 M7-REPORT-CONCURRENCY-001

红灯复现：

```text
POST /api/reports/snapshots x 6
实际状态：[201, 409, 409, 409, 201, 201]
```

根因是多个 `REPEATABLE READ` 事务读取到相同事实后竞争同一 `snapshotHash`。等待 advisory lock 的事务仍持有旧快照，可能触发 PostgreSQL serialization failure 或唯一键冲突。数据库没有生成重复快照，但 API 没有提供稳定的幂等结果。

修复：

- 每次重试都创建新的 `REPEATABLE READ` 事务，重新读取事实、水位和已存在快照。
- 只重试 Prisma `P2034` 事务冲突和 `P2002` 唯一冲突。
- 最多三次；其他错误立即原样抛出，不吞掉业务、权限或基础设施错误。
- Snapshot hash、advisory lock、唯一约束和不可变触发器保持不变。

绿灯断言：六个请求全部 `201`，只有一个 `reused=false`，六个响应使用同一 Snapshot ID，数据库只有一条 Snapshot 和一份来源事实。

## 3. 攻击覆盖矩阵

| 边界 | 自动化证据 | 结果 |
| --- | --- | --- |
| Excel IR | 隐藏 Sheet 显式选择、合并/多行表头、公式缓存策略、空公式来源、媒体、Decimal lexical、1904 日期、稳定 evidence hash | `passed` |
| OCR IR | 稳定 page/block/token/candidate ref、bbox 边界、重复页、非法 confidence、无 token 候选不伪造 | `passed` |
| Mapping Profile | Unicode/空白规范化、项目/模板/策略范围、规则变化失效、批准快照 hash | `passed` |
| 严格 JSON | Markdown fence、重复 key、未知字段、深度/大小预算、原型污染、非法 ID/字段/transform/evidence | `passed` |
| Prompt Injection | “忽略规则”、密钥索取、模板/项目 ID 注入、零宽/双向控制、伪 JSON 和无依据财务事实 | `passed` |
| 财务权限 | 无 Token、employee/reviewer 越权、上传者自审批、角色撤销、账号停用、项目权限变化、旧页面最终提交 | `passed` |
| 状态与版本 | 非法跳转、人工修改使旧 ValidationSnapshot 失效、模板停用变 `STALE`、expected version/hash 冲突 | `passed` |
| 并发与幂等 | 双财务批准单赢家、重复 key 同结果、改体 409、Worker lease 接管、取消/提交竞争、Snapshot/Narrative 并发 | `passed` |
| 报告真实性 | 仅 confirmed actual、Decimal、分币种、日期边界、不可变来源/hash、warning 完整、无任意 SQL | `passed` |
| Provider 降级 | disabled、kill switch、无路由、超时、429/5xx 重试边界、熔断、截断/非法 JSON、重试耗尽转人工 | `passed` |
| 文件与导出 | 真格式识别、公式/主动内容、路径与控制字符、CSV 公式转义、大小边界、隔离区与孤儿清理 | `passed` |
| 日志与 secret | URL query、Bearer/JWT/cookie/key、Provider 错误摘要和结构化日志泄露测试 | `passed` |

AI 模块的架构测试继续禁止导入 `BusinessRecord` 写服务。正式写入只能由持有当前不可变财务批准快照的确定性 commit service 完成。

## 4. 资源与性能证据

### 4.1 Excel 行数和响应预算

- 4,999、5,000、5,001 行覆盖前台/后台切换边界。
- 49,999、50,000 行可进入有界后台路径；50,001 行明确拒绝。
- 30,196 和 49,999 行均使用批次、进度、租约和服务端分页，不把全量行返回浏览器。
- 预览响应继续受 256 KiB/1 MiB 自动断言约束。

本轮 PostgreSQL 全量采样：

| 行数 | 重新校验 | 确认 API | Worker 到终态 | RSS 增量 | 连接峰值 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30,196 | 2.998 s | 26 ms | 26.206 s | 239.13 MiB | 10 |
| 49,999 | 5.964 s | 40 ms | 46.014 s | 167.79 MiB | 11 |

同一工作树的上一轮全量采样中，30,196 行为 25.419 秒，49,999 行为 143.199 秒；最终复验分别为 26.206 秒和 46.014 秒。两轮均低于既有 180 秒断言，但 49,999 行波动明显。该项保留为容量风险，不宣称稳定 p95；目标服务器、并发和数据库参数确定后必须重新压测。

### 4.2 文件和运行资源

- 上传大小在 `limit-1` 和 `limit` 成功，在 `limit+1` 返回统一 `413`，且不留下数据库、审计、ledger 或隔离区残留。
- 低磁盘水位返回显式 `507` 并保持数据库零写入。
- 模型执行有独立文本/OCR 并发队列、队列上限、超时和熔断；健康接口不被已满业务槽位阻断。

## 5. Provider 与模型状态

| 项目 | 本轮证据 | 结论 |
| --- | --- | --- |
| Mock Provider | 成功、unmapped、invalid JSON、timeout、injection、并发单调用 | `passed` |
| Qwen 文本资产 | 13 个文件，9.31 GiB | `verified_local_asset` |
| PaddleOCR 资产 | 23 个文件，2 GiB | `verified_local_asset` |
| 常驻服务 | `qwen-text`、`paddle-ocr` 连续运行 3 天且健康 | `healthy_local` |
| 按需服务 | Qwen VL、Embedding 保持离线 | `expected_offline` |
| 外部 Provider | H12 未批准真实数据厂商/地域/字段/用途/保留 | `disabled_fail_closed` |

资产和健康不等于字段准确率。H04/H05 的 OCR 真值/盲测和真实文本模型业务验收仍需独立人工证据。

## 6. 自动化证据

| 门禁 | 结果 | 本轮实际证据 |
| --- | --- | --- |
| 后端 Jest | `passed` | 47/47 suites，410/410 tests |
| Excel parser 定向 | `passed` | 1/1 suite，14/14 tests，含 4,999 显式边界 |
| Report PostgreSQL 定向 | `passed` | 1/1；并发快照、分页、权限、kill switch、并发 Provider、超时脱敏、截断 JSON、Claim 攻击 |
| PostgreSQL 全量 | `passed` | 最终 10/10 suites，97/97 tests，189.756 s；上一轮同样 97/97，275.543 s |
| Playwright API | `passed` | 17/17，56.7 s；结束后 0 文件残留 |
| Prisma/migration | `passed` | 空库 41 条；40→41 升级；222 indexes、89 foreign keys |
| 前端 runtime | `passed` | 4/4 |
| 前后端 build | `passed` | NestJS/Prisma/scripts；Vite 3,147 modules |
| Dependency audit | `passed` | 根目录和 backend 均 0 vulnerabilities |
| Repository hygiene | `passed` | 706 tracked/candidate files |
| Staging config/SBOM/log | `passed` | 3/3、7/7、4/4 |
| Backup integrity | `passed` | 9 cases；固定镜像构建成功 |
| Image identity attacks | `passed` | 17 cases；fixture 已清理 |
| Model deployment config | `passed` | digest、auth、isolation、resource、transition |

主要命令：

```text
cd backend && npm test -- --runInBand
cd backend && npm run test:integration
cd backend && node scripts/run-integration-tests.mjs test/integration/report-snapshots.integration-spec.ts
cd backend && npm run db:migration-paths
npm run test:e2e
npm run test:runtime
npm run build
cd backend && npm run build
npm run check:hygiene
npm audit --omit=dev --audit-level=high
cd backend && npm audit --omit=dev --audit-level=high
npm run staging:config:test
npm run staging:sbom:test
npm run staging:logs:test
npm run staging:backup-integrity:test
npm run staging:image-integrity:test -- --defer-scan --retain-fixtures
npm run staging:image-integrity:test -- --cleanup
cd backend && npm run model:config:check
cd backend && npm run model:check
cd backend && npm run model:services:status
```

## 7. 未关闭门禁

- `H01 pending formal signoff/examples`：系统已按每个有效明细行一条记录实现；真实汇总行样例、识别特征和正式签字仍缺。
- `H04/H05 awaiting human evidence`：17 份 OCR 标签和 5 份盲测真值未由独立人员冻结。
- `H06/H08 pending human decision`：真实逐分对账、正式指标定义、老板标准问题/答案和签字未完成。
- `H10 pending human decision`：正式 MFA、职责分离、批量 step-up 和例外策略未批准；当前采用保守禁止上传者自审批。
- `H12/H14 pending human decision`：外部 Provider 与正式数据保留/删除政策未批准，真实外发和 destructive retention 继续关闭。
- `H13 blocked_external`：目标 Linux、域名、GPU、对象存储、告警和正式容量预算未提供。
- `H15/H16 blocked_external`：独立审查和最终 UAT/Go Live 未执行。
- GitHub 推送和远端 CI 此前连续两次网络失败，当前仍为 `blocked_external`；本报告没有把本机结果写成远端 CI 通过。
- 本轮没有执行完整 18 服务 release/restore/rollback。历史 R8.6 本机证据仍有效，目标环境和新的完整重验继续受 H13/H14 及外部镜像网络约束。

## 8. 下一步

进入 M8：冻结最终测试清单和状态表，核对 Prompt manifest/registry/Schema/content hash 漂移门禁，更新架构/API/运行手册、迁移证据、README、Draft PR reviewer guide 与 H 门禁矩阵；执行最终 staged hygiene、secret scan、全量回归和小步提交。不得 merge、标记 Ready 或宣称 production-ready。

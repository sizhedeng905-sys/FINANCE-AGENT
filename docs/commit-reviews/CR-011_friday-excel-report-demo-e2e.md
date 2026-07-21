# CR-011：周五 Excel 到经营报告演示 E2E

## 1. 提交目的

用一条可重复、纯合成、真实 API 的 Playwright 故事线证明：财务 A 上传并映射 Excel，财务 B 复核批准，批准前正式经营数据保持不变，批准后每个有效明细行只生成一条正式记录，项目结构、老板报告和 canonical ReportSnapshot 与人工真值逐分一致。

## 2. 范围与非范围

本提交新增一个运行时生成的三行合成 Excel fixture 和一条独立 E2E。测试复用现有上传、解析、工作表/表头、确定性映射、公式缓存 warning、重新校验、职责分离、异步确认、正式记录、项目结构、老板报告和 ReportSnapshot API。

本提交不修改业务实现、数据库 Schema、前端设计、AI Provider、OCR 或财务口径；不提交生成出的 `.xlsx` 二进制，也不依赖真实数据、本地模型、GitHub 或外网。任务 C 的演示运行包仍作为下一独立提交。

## 3. 修改文件

- `backend/scripts/generate-e2e-excel.mjs`：生成 `E2E 周五演示费用导入.xlsx`，含两行普通金额和一行公式缓存金额。
- `e2e/friday-demo.spec.ts`：新增完整批准前后故事线、攻击边界、幂等和报告哈希断言。
- `README.md`、`NEXT_TODO.md`、实施进度、持续执行报告和 CR/汇报索引：更新当前工程证据和下一任务。

## 4. 数据与状态机影响

没有生产数据或状态机变化。测试在 `_test` PostgreSQL 中创建一个导入任务、3 条正式记录、一个新报告快照和一个文件引用；全局 teardown 实际清理这些数据和文件。

故事线只通过现有服务端命令推进 `uploaded -> pending_confirm -> confirming -> confirmed`。客户端不提交目标状态，公式缓存结果仍生成 warning 并要求另一财务显式重新校验和确认。

## 5. API 与权限影响

没有新增 API。测试使用四个既有受保护接口组：import tasks、records、projects structure/summary、boss reports/snapshots。

- `finance` 为上传者，只能完成映射，批准按钮保持禁用。
- 中文账号 `财务` 是不同用户，重新读取最新任务后才能批准。
- `boss` 只读经营报告、创建审计快照并读取来源。
- 所有直接 API 请求使用服务端签发的 Bearer Token，不传伪造角色、操作者或项目归属。

## 6. 安全与隐私影响

fixture 的项目、车牌和人员均为显式合成值，文件在测试准备阶段本地生成并由 ignore 边界排除。访问 Token 只存在测试进程内存，不写文档或日志。

批准前，测试根据现有确定性 record ID 规则尝试 GET、PATCH、confirm 和 DELETE，四类通用 record API 均返回统一 404；正式列表、项目 structure 记录集合、项目汇总金额和老板报告金额均保持基线。公式内容不会执行，只读取文件内缓存结果并保留 warning。

## 7. 测试证据

- 初次加载失败：测试错误地把 bigint 分币与 number 初值相加；修正为全 bigint 后继续。
- 首次真实解析失败：`2300.30` 的公式缓存被 XLSX 序列化为不满足高精度保护的数值，系统正确失败关闭；fixture 改用仓库已有安全规范化证据的 `8765.43`，未放宽校验。
- 后续两次失败分别来自测试比较 `generatedAt` 和读取被浏览器回收的预取响应；改为只比较财务事实，并用 boss Bearer Token 查询确定性报告。
- `npx playwright test e2e/friday-demo.spec.ts`：PASS，1/1，最终 21.6 秒；补强 project structure 后再次 PASS，1/1，21.6 秒。
- `npm run test:e2e`：PASS，18/18，64.9 秒；新增故事线 7.5 秒，teardown 清理 5 import tasks、6 records、3 report snapshots、6 file references。
- 强制 Redis 的 `npm run test:integration --prefix backend`：PASS，14 suites / 124 tests，365.187 秒；30,196 行 37.320 秒，49,999 行 160.728 秒。
- `npm test --prefix backend`：PASS，50 suites / 464 tests，22.957 秒。
- 根目录与后端 `npm run build`：PASS；`npm run test:runtime`：PASS，4/4。
- `npm run db:migration-paths --prefix backend`：PASS，空库 43 migrations 和 42 到 43 升级；48 tables、34 enums、224 indexes、89 foreign keys。
- 根目录与后端 production dependency audit：PASS，均为 0 vulnerabilities。
- 文档、repository/staged hygiene、diff 检查在提交前执行并记录。

## 8. 新增边界与攻击用例

- 上传者自审批按钮禁用，第二财务必须重新校验并确认 warning。
- 批准前通用列表、GET、PATCH、confirm、DELETE 都无法发现或修改未来正式记录。
- 项目 structure 的记录 ID 集合、项目 totalCost、老板 expense/recordCount 在批准前不变。
- 同一批准请求使用相同 `Idempotency-Key` 重放，返回同一结果；重复读取不新增记录。
- 批准后恰好 3 条 `confirmed/excel` 记录，金额为 `1250.25`、`3406.53`、`8765.43`，合计 `13422.21`。
- project structure 只新增这 3 个正式 record ID；老板报告和 Snapshot 的 CNY cost/recordCount 增量一致。
- 从全部 Snapshot sources 重算 `sourceDigest`，并从 canonical facts 重算 `snapshotHash`，均与服务端结果一致。
- 测试只依赖确定性报告；AI 叙述不是主链成功条件。

## 9. 迁移、部署与回滚

没有 migration 或部署配置变化。回滚只需移除新 E2E 与 fixture 生成段，不会改动数据库。生成的二进制 fixture 位于忽略目录，测试 teardown 负责清理数据库引用和上传文件。

## 10. 已知限制与剩余任务

- 本提交证明自动化故事线，不等于人工现场已连续演练三次。
- 真实公司 Excel、真实财务逐分真值和正式统计口径仍为 `REAL_SAMPLE_NEEDED`。
- OCR 和本地模型不在主演示链；真实模型准确率没有被本测试证明。
- 下一提交需要建立 `docs/deliveries/2026-07-24/` 的 5-8 分钟演示稿、验收表、限制和重复初始化/验证说明。

## 11. 审查者检查清单

- [ ] fixture 只由代码生成，未提交 `.xlsx` 或真实公司信息
- [ ] 财务 A 不能自审批，财务 B 使用独立账号批准
- [ ] 公式缓存始终带 warning 和人工确认，不执行公式
- [ ] 批准前 records、project structure 与老板金额不变
- [ ] 通用 record API 不能读写批准前记录
- [ ] 批准后恰好 3 条记录且逐分合计为 `13422.21`
- [ ] 幂等重放和重复读取不重复入账
- [ ] Snapshot sourceCount/sourceDigest/snapshotHash 均从正式来源重算
- [ ] 测试走真实 API，不使用 route mock 或 AI 作为主断言
- [ ] teardown 清理测试数据与文件，用户资产未进入提交
- [ ] Draft PR 保持 Draft，不 merge、不标记 Ready

## 12. 状态

`REMOTE_ENGINEERING_VERIFIED`。合成故事线及全量本地门禁已经通过，并随 SHA `66749b3` 取得 Build run `29828098638` 与 CodeQL run `29828098718` 绿色证据。任务 C 的运行包已由 CR-012 完成，真实三次人工演练仍为 `NOT_RUN`。

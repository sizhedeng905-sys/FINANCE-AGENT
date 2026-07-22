# CR-002：Excel 暂存隔离与发布完整性攻击回归

## 1. 提交目的

在修改生产实现之前，用真实 PostgreSQL、后台确认 Worker 和 HTTP Token 固定两个 P0 缺陷：

1. Excel 确认任务已生成、尚未原子发布的 `BusinessRecord` 可被通用记录 API 读取和改写；
2. 暂存记录的状态、金额、动态字段和版本被篡改后，最终发布仍会错误成功。

本提交是故意保持红灯的漏洞复现提交。下一提交必须让这些断言在不削弱测试的前提下转绿。

## 2. 范围与非范围

本提交只修改 PostgreSQL 集成测试和 commit-review 索引，不修改 Prisma schema、业务服务、API 契约、前端或部署配置。

不在本提交中隐藏失败、放宽断言或增加 Mock。由于 HEAD 的测试门禁预期失败，本提交暂不单独推送远端；修复提交转绿后再按正常顺序推送两个提交。

## 3. 修改文件

- `backend/test/integration/postgres.integration-spec.ts`：新增暂存可见性/写旁路和数据库篡改攻击测试。
- `docs/commit-reviews/README.md`：登记 CR-002。
- `docs/commit-reviews/CR-002_excel-staging-attack-regression.md`：记录测试设计、实际失败和修复约束。

## 4. 攻击用例与边界

### 4.1 API 暂存旁路

- 原上传财务用真实 Bearer Token 请求批准，断言 `403` 和 `IMPORT_SELF_APPROVAL_FORBIDDEN`，且没有生成暂存记录；
- 第二财务正常批准并启动后台任务；
- 测试在全部暂存行写入后、最终发布事务前暂停 Worker；
- 使用通用 `records` 列表、详情、项目记录、项目结构、PATCH、confirm 和 DELETE 接口攻击三个独立暂存记录；
- 安全目标是列表总数为 0、结构不包含暂存记录、单记录读写均返回 404、数据库状态和版本保持不变。

### 4.2 数据库暂存篡改

- 在最终完整性预检前，把一个暂存记录改为 `draft`；
- 同时篡改顶层金额、金额动态字段及记录版本；
- 安全目标是整批进入 `confirmation_failed`，且通用记录 API 仍不可见；
- 不允许最终发布只更新满足 `pending_confirm` 条件的部分行后仍把任务标为成功。

## 5. 实际红灯证据

执行命令：

```bash
cd backend
npm run test:integration -- --runTestsByPath test/integration/postgres.integration-spec.ts --testNamePattern "keeps unpublished staging unreachable|fails publication closed"
```

实际结果：退出码 1；1 个 suite，2 个目标测试失败，72 个测试按名称过滤跳过；测试执行 5.748 秒。

失败一的当前行为：

- 通用列表返回 3 条暂存记录；
- 详情返回 200；
- 项目记录返回 3 条，项目结构包含暂存记录；
- PATCH 返回 200，confirm 返回 201，DELETE 返回 200；
- 三条数据库记录分别被改写、确认和作废，版本均从 1 变为 2。

失败二的当前行为：

- 暂存状态、金额、动态字段和版本被直接篡改后，任务仍进入 `confirmed`；
- 通用列表可见记录数为 2，而安全预期为 0。

以上失败均为预期安全失败，不是数据库连接、migration、seed、编译或测试夹具失败。

提交卫生检查：`npm run check:hygiene` 通过，共检查 724 个 tracked/candidate 文件；`git diff --check` 通过。

## 6. 修复不变量

- 手工 `pending_confirm` 记录继续按现有业务规则可见，不能通过隐藏全部待确认记录修复；
- 暂存/已发布必须有独立、持久化、可查询的结构语义；
- 所有通用记录读写和项目结构必须默认只接受已发布记录；
- 最终发布必须核对任务、批准快照、记录数量、记录状态、版本、内容摘要、动态字段和 affected row count；
- 任一不一致必须整批失败关闭，不得留下部分正式可见记录；
- 上传者自审批、第二财务审批、重试、恢复、取消和大批量路径不得回归。

## 7. 数据、安全与隐私

测试只使用 seed 账号和合成项目/行，不读取 `.env` 内容、不提交真实业务文件、上传隔离区、模型权重或用户未跟踪资产。测试数据库名称仍由现有脚本强制要求以 `_test` 结尾，并在运行前重置。

## 8. 回滚

普通 revert 本提交即可删除攻击测试和审查文档。不得通过回滚测试来宣称 P0 已解决。

## 9. 审查清单

- [x] 测试使用真实 PostgreSQL 和 HTTP API
- [x] 上传者自审批失败关闭
- [x] 第二财务可进入合法后台批准路径
- [x] 覆盖 list/detail/project records/project structure
- [x] 覆盖 PATCH/confirm/void 写旁路
- [x] 覆盖暂存状态、内容、动态字段和版本篡改
- [x] 红灯原因与目标缺陷一致
- [ ] 生产实现已修复
- [ ] P0 定向测试转绿
- [ ] P0 全量回归通过

## 10. 状态

EXPECTED_FAIL

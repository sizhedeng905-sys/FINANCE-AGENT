# CR-052 Import confirmation pagination indexes

## 目标

修复累计执行 PostgreSQL 集成测试时，49,999 行 Excel 最终确认可能超过 180 秒产品断言的问题。

## 复现

- 单独执行 49,999 行场景约 73 秒通过。
- 在完整 PostgreSQL suite 中，任务已完成 49,999 行暂存和处理，但最终完整性核对重复扫描/排序，超过 180 秒。
- 失败没有产生部分正式记录，说明事务与失败关闭边界有效；问题位于最终 keyset 完整性扫描的查询计划。

## 修改

新增第 52 条向后兼容 migration：

- `business_records(import_task_id, id)`
- `import_rows(import_task_id, row_number, id)`

Prisma schema 同步声明两个复合索引。migration 不修改数据、不调用模型，也不改变记录可见性或批准规则。

## 测试证据

- 累计 30,196 + 49,999 行定向场景通过，耗时约 37.744 秒和 74.821 秒。
- 完整 PostgreSQL/Redis：11 executed suites passed，3 skipped；111 passed，14 skipped，0 failed，共 125 tests。
- 完整 suite 中 49,999 行约 172.883 秒，低于 180 秒断言。
- Prisma format、validate、generate 和 52 条 test migration 通过。
- 后端全量单元 479/479、Playwright 22/22、前后端构建通过。

## 风险与边界

- 完整 suite 的 49,999 行耗时仍接近 180 秒，属于需要持续监控的容量余量，不等于目标生产硬件容量验收。
- 普通 `CREATE INDEX` 在正式大表上可能持锁；生产迁移必须在目标环境评估数据量、锁等待和维护窗口。
- 本次只在名称以 `_test` 结尾的数据库执行，不连接生产数据库。

## 回滚

应用代码可使用 `git revert <CR-052-sha>`。已经部署索引时，不建议在高峰期立即删除；应由数据库负责人评估锁和查询回退后另行执行受控 migration。

# R4 备份与恢复完整性报告

日期：2026-07-18
分支：`agent/b8-stable-hardening`
状态：`engineering_verified_locally`
生产状态：`blocked_external`，等待 H13/H14

## 1. 原问题与红灯

旧实现只比较对象数量。以下情况可能在数量相同的情况下被误判为可恢复：

- 相同数量但 key 不同；
- 相同 key 但 size 或内容不同；
- multipart ETag 被误当作内容摘要；
- 数据库 `raw_files` 引用不存在、size 不同或 SHA-256 不同；
- manifest 被修改；
- 数据库 migration 与备份不一致。

旧正式恢复还会先覆盖 live 数据库，再复制对象；对象复制失败时可能留下数据库/对象半恢复状态。真实演练进一步证明旧脚本使用 `NOCREATEDB` 的 migrator 创建临时库，实际会被 PostgreSQL 拒绝。

## 2. 已实现

### 2.1 `backup-manifest/1.0`

每个完成备份现在包含：

- `database.dump`：PostgreSQL custom dump、bytes、SHA-256；
- `database-schema.sql`：移除 PostgreSQL 17 随机 `restrict` token 后的稳定 schema；
- `database-migrations.jsonl`：完整且排序的 migration ledger；
- `database-object-refs.jsonl`：活动 `raw_files` 的 key、size、SHA-256；
- `source-object-manifest.jsonl` 与 `object-manifest.jsonl`；
- `manifest.json` 与独立 `manifest.sha256`；
- 匿名环境 ID、工具版本、对象总量/总字节和未引用对象统计。

对象 key 以 Base64 编码。每个对象记录 size、ETag、version ID、metadata、服务端 checksum、encryption/retention/legal-hold 状态，以及通过 `mc cat | sha256sum` 流式计算的强内容哈希。ETag 只作元数据，不作内容证明。对象 metadata 中声明的 SHA-256 会被标为 `matched`、`missing` 或 `mismatch`；实际内容仍以流式 SHA-256 为准。

旧清单不会自动升级或伪造验证结果。恢复端以 `legacy_manifest_unverified_content:count=N` 明确拒绝，并量化其未验证对象数。

### 2.2 一致性边界

备份流程在 dump 前、dump 后和对象镜像后重复生成数据库对象引用；任一变化都会使备份失败。对象先生成源清单，再镜像到按 backupId 隔离的前缀并重新计算强哈希；复制期间的新增、删除或内容变化都会失败。

失败备份不生成 `complete`，远端部分对象被清理，本地诊断材料移动到 `failed/<backupId>`。恢复只选择带 `complete` 的备份。

### 2.3 恢复角色与隔离演练

新增 `finance_restore`：`NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT`。它不获得 `finance_agent_staging` 的连接或业务表权限，只负责创建和删除隔离恢复库。初始化和已有数据卷均通过幂等供应脚本覆盖。

恢复演练执行顺序：

1. 校验 manifest sidecar 和所有本地 artifact；
2. 创建唯一 `_test` 临时数据库与临时桶；
3. 恢复 dump 和对象；
4. 重新生成 schema、migration、对象清单和 DB 引用；
5. 核对应用表、audit、ledger、RawFile 和实际对象读取；
6. 执行对象与数据库故障注入；
7. 写不含业务内容的演练证据和 Prometheus 指标；
8. 删除临时数据库与临时桶。

### 2.4 正式恢复门禁

正式恢复要求只读 JSON 授权文件，必须精确绑定 target environment/database/bucket、backupId、changeId、唯一 nonce、24 小时内到期时间和 H13/H14 审批号。授权 SHA-256 通过原子目录标记只能消费一次。

任何 live 写入前先完成隔离恢复，并创建当前 live 数据库 dump、对象强哈希清单和独立补偿桶。切换采用：

```text
应用停写 -> 隔离验证 -> 补偿快照 -> 对象切换 -> 数据库单事务恢复
-> 全量复核 -> audit/ledger -> 保留补偿证据
```

PostgreSQL 与 S3 不存在跨系统原子事务，因此这里只声明“应用级分阶段切换并补偿”。中途失败会尝试按补偿 manifest 恢复数据库与对象；补偿失败会保留明确错误和补偿位置。未经 H13/H14 授权，本轮没有执行 live restore。

## 3. 自动化与实测证据

| 门禁 | 结果 |
| --- | --- |
| Jest 定向 | 2 suites，15 tests 通过 |
| 后端全量 Jest | 31/31 suites，285/285 tests 通过 |
| PostgreSQL 集成 | 2/2 suites，61/61 tests 通过 |
| 前端与浏览器回归 | production API build 3,144 modules；runtime 4/4；Playwright 16/16 |
| Prisma/migration | validate 通过；空库 24 条和 23→24 升级路径通过 |
| 容器内完整性自测 | 9/9 通过 |
| 有对象备份/隔离恢复 | 42 表、1 DB 引用、1 对象、19 bytes，全部匹配 |
| 空对象备份/隔离恢复 | 42 表、0 DB 引用、0 对象，全部匹配 |
| 对象故障注入 | 同数量错 key、错 size、同 size 错内容、缺失、额外对象全部拒绝 |
| 数据库故障注入 | migration 删除和 `raw_files` SHA-256 篡改全部拒绝 |
| manifest/旧格式 | sidecar 篡改和旧数量清单全部拒绝 |
| 恢复角色 | 幂等供应连续执行两次；`CREATEDB=true`、`SUPERUSER=false`、`CREATEROLE=false`、`INHERIT=false` |
| 应用读取 | 有对象路径实际读取并匹配 SHA-256；空路径验证数据库可读与桶为空 |
| 本机 RTO | 3 秒；仅合成隔离测量 |
| 本机 RPO | 有对象 363 秒、空对象 15 秒；仅合成隔离测量 |
| 生产依赖审计 | 根目录与后端均为 0 vulnerabilities |
| 测试资源清理 | `finance-agent-r4` 容器、卷、网络均为 0 |

主要命令：

```bash
npx jest --runInBand test/s3-storage.spec.ts test/staging-deployment.spec.ts
npm run staging:backup-integrity:test
docker compose -p finance-agent-r4 -f deploy/staging/compose.yaml run --rm backup /opt/staging/run-backup.sh
docker compose -p finance-agent-r4 -f deploy/staging/compose.yaml run --rm backup /opt/staging/restore-drill.sh
```

最后两条在本机使用等价的单次入口覆写运行，以避免启动常驻 backup loop；输入仅为合成数据。演练证据在被 Git 忽略的测试卷中，不提交对象内容或 secret。

## 4. 未完成与保守行为

- H13 未指定目标 Linux、registry、对象存储拓扑和正式恢复窗口；
- H14 未批准 RPO/RTO、保留、删除、legal hold、SSE/KMS、不可变异地副本和补偿副本期限；
- 未执行目标环境 live restore、真实 offsite 恢复或正式 rollback；
- 未声称本机 3 秒 RTO/15-363 秒 RPO 达到业务要求；
- 未将 private bucket、versioning 或本地卷写成加密/异地灾备完成。

默认行为是失败关闭：授权缺失、旧清单、任一强哈希缺失、manifest 篡改、DB/对象不一致或临时恢复失败，均不得进入 live 切换。

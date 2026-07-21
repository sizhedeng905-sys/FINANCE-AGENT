# R3 对象存储容量真实性报告

更新日期：2026-07-18

分支：`agent/b8-stable-hardening`

状态：工程修复与合成/本机验收完成；H13/H14 `pending_human_decision`

## 问题与红灯

旧 `S3FileStorageService.availableBytes()` 只执行 `HeadBucket`，随后无条件返回固定 `S3_CAPACITY_BYTES=1 TiB`。这只能证明 bucket 可访问，不能证明 MinIO/S3 的物理可用空间，却被 readiness、上传水位和告警共同当成真实容量。

修复前测试实际失败：S3 没有结构化 `capacity()`，探测成功后也无法区分物理容量未知与固定配置值。

## 已实现契约

`FileStorage.capacity()` 返回：

- `backend`、`probeOk`、`capacitySource`；
- 仅在来源可信时返回 `totalBytes`、`usedBytes`、`availableBytes`；
- `observedAt`、`stalenessSeconds`、`isEstimated`、`limitations`。

容量来源限定为 `logical_quota`、`volume_metric`、`provider_metric`、`estimated_usage` 或 `unknown`：

- 本地存储使用 `statfs`，来源为 `volume_metric`；
- S3 `HeadBucket` 成功只表示 `probeOk=true`，物理容量仍为 `unknown`；
- S3 上传准入使用显式 `S3_LOGICAL_QUOTA_BYTES` 和 PostgreSQL 中未作废 `raw_files.file_size` 汇总；
- `S3_CAPACITY_BYTES` 已停止支持，启动时会要求迁移到明确标为逻辑配额的新变量；
- Provider 不可达、容量未知、指标过期、估算或数据矛盾均失败关闭。

稳定拒绝原因包括：

```text
storage_probe_failed
capacity_metric_stale
capacity_unknown
capacity_estimated
capacity_inconsistent
incoming_file_exceeds_available
capacity_reserve_breached
```

无法验证容量返回 HTTP/code `503/50301`；文件超过可用量或会侵占保留水位返回 `507/50701`。统一错误 envelope 保留 `data.reason`。

## 并发与事务

上传按以下顺序执行：

1. 校验文件与安全扫描；
2. 使用结构化容量快照做预检；
3. 写入对象；对象写失败时不启动数据库事务；
4. 在正式 PostgreSQL 事务内获取全局 advisory lock；
5. 重新汇总已提交逻辑用量并校验配额与保留水位；
6. 通过后写 `raw_files`、audit 和 ledger；失败则回滚并删除刚写入对象。

逻辑用量不依赖进程内计数，也不扫描整个 bucket。数据库事实不包含尚未提交对象和待人工处置孤儿，因此 health/metrics 明确返回限制说明，物理容量由独立 MinIO 指标监控。

## Readiness 与监控

`GET /api/health/ready` 的 `checks.storage` 现在包含容量来源和上传准入原因。Prometheus 暴露：

```text
finance_agent_storage_probe_healthy
finance_agent_storage_capacity_source
finance_agent_storage_capacity_staleness_seconds
finance_agent_storage_physical_capacity_known
finance_agent_storage_capacity_bytes
```

Staging Prometheus 直接在私网抓取 `/minio/metrics/v3/cluster/health`。对象 TLS 网关明确对外阻断 `/minio/metrics/` 与 `/minio/v2/metrics/`。Grafana 自动配置 `Finance Agent Storage Capacity` dashboard。

暂定 staging 门限：逻辑配额使用率超过 80% 告警，MinIO 物理可用比例低于 30% 告警，物理指标缺失直接告警。这些只是 H13/H14 签字前的保守默认，不是正式生产容量政策。

## 验收证据

- 容量、S3、health、文件、配置、指标和 staging 定向 Jest：79/79；
- 错误码与容量策略复核：11/11；
- PostgreSQL 并发：两个不同财务账号和两个项目同时上传，只允许一个 `201`，另一个为 `50701`；数据库和对象目录均只新增成功的一份；
- 对象写满故障注入：`save()` 失败时数据库事务与 `raw_file.create` 调用均为 0；
- 后端全量：31/31 suites、284/284 tests；PostgreSQL 全量：2/2 suites、61/61 tests；
- 前端 runtime 4/4、API production build 3,144 modules、Playwright 16/16；
- Prisma schema valid，24 条空库安装和 23→24 升级路径通过；
- `docker compose config --quiet`：通过；
- Prometheus `promtool`：配置有效，13 条规则有效；
- Nginx `-t`：通过；
- 固定 MinIO 镜像实测 v3 endpoint 同时返回 usable free/total bytes；独立测试 project、容器、网络和卷残留为 0。

完整回归数量以 README 与本阶段提交记录为准。

## 未决门禁

- H13：目标服务器/卷、正式逻辑配额、告警接收人、扩容策略；
- H14：保留水位、对象保留/删除、孤儿对象处置和告警保留期；
- 目标 Linux Staging 尚未执行真实容量压测和写满演练。

因此可以声明“固定容量伪装已移除，工程准入与监控链已验证”，不能声明“生产容量门禁已批准”或“目标环境容量已验收”。

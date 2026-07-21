# R8.6 新鲜备份与发布恢复门禁报告

日期：2026-07-18

分支：`agent/b8-stable-hardening`

运行基线：`a1e9845`（R8.5）

## 结论

R8.5 的 PostgreSQL 私网 TLS 修复已经通过真实 Compose 动态验证。该次完整发布运行 1001.3 秒，依次通过 18 镜像构建、不可变锁定、Docker Scout SPDX、固定 Grype、sealed supply-chain index、PostgreSQL 远程 TLS、28 条 migration、运行镜像身份、API smoke 和浏览器 smoke。

发布在隔离恢复演练处失败，原因不是恢复算法本身，而是 backup loop 首轮备份已经失败：UID 999 运行的 MinIO 客户端尝试把配置写入不可写的 `/var/lib/postgresql`。恢复演练在没有 `complete` 标记时正确失败关闭，没有使用半成品。

R8.6 的永久修复已在干净提交后完成完整 release、运行日志复核和同 manifest rollback。所有本机工程 gate 通过；该结论仍不代表目标 Linux、跨版本回退、正式数据恢复或 H13/H14 通过。

## 修复

- backup service 给 UID 999 提供私有 tmpfs HOME；`mc` 管理配置和凭据只存在于容器内存，容器销毁即清除，不写持久备份卷。
- `run-backup.sh` 与 `restore-drill.sh` 拒绝 UID 999 之外的执行者；release 的部署前备份、部署后备份、恢复演练及 rollback 的保护性备份均显式使用 `999:999`。
- 备份使用固定 1200 秒上限的 `flock`，避免定时 loop 与发布命令并发写同一备份目录。
- release 在 Compose 启动前记录 epoch；smoke 后确保存在 `createdEpoch` 不早于该时间的 complete backup。定时 loop 已完成新鲜备份时复用，否则串行生成一份。
- restore drill 只在新鲜备份门禁通过后运行，仍使用隔离数据库与临时 bucket，不接触 live 数据。
- MinIO alias、账号启用和 policy attach 不再输出账号标识；失败只输出固定类别，不回显 secret。
- 备份镜像显式安装 `util-linux`，不再偶然依赖传递安装的 `flock`。

## 实际证据

| 门禁 | 结果 |
| --- | --- |
| R8.5 完整发布 | 1001.3 秒；供应链、TLS、migration、18 服务、API/浏览器 smoke passed；restore 前因无 complete backup failed |
| PostgreSQL migration | 28 条已完成 migration；远程 migrator `verify-full` 健康检查 passed |
| 临时备份验证 | UID 999 + 可写 MC_CONFIG_DIR；0 对象强哈希备份 3 秒 passed |
| 临时隔离恢复 | 4 秒；45 张表、Schema/migration、5 类对象故障、migration 篡改拒绝 passed |
| 日志泄露定位 | `s3_access_key_id` 仅在旧 `minio-init` policy attach 日志出现 1 次 |
| 修复后运行日志 | 19 secrets、586,356 bytes、2,887 行；0 findings、0 exact matches |
| 备份完整性自测 | 9/9 passed；6 个强哈希、2 个 manifest、1 个数据库引用场景 |
| 备份权限/输入负测 | root backup、root restore、非法 required epoch 共 3/3 被拒绝 |
| 部署/CI 契约 | 2 suites、18/18 tests passed |
| 配置与语法 | 18-service Compose config、3 个 shell 脚本、release Node 语法 passed |
| R8.6 完整 release | 1010.9 秒；manifest `20260718T221820Z-97efc1856f28` 七项 gate passed |
| 最终运行日志 | 19 secrets、718,592 bytes、3,393 行；0 findings、0 exact matches |
| 同 manifest rollback | 55.6 秒；保护性备份、migration/镜像复核、四角色/API/worker/metrics smoke passed；data restore 未执行 |

## 尚未通过

- 跨版本代码回退：没有 R8.6 之前的合法 sealed manifest，本轮只能验证同 manifest 幂等回退，状态为 `not_run`。
- rollback 暴露的 Prisma/OpenSSL runtime warning 已由 R8.7 最终镜像定向修复；R8.7 完整 release 重验连续两次在 Debian security 索引 502 处失败，状态为 `blocked_external`，因此 migration/rollback 告警复核未运行。
- 目标 Linux Staging、registry/签名、正式恢复及 RPO/RTO：`blocked_external(H13,H14)`。
- 真实数据恢复与保留策略：`pending_human_decision(H14)`。
- GPU L0 workflow 与真实 OCR/AI 准确率：分别为 `not_run` 和 `awaiting_human_signoff(H04-H09,H12,H16)`。

## 下一动作

Debian security 镜像恢复后重跑完整 release，确认 migration/rollback 不再出现 Prisma OpenSSL 检测告警；当前已完成资源清理与容器、网络、卷零残留断言。

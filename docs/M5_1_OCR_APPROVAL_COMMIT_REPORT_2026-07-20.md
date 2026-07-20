# M5.1 OCR 财务批准快照与事务入账报告

日期：2026-07-20
分支：`agent/b8-stable-hardening`
状态：`passed`（OCR 子链工程、Mock、合成 PostgreSQL 与浏览器验收）

## 实现范围

- 复用现有 `OcrTask`、ValidationSnapshot、项目写锁、`IdempotencyService`、`BusinessRecord/RecordValue`、audit 和 ledger，没有创建平行审批或正式记录模块。
- `POST /api/ocr-tasks/:id/confirm` 现在必须提交 `expectedVersion`、`expectedReviewRevision`、`expectedValidationSnapshotHash`、`expectedPayloadHash` 和完整 `acknowledgedWarningIds`；客户端不能提交目标状态。
- 低置信度等非阻断警告具有内容寻址的稳定 ID。批准时要求精确确认当前快照的全部警告，漏项、增项、旧 ID 或被篡改 ID 均失败关闭。
- 最终事务重新读取当前用户，要求账号仍启用、Token version 未变化且角色仍为 finance。上传者自审批固定返回 403；当前 step-up 默认关闭，不能被当成放开自审批的依据。
- 最终事务重新核对任务/审核版本、source/file/IR hash、文件安全状态及项目归属、模板版本、候选载荷、校验规则、阻断错误和 evidence refs。校验后文件被作废、扫描失败或归属变化时不得入账。
- 批准快照冻结 source/IR、模板、OCR Provider/模型、review/validation、转换注册表、财务/授权策略、批准人、警告确认、幂等请求指纹和规范输出哈希。
- 正式 `BusinessRecord`、动态值、`OcrTask` 批准快照、audit 和 ledger 在同一 PostgreSQL 事务写入。两个财务并发批准只能有一个成功；同一 actor/key/body 重放返回原响应，改体重放返回 409。
- 前端在上传者查看任务时明确显示“上传者不能自审批”并禁用批准按钮。另一名财务重新登录后读取同一校验快照，使用稳定幂等键完成批准。
- Mock Repository 使用同一命令 DTO、警告确认、版本校验和自审批边界；另提供第二个 Mock 财务账号用于职责分离演示。

## 数据库迁移

- `20260720203000_ocr_approval_snapshots`
- `ocr_tasks` 新增批准快照、快照哈希、审核修订、校验快照哈希、策略版本和请求键哈希。
- 数据库 CHECK 约束批准字段全空或全有、两个 SHA-256 格式、非负且不超当前 review revision、非空策略版本和请求键哈希。
- 既有已确认任务不伪造历史批准快照；新服务路径强制写入完整快照。

验证结果：Prisma generate/validate、空库 36/36 migrations、已有库 35→36 升级均通过。

## 自动化证据

```text
backend production build
passed

frontend production build
passed，3,147 modules

backend full Jest
46 suites / 403 tests passed

PostgreSQL OCR approval scenario
1/1 passed
覆盖无校验、警告漏确认、自审批、文件作废、账号停用、角色撤销、
两名财务并发、幂等重放、改体重放、批准快照、audit/ledger 和唯一正式记录

PostgreSQL project/template serialization
1/1 targeted passed

migration paths
empty 36/36；upgrade 35 -> 36 passed

Playwright OCR targeted
1/1 passed

Playwright full regression
17/17 passed
```

## 未完成与边界

- M5 尚未整体完成。Excel 当前仍存在 `valid_rows_only` 和错误行存在时发布合法行的旧语义；`M5-PARTIAL-COMMIT-001` 保持 P0 open，必须由 M5.2 改为整批失败关闭。
- OCR 子链的工程职责分离已验证，但正式角色矩阵、MFA/第二身份方式及生产审批授权仍受 H10 人工门禁约束。
- 本报告使用 Mock OCR 和合成 PDF，不代表 H04/H05 的真实 OCR 准确率、盲测或真实财务 UAT 已通过。
- 集成启动仍会输出既有存储调和日志 `非法文件路径`；测试通过，但该噪声没有在本阶段伪装为已修复。
- GitHub 推送仍受此前 `github.com:443` 连续两次连接失败影响；当前仅声明本地证据。

## 下一步

进入 M5.2：给 Excel ImportTask 增加 review/validation/approval snapshot，任何错误行或未处置阻断项都禁止提交；批准命令带 expected version/hash 和幂等键，后台 staging 只有在不可变批准快照仍有效且最终重鉴权通过后才能原子发布。

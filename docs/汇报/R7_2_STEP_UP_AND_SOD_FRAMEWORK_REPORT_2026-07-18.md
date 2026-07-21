# R7.2 Step-up 与职责分离基础设施报告

更新日期：2026-07-18
分支：`agent/b8-stable-hardening`
状态：`engineering_verified / pending_human_decision(H10)`

## 1. 结论

R7.2 已把原先“签发后无人消费”的 step-up 预留令牌改造成可配置、可审计、一次性消费的高风险动作授权框架。授权同时绑定当前用户、登录会话、角色快照、Token 版本、动作、资源类型和资源 ID，默认有效期 300 秒，允许配置为 30 至 300 秒，最大使用次数由数据库强制为 1。

该框架默认关闭：

```env
STEP_UP_MODE=disabled
STEP_UP_TTL_SECONDS=300
STEP_UP_ENFORCED_ACTIONS=
```

只有显式设置 `STEP_UP_MODE=enforce` 并列出已经接入统一守卫的动作，应用才会启动并执行强制校验。非法模式、空动作清单、重复/未知动作和尚未接线的候选动作都会使应用启动失败。现有业务流程在 H10 未签字前保持兼容，但不能据此宣称 MFA、正式职责分离或生产安全策略已经完成。

## 2. 起始风险与修复

起始实现仅签发包含 `sub/ver/typ` 的 5 分钟 JWT：

- 没有登录会话、动作、资源或唯一授权 ID；
- 没有接口实际消费令牌；
- 没有数据库单次使用或并发防重放；
- 角色、密码、账号状态变化不会显式撤销授权；
- 能力接口只说“available”，无法区分关闭、强制和 MFA 预留状态。

本次新增 `step_up_grants`，只保存随机 `jti` 和会话 ID 的带域 SHA-256，不保存原始 step-up token 或会话 ID。令牌签发、消费、拒绝和撤销通过 `audit_logs` 形成链路；失败审计不保存密码或令牌。

## 3. 绑定与消费不变量

每个 step-up token 必须同时匹配：

```text
userId + access tokenVersion + access sessionId
+ roleSnapshot
+ action + resourceType + resourceId
+ random jti
+ expiresAt + maxUses(1)
```

- Access JWT 新增随机 `sid`，step-up 必须与签发它的同一次登录会话一起使用；部署前签发且没有 `sid` 的旧 access token 会被拒绝，用户需要重新登录。
- `jti` 和 `sid` 只以带域哈希写库；授权 JWT 仍使用现有固定 `HS256 + issuer + audience` 验证边界。
- 守卫先原子消费授权，再进入业务 service。业务校验失败时授权不会退回，调用者必须重新认证，避免失败路径重放。
- PostgreSQL 条件更新保证并发请求只有一个赢家；部分唯一索引保证同一用户/会话/动作/资源最多一个 active grant。
- 数据库约束强制 `max_uses=1`、`use_count=0..1`、consumed/revoked 时间戳与状态一致。
- 登出、角色变化、密码重置、账号状态变化和软删除会在同一事务中撤销目标用户的 active grants；Access JWT 的 `tokenVersion` 同时失效。

## 4. 高风险动作清单

已接入统一 `@RequireStepUp` + `StepUpGuard` 的动作：

| 动作 | 资源 | 当前接口 |
| --- | --- | --- |
| `user.role.update` | `user` | `PATCH /api/users/:id`，仅请求包含 `role` 时 |
| `user.password.reset` | `user` | `PATCH /api/users/:id/password` |
| `user.status.update` | `user` | `PATCH /api/users/:id/status` |
| `user.disable` | `user` | `DELETE /api/users/:id` |
| `work_order.boss_approve` | `work_order` | `POST /api/work-orders/:id/boss-approve` |
| `import.confirm` | `import_task` | `POST /api/import-tasks/:id/confirm` |
| `ocr.confirm` | `ocr_task` | `POST /api/ocr-tasks/:id/confirm` |
| `record.confirm` | `business_record` | `POST /api/records/:id/confirm` |
| `retention.legal_hold.create` | `retention_resource` | `POST /api/retention/legal-holds` |

已登记但尚未接线的候选动作：

- `user.privileged.create`；
- `retention.run.create`；
- `model.route.update`。

候选动作会出现在能力清单中并标记 `candidate`，但不能签发授权，也不能出现在 enforce 配置中。必须先明确资源绑定和 H10 策略、接入统一守卫并增加攻击测试，才能改为 `attached`。

## 5. API 契约

`GET /api/auth/security-capabilities` 返回实际模式、TTL、单次使用上限、令牌 Header、已强制动作、完整注册表和 `pendingDecisionRefs: ["H10"]`。MFA 固定返回：

```json
{"status":"reserved","enabled":false}
```

`POST /api/auth/step-up` 必须使用当前 access token，并提交：

```json
{
  "password": "current-password",
  "action": "user.status.update",
  "resourceType": "user",
  "resourceId": "target-user-id"
}
```

高风险请求通过 `X-Step-Up-Token` 发送一次性令牌。客户端不能提交操作者 ID、角色、会话 ID、授权次数或目标状态；这些事实全部由服务端当前认证用户、路由元数据和数据库决定。

## 6. 数据生命周期

`StepUpGrant` 纳入 `RetentionDataClass.auth_security_grant`，可以被 R7.1 dry-run 盘点和 legal hold 引用。当前仍不删除任何 grant；实际保留天数和删除传播继续受 H14 约束。

## 7. 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端 Jest | 37/37 suites，342/342 tests |
| PostgreSQL 集成 | 7/7 suites，84/84 tests |
| Step-up 定向 PostgreSQL | 6/6：缺失令牌、单次消费、并发重放、动作/资源/会话/伪造用户、过期、角色/密码/停用/登出失效 |
| Prisma migration | 空库 28 条；26→27 表迁移与 27→28 约束迁移；44 表、30 enums、184 indexes、80 FKs |
| 后端 build | passed |
| 前端 runtime/build | 4/4；Vite 3,144 modules |
| Playwright | 17/17；清理后文件残留 0 |
| Repository hygiene | 624 tracked/candidate files passed |
| 生产依赖审计 | root/backend 均为 0 vulnerabilities |

49,999 行回归继续通过，API 调度约 40 ms、确认约 36.9 秒、峰值 RSS 增量约 235.71 MiB、连接峰值 11；本次认证改造没有降低大批量或 Worker 恢复门禁。

## 8. H10 仍未完成

以下事项不能由工程代码自行决定，继续为 `pending_human_decision(H10)`：

- 哪些高风险动作在各环境必须 step-up，正式 TTL 和重新认证频率；
- 密码重新认证是否足够，哪些动作必须 MFA，以及 MFA 因子、恢复和设备政策；
- 上传者/创建者能否审核或批准自己的任务；
- 同一自然人在不同账号或跨角色下的职责分离识别；
- 单人、双人或多级审批矩阵及历史授权变化的解释；
- break-glass 账号、应急授权、事后复核和凭据轮换；
- admin/auditor 是否需要独立 UI、step-up 或双人批准。

在 H10/H16 未签字前，不新增 admin/auditor 管理 UI，不默认开启 step-up，不宣称 MFA 或正式职责分离完成，也不进入生产试运行。

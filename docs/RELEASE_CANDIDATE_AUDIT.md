# Release Candidate 审计台账

更新日期：2026-07-17

## 1. RC 身份

| 项目 | 值 |
| --- | --- |
| 分支 | `agent/b8-stable-hardening` |
| 审计代码 HEAD | `1213ee8` |
| 上游 | `origin/agent/b8-stable-hardening`，审计时零分叉 |
| PR | [Draft PR #4](https://github.com/sizhedeng905-sys/FINANCE-AGENT/pull/4) |
| Prisma | 24 migrations、41 models/tables、27 enums |
| 发布状态 | `blocked_external` |

状态只使用 `passed`、`failed`、`not_run`、`blocked_external`、`pending_human_decision` 和 `awaiting_human_signoff`。工程自动化通过不等于业务或生产批准。

## 2. B8 阶段冻结

| 阶段 | 主要提交 | 状态 | 核心证据 |
| --- | --- | --- | --- |
| B8-00 | `36832f3` | `passed` | 测试环境隔离和可重复基线 |
| B8-01 | `b66733f` | `passed` | 导入终态、取消/确认锁 |
| B8-02 | `5c0abfb`, `08b8218` | `passed` | Decimal 可见性、确认一致性、幂等 |
| B8-03 | `b5ed3bb` | `passed` | 49,999 行后台确认、lease、原子发布 |
| B8-04 | `4a57f07` | `passed` | OCR 异步、Decimal、attempt 快照 |
| B8-05 | `abd83fb` | `passed` | Claim grounding、黄金账、攻击基准 |
| B8-06 | `08ab38e` | `passed` | Cookie/JWT、权限、文件攻击、DLP |
| B8-07 | `8735528` | `passed` | 模型控制面、GPU 锁、镜像/代理边界 |
| B8-08 | `c4d3cca` | `awaiting_human_signoff` | 匿名 UAT 工具通过，业务签字未完成 |
| B8-09 | `4142a2e`, `2c2baa7`, `64f7b21` | `blocked_external` | 工程与静态门禁通过；真实 Staging/恢复未完成 |

## 3. RC-01 攻击性审计

| 领域 | 状态 | 结论 |
| --- | --- | --- |
| 财务精度与数据层 | `passed` | Decimal 字符串贯穿四来源、RecordValue、快照、报表和 AI 工具；报表仅统计 confirmed actual |
| 北京时间边界 | `passed` | 日/月、月末、闰年、环比/同比已有单元和 PostgreSQL 固定时钟覆盖 |
| 权限与会话 | `passed` | JWT 角色/归属、停用/角色/密码撤销、两个 boss 隔离、跨账号 store 清理通过 |
| 状态机与并发 | `passed` | 工单、Excel、OCR、幂等 key、lease 接管、Redis 恢复和 shutdown 有回归 |
| 文件与资源攻击 | `passed` | 主动内容、伪格式、压缩/复杂度、路径、配额、扫描和对象对账门禁通过 |
| OCR/AI/模型工程 | `passed` | 异步执行、快照、Claim、注入、fallback、GPU 互斥和真实恢复通过 |
| 前端关键路径 | `passed` | API 不回退 Mock、Decimal、任务轮询、错误 requestId、真实 actor 和服务端首页统计通过 |
| 跨来源业务重复 | `pending_human_decision` | 用户明确暂缓；第一版保留人工复核，未自行定义业务指纹 |
| OCR/AI 业务真值 | `awaiting_human_signoff` | 工程安全门禁通过；准确率、盲测和标准答案不能由 Codex签字 |
| 目标 Staging/恢复 | `blocked_external` | 本机固定镜像和 18 服务 smoke 已通过；目标服务器、受控 registry、凭据和真实恢复尚未提供 |

## 4. RC 问题台账

| 编号 | 级别 | 复现/风险 | 修复提交 | 防回归 | 状态 |
| --- | --- | --- | --- | --- | --- |
| RC-P1-01 | P1 | AI intent 可被长输入触发高代价正则 | `01b12fe` | CodeQL、AI 单测 | `passed` |
| RC-P1-02 | P1 | 本地文件路径可越过受控根边界 | `01b12fe` | 文件路径攻击单测、CodeQL | `passed` |
| RC-P1-03 | P1 | Redis 首次健康后短断不再恢复 | `916ff3e` | 可观测性重连单测 | `passed` |
| RC-P1-04 | P1 | 对账误删上传与入库竞态中的未知对象 | `8677ef7` | 对象对账单测 | `passed` |
| RC-P1-05 | P1 | 同一 SPA 切换账号残留旧业务 store | `019abcb` | 跨账号 Playwright | `passed` |
| RC-P1-06 | P1 | 5 路 OCR 事务占满连接池后内部查询死锁 | `d95e3ad` | 1/3/5 并发 PostgreSQL | `passed` |
| RC-P1-07 | P1 | Worker shutdown 未等待恢复任务 | `224e49d` | Worker shutdown 单测 | `passed` |
| RC-P1-08 | P1 | 老板首页将 Decimal 字符串转为 Number 丢分 | `15b6f1d` | 大金额小数 Playwright | `passed` |
| RC-P1-09 | P1 | 首页按前 100 条客户端列表估算统计 | `0698f70` | 125 条聚合单测、四角色 E2E | `passed` |
| RC-P1-10 | P1 | migration 只验当前库，未证明空库/升级路径 | `ccc7365` | CI 自动建两类临时 `_test` 库 | `passed` |
| RC-P2-01 | P2 | trace exporter shutdown 可能丢队列 | `df439eb` | trace drain 单测 | `passed` |
| RC-P2-02 | P2 | 财务 actor 名称硬编码 | `277929c` | 前端构建和时间线推导 | `passed` |
| RC-P2-03 | P2 | 集成存储根误扫 E2E fixture | `bd544fc` | PostgreSQL 60/60 无路径错误 | `passed` |
| RC-P2-04 | P2 | 401 主动跳转使 Playwright reload 竞态失败 | `769e962` | Playwright 16/16 | `passed` |
| RC-P2-05 | P2 | 模型监控仍调用废弃匿名 OCR health | `1213ee8` | 真实切换、432 次 OCR 探针 | `passed` |
| RC-H13-01 | P1 条件风险 | 登录、上传准入和模型闸门是进程内状态，不支持未经验证的横向扩容 | 当前 Compose 锁定单 API/单 Worker | 拓扑静态断言；扩容前需多实例故障测试 | `pending_human_decision` |
| RC-EXT-01 | P0 发布门禁 | 本机固定 Node 镜像及 18 服务 smoke 已通过；H13 目标 registry/server 未提供 | 无代码规避 | 目标 registry release/smoke/restore | `blocked_external` |

本段 RC 结论只描述 `4d597721` 当时已经检查的范围，已被 2026-07-18 R 系列重新审计取代。R1 已关闭唯一 P0，R2 已用实际容器日志和攻击标记关闭日志泄露 P1；R3-R6 与 R9 的 8 个 P1/条件 P1 仍未完成。在这些条目关闭前，不得再引用“没有开放代码 P0/P1”。实时状态以 `docs/B8_BLOCKER_MATRIX.md` 为准。

## 5. 安全与仓库卫生

- `passed`：CI gitleaks 扫描历史；CodeQL 成功；3 条原安全线程均已解决且过时，未解决线程 0。
- `passed`：550 个 tracked/candidate 文件通过 repository hygiene/DLP；根目录和后端生产依赖均 0 vulnerabilities。
- `passed`：`.env`、staging secret/证书、上传目录、模型权重、真实数据和本地私有报告保持 Git 忽略。
- `passed`：Compose 固定版本 tag、只有 TLS gateway 发布端口；应用容器只读、非 root、drop capabilities。
- `blocked_external`：共享 Staging 仍需受控 registry digest、正式 secret/KMS、真实 TLS 和独立安全 Review。

## 6. PR 关系

PR #1、#2、#3、#4 均为面向 `main` 的独立 Draft，未合并、未关闭。PR #4 的提交历史包含此前阶段成果并继续叠加 B8，因此应把 #4 作为当前聚合审查对象；合并顺序和旧 PR 处置由仓库负责人决定，本轮不替代该决定。

## 7. 发布判断

当前只能标记 `blocked_external`。自动化、CI 和本地真实模型结果支持继续进入目标 Staging 验证，但不支持生产发布或无人值守自动入账。

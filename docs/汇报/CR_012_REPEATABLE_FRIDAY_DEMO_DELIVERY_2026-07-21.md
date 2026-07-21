# CR-012 可重复周五演示交付报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

## 已交付

- `docs/deliveries/2026-07-24/` 已包含交付说明、5-8 分钟 Runbook、验收表、诚实限制和后续 2-4 周计划。
- `demo:reset` 只允许本机精确数据库 `finance_agent_test`，复用现有 43 migration、E2E cleanup、seed 和 fixture 生成器。
- `demo:verify` 实查两个财务、一个老板、太和项目、运输模板、3 行金额和 `13422.21` 合计。
- `demo:api`/`demo:web` 固定使用真实本地 API、Mock AI/OCR、外部 Provider disabled，不读取生产配置启动演示。
- `demo:test` 一键重建并运行 CR-011 的真实 API 故事线。

## 实际证据

- 配置/攻击单测 6/6 通过；production 实际命令按预期 exit 1。
- reset/verify 通过，数据库只显示脱敏 loopback 描述。
- API readiness 的 database/storage/models 均为 ok；Web 返回 200；停止后端口无残留。
- 一键故事线收紧前后连续两次 1/1：用例 15.1-15.2 秒，总耗时 21.5-21.7 秒；每次 teardown 均清理任务、3 条记录、快照、文件引用和磁盘产物。
- 最终后端 50/464、runtime 4/4、前后端 build、43 migration 双路径、96 文档/167 链接、768 文件卫生和双端 0 vulnerability audit 均通过。
- CR-011 的 PostgreSQL/Redis 14/124 与完整 Playwright 18/18 仍是受影响全量基线；本提交无业务/Schema 变化，数据库主路径由最终 `demo:test` 实跑。

## 诚实边界

- 三次连续人工演练没有执行，验收表保持 `NOT_RUN`。
- CR-011 提交 `aa7230a` 的三次 push 均因连接重置失败，当前为 `BLOCKED_EXTERNAL`；CR-010 的绿色 CI 不能替代它。
- 主故事不依赖 OCR、真实模型或 AI 叙述。真实准确率、正式财务口径、目标服务器和 production 发布均未宣称通过。

## 当前判断

交付包为 `LOCAL_ENGINEERING_VERIFIED`，周五现场仍为 `CONDITIONAL_NO_GO`。取得当前候选远端 CI 并完成三次人工演练后，才能根据实际结果重新判断 GO。

# CR-059：本地 Pilot 人工验收就绪收口

## 问题现象

本地 Qwen 与 PaddleOCR 容器虽然健康，但一次最终数据库 reset 后，系统注册表会恢复安全种子默认值：`mock-text` 启用、本地部署禁用。若只看容器健康而不检查 API readiness，会把 Mock 路由误报为真实本地模型链路。

此外，CR-057/058 完成后需要把最终测试数量、干净数据库状态、运行入口和非生产边界同步到仓库说明，供负责人开始人工 UAT。

## 根因

`development-local-v1` 清单有意采用保守初始状态：

- Mock 默认启用；
- 本地模型默认禁用；
- 本地模型只有在带鉴权 identity probe 成功后才允许显式启用。

本地 Pilot reset 会重新执行 seed，因此必须在每次 Pilot 启动时重新执行受控路由切换，而不能依赖上一次数据库状态。

## 处理

- Git 忽略的本地 Pilot 控制脚本在 API/Worker 启动前：
  1. 探测并启用 `qwen3-14b-awq`；
  2. 探测并启用 `paddleocr-vl`；
  3. 禁用 `mock-text`；
  4. 校验系统注册表后才继续启动。
- 任一探测或切换失败会终止启动，不会静默回退 Mock。
- 最终 reset 后再次核对 readiness、数据库、Redis、Worker、队列和两个模型部署。
- 更新 README 中本轮实际测试数量，并明确验收数据已清理、真实样本准确率和生产能力仍未获证明。
- 运行凭据、进程号、运行日志、合成样本和四份人工交接文件只保存在 `.realdata-test/handoff/`，不进入 Git。

## 数据库、API 与 UI 影响

- 没有新增 migration、依赖或业务接口。
- 不修改生产配置或默认 seed 的安全行为。
- 仅本机忽略目录中的 Pilot 启动器会显式选择两个本地 Provider。
- 最终数据库为 `finance_agent_pilot_test`，队列为空，前端继续使用真实 API 模式。

## 验证

- `npm --prefix backend run build`：通过。
- `npm run build`：通过。
- 后端 Jest：52 suites、480/480。
- PostgreSQL/Redis：125 项总清单，111 executed passed、14 conditional skipped、0 failed。
- Playwright：23/23。
- Prisma：validate、generate、空库 52 migrations、51 -> 52 升级均通过。
- Friday Demo：配置攻击 6/6、故事线 1/1；正式记录恰好 3 条，金额合计 `13422.21`；最终 reset/verify 为 `DEMO_VERIFY_OK`。
- 本地真实 Provider：
  - 两轮独立 OCR Worker 任务均到达 `pending_confirm`；
  - attempt 为 `local_paddle`；
  - 老板问答为 `openai_compatible / Qwen3-14B-AWQ / fallback=false`；
  - 每轮财务批准前正式记录增量为 0。
- 最终 readiness：数据库、Redis、Worker、队列正常；enabled models 仅为 `paddleocr-vl,qwen3-14b-awq`。

## 边界与残余风险

- 当前结论是合成数据、本机 localhost、非生产 Pilot 的 `UAT_READY`，不是 production-ready。
- OCR/AI 真实公司样本准确率仍需负责人提供已授权真值后校准。
- Qwen3-VL、Embedding 和外部 Provider保持离线。
- 报告正式业务口径、目标 Linux Staging、异地恢复和生产发布仍受原门禁约束。
- 前端生产依赖审计仍有 2 个 React Router moderate advisory；修复路径涉及主版本升级，本轮不为演示仓促升级，登记为非阻断后续项。
- 49,999 行性能断言余量有限，不能替代目标硬件容量验收。

## 回滚

本提交只更新可审查文档。若需停止本地 Pilot，使用忽略目录中的 `pilot-control.ps1 -Action stop`；这不会修改 Git、数据库 schema 或删除模型。不要用 Git 回滚处理本地运行态。

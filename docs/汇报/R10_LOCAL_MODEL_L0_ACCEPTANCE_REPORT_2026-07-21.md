# R10 本地模型 L0 工程验收报告

> 日期：2026-07-21
> 基线提交：`a60bd04b9e9dfd8233639f8b7f685748da6e56eb`
> 状态：`engineering_verified_l0 / awaiting_human_signoff_l1`

## 1. 验收边界

本轮只使用合成文本和运行时生成的合成 PDF，未读取或发送真实业务文件，未启用外部 Provider，也未切换、重启或停止用户正在运行的模型服务。验收前后均保持：

- `qwen-text` 与 `paddle-ocr` 常驻并健康；
- `qwen-vl` 与 `qwen-embedding` 离线并按需保留；
- 模型权重只读挂载且不进入 Git；
- AI/OCR 输出仍只是建议，不能绕过确定性校验和财务批准。

本报告证明 R10 L0 的协议、鉴权、资产、容器与合成推理工程链路，不证明真实 OCR 字段准确率、老板问答业务正确率或生产容量。

## 2. 环境快照

| 项目 | 实测结果 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 5090，32,607 MiB |
| 驱动 | 591.86 |
| 验收时显存 | 24,639 MiB 已用，GPU utilization 0% |
| 文本服务 | `Qwen/Qwen3-14B-AWQ`，容器连续运行 3 天且 healthy |
| OCR 服务 | `PaddlePaddle/PaddleOCR-VL`，容器连续运行 3 天且 healthy |
| 按需服务 | VL、Embedding 均 offline |

## 3. 实际执行证据

| 命令或检查 | 结果 |
| --- | --- |
| `npm run model:status` | `resident_ready`；文本/OCR ready，VL/Embedding offline |
| `npm run model:check:all` | text 9.31 GiB、OCR 2 GiB、VL 16.34 GiB、Embedding 14.11 GiB 全部完整 |
| `npm run model:config:check --prefix backend` | 固定 digest、鉴权、非 root、隔离、资源限制和切换保护全部通过 |
| `npm run model:lock:test --prefix backend` | 并发只有一个锁持有者，释放后可确定性复用 |
| Qwen 未授权 `/v1/models` | HTTP 401 |
| Qwen 认证合成推理 | HTTP 成功；模型身份正确；180 ms；返回 5 个字符 |
| `npm run model:ocr:acceptance --prefix backend` | 合成 PDF：1 页、1 个候选、40 个文本字符 |
| Paddle `/live` 与未授权 `/ready` | liveness 200；未授权 readiness 401 |
| Paddle 容器内 Python contract | 8/8 tests passed，0 skipped |

宿主机直接运行同一 Python suite 时为 5 passed、3 skipped，原因是宿主机 Python 未安装完整 FastAPI 适配器依赖。随后在实际运行镜像中执行完整依赖 suite，8/8 全部通过；同时以真实 HTTP 请求验证 `/live`、`/ready` 和 `/ocr`。这里不把宿主机 skip 记成通过，也不要求为本地开发环境全局安装模型服务依赖。

## 4. R10 关闭判断

### L0 工程接入

状态：`engineering_verified_l0`

- OpenAI-compatible 文本接口和本地 Paddle OCR 契约可用；
- 模型身份、Bearer 鉴权、liveness/readiness 分离和合成推理通过；
- 四套资产清单完整，文本/OCR 常驻策略符合当前单 GPU 预算；
- VL/Embedding 未被顺带启用；
- 模型执行继续受共享 Redis FIFO gate、超时、租约和失败关闭保护；
- Provider 不可用时不会在真实 API 模式伪装为成功。

### L1 真实业务校准

状态：`awaiting_human_signoff / blocked_external`

- H04/H05：17 份 OCR 字段真值与独立盲测尚未冻结；
- H06/H08：分币真值、正式指标口径和老板标准答案尚未签字；
- H09/H11/H12：真实样本授权、文件边界和 Provider 字段白名单尚未完成；
- H13：目标 GPU、服务拓扑、并发和运维责任尚未确认；
- H15/H16：独立复核和最终 UAT/Go-No-Go 尚未完成。

缺少这些证据时，系统继续只允许合成 L0、显式 Mock 或人工复核流程，不宣称真实模型准确率达标，也不允许自动批准或生产启用。

## 5. 回退与运行状态

本轮没有修改模型配置、路由、权重或容器。若后续代码变更导致 L0 回归，应保持真实 Provider 路由禁用或转人工处理，不得静默回退成伪造成功。验收结束时文本与 OCR 仍为 healthy，VL 与 Embedding 仍为 offline。

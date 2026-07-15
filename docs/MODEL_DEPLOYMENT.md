# 本地模型部署与接入

更新日期：2026-07-15

## 当前结论

本仓库已具备可执行的本地模型资产校验、Docker Compose 编排、PaddleOCR-VL HTTP 适配器、后端健康检查和数据库任务路由。模型权重只读挂载，不复制、不改名、不提交到 Git。

本机审计结果：

| 项目 | 当前状态 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 5090，32 GB 显存 |
| 驱动 | 591.86 |
| 文本模型 | `model/Qwen3-14B-AWQ`，9.31 GiB，索引和 2 个分片完整 |
| OCR 模型 | `model/PaddleOCR-VL`，2.00 GiB，V1 权重和 `PP-DocLayoutV2` 完整 |
| Embedding | `model/Qwen3-Embedding-8B`，14.11 GiB，4 个分片完整 |
| 视觉模型 | `model/Qwen3-VL-8B-Instruct`，16.34 GiB，4 个分片完整 |
| WSL / Docker | 已可用；文本/OCR 常驻、VL 按需切换和文本恢复均已在 RTX 5090 实测 |

`npm run model:check:all` 已验证文本、OCR、视觉和 Embedding 四套模型的配置、索引及全部分片。真实运行稳定性已经验收，但 OCR 字段准确率仍等待财务人工标签，二者不能混为一项。

真实运行证据：

- Qwen3-14B-AWQ 与 PaddleOCR-VL 连续常驻 30 分钟，61 次健康采样全部通过，容器 0 重启、0 OOM、0 fatal；显存峰值 28,911 MiB，最低空闲 3,277 MiB。
- 文本重启约 52.99 秒、切换 VL 约 172.35 秒、恢复文本约 51.91 秒；切换期间 OCR 272 次健康采样 0 失败，Embedding 未被意外启动。
- 恢复后 Qwen 与 OCR 同时真实请求均返回 200，并发墙钟约 1.70 秒。最终状态为文本/OCR healthy，VL/Embedding offline。
- 真实 Qwen 72 条问题 0 Provider 错误，但严格 grounding 直接通过率仅 26.39%；财务数字必须继续由结构化工具和受控 fallback 生成。

## 运行策略

单张 32 GB GPU 使用以下保守策略：

| 服务 | 模式 | 端口 | 初始显存策略 |
| --- | --- | ---: | --- |
| `qwen-text` | 常驻 | 8000 | vLLM 预留比例 `0.52`，最大上下文 8192，单并发 |
| `paddle-ocr` | 常驻 | 8868 | PaddleOCR-VL V1 全文档解析，单并发 |
| `qwen-vl` | 按需 | 8001 | 启动前卸载文本服务，OCR 保持在线 |
| `qwen-embedding` | 按需 | 8002 | 启动前卸载文本服务，OCR 保持在线 |

`0.52` 已作为本机 30 分钟稳定性基线通过，但不是所有驱动、并发和文档负载下的生产 SLO。部署到不同机器后仍须观察 OOM、空闲显存、首 Token 延迟和 OCR 峰值，再调整 `QWEN_TEXT_GPU_MEMORY_UTILIZATION`。不要在一张卡上同时启动文本、VL 和 Embedding。

文本服务使用固定的 `vllm/vllm-openai:v0.23.0` 镜像配置；Qwen 官方模型卡提供 AWQ 的 vLLM 启动方式：[Qwen3-14B-AWQ](https://huggingface.co/Qwen/Qwen3-14B-AWQ)。vLLM 容器参数参考[官方 Docker 文档](https://docs.vllm.ai/en/stable/deployment/docker/)。

OCR 使用 PaddleOCR 官方 Blackwell `sm120` 镜像作为基础镜像，并在其上构建项目适配器。RTX 5090 属于 Blackwell 路径，参考[PaddleOCR-VL NVIDIA Blackwell 指南](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PaddleOCR-VL-NVIDIA-Blackwell.html)。

## 1. 系统前置条件

Windows 上需要 WSL 2、Docker Desktop 和 NVIDIA 容器 GPU 支持。安装 WSL 或 Docker Desktop 属于系统级变更，需要用户明确确认后再执行。通常流程为：

```powershell
# 管理员 PowerShell；执行后通常需要重启
wsl --install

# 重启并完成 WSL 初始化后安装 Docker Desktop
winget install --exact --id Docker.DockerDesktop
```

安装完成后验证：

```powershell
wsl --status
docker version
docker compose version
docker run --rm --gpus all nvidia/cuda:12.9.0-base-ubuntu24.04 nvidia-smi
```

只有最后一条在容器内识别到 RTX 5090，才继续启动模型。

## 2. 初始化和校验

在仓库根目录执行：

```powershell
npm run model:init
npm run model:check
```

`model:init` 创建被 Git 忽略的 `deploy/model-services/.env`，自动填写当前 `model` 目录并生成 64 位十六进制本地 API Key；已存在时不会覆盖。

校验范围：

```powershell
npm run model:check                 # 文本 + OCR 常驻资产
npm run model:check:all             # 文本、OCR、VL、Embedding 全部资产
node backend/scripts/verify-model-assets.mjs embedding
node backend/scripts/verify-model-assets.mjs vl
```

校验器检查目录、配置、Tokenizer、权重索引引用、非空分片、`.incomplete` 文件以及 OCR 布局模型，不读取权重内容。

## 3. 启动常驻服务

Docker 就绪后执行：

```powershell
npm run model:resident
npm run model:status
```

首次运行会构建 OCR 适配器并拉取基础镜像，时间取决于网络。脚本最多等待 `MODEL_START_TIMEOUT_MS`，只有以下两项都真实就绪才返回成功：

- `http://127.0.0.1:8000/v1/models` 返回 `Qwen/Qwen3-14B-AWQ`。
- `http://127.0.0.1:8868/health` 返回 `status=ok`。

排查日志：

```powershell
node backend/scripts/model-services.mjs logs qwen-text
node backend/scripts/model-services.mjs logs paddle-ocr
```

停止全部模型：

```powershell
npm run model:stop
```

## 4. 后端密钥和路由

将 `deploy/model-services/.env` 中生成的 `LOCAL_MODEL_API_KEY` 值写入被 Git 忽略的 `backend/.env`：

```env
AI_API_KEY=<same-local-model-key>
OCR_API_KEY=<same-local-model-key>
VL_API_KEY=<same-local-model-key>
EMBEDDING_API_KEY=<same-local-model-key>

AI_TIMEOUT_MS=60000
OCR_TIMEOUT_MS=120000
AI_MAX_CONCURRENCY=1
OCR_MAX_CONCURRENCY=1
```

数据库路由是实际 Provider 的主选择源。真实服务健康后执行：

```powershell
Set-Location backend
npm run model:routes -- enable qwen3-14b-awq
npm run model:routes -- enable paddleocr-vl
npm run model:routes -- list
```

`enable` 会携带对应环境变量中的 Bearer Key 做健康检查；连接失败、401、密钥缺失时拒绝启用。启用后重启后端，再以 finance 或 boss Token 调用：

```http
GET /api/model-runtime/deployments
GET /api/model-runtime/routes
GET /api/model-runtime/health
```

回退到 Mock：

```powershell
npm run model:routes -- disable qwen3-14b-awq
npm run model:routes -- disable paddleocr-vl
```

禁用文本路由后，优先级较低的 `mock-text` 路由继续服务。OCR 无真实路由时使用 `OCR_PROVIDER` 配置，开发默认是 `mock`。API 模式不会因真实模型失败而静默伪造答案，文本调用失败会返回“需要人工确认”。

## 5. 按需模型

Embedding 权重完整，可在任务窗口启动：

```powershell
npm run model:on-demand -- embedding
# 执行检索/索引任务
npm run model:restore
```

`model:on-demand` 先校验目标权重，再停止 `qwen-text` 并启动目标服务；失败时会尝试恢复文本服务。`model:restore` 停止 VL/Embedding 并等待文本模型重新就绪。Paddle OCR 在整个切换期间保持常驻。

VL 资产已完整，可在任务窗口按需执行：

```powershell
npm run model:on-demand -- vl
npm run model:restore
```

阶段 10 主流程不依赖 Qwen-VL；它只预留给复杂图片和 OCR 歧义复核，不能代替人工确认。

## 6. OCR 适配器边界

实现位于 `deploy/model-services/paddle-ocr-adapter/`，遵守 `ocr-provider-contract.openapi.yaml`：

- 启动时从只读挂载目录加载 PaddleOCR-VL V1 和 PP-DocLayoutV2。
- 支持 PDF、PNG、JPEG、WebP、BMP 和 TIFF，默认最大 50 MB。
- `/ocr` 必须使用 Bearer Key，采用常量时间比较。
- 单进程、单推理锁，避免同一 GPU 并发挤占。
- 临时文件在请求结束后清理，不持久化原始文件。
- 只按模板字段名/别名做保守的确定性提取，候选置信度固定低于 `0.8`，必须进入人工复核。
- 文件字段不由 OCR 猜测，仍由后端绑定当前原始文件。
- Provider 返回只保留文本块、表格、页码和摘要，不把图片矩阵或密钥写入数据库。

本地纯逻辑测试不需要 Paddle 或 GPU：

```powershell
python -m unittest discover -s deploy/model-services/paddle-ocr-adapter/tests -p "test_*.py" -v
```

## 7. 验收与调优

首次真实部署按以下顺序验收；本机已完成第 1-5 项和 72 条老板问题工程基准，第 6 项等待人工标签：

1. 资产校验通过，容器内 `nvidia-smi` 正常。
2. 文本与 OCR 常驻启动，连续 30 分钟无重启或 OOM。
3. 单请求验证模型名、鉴权、超时、错误结构和后端健康接口。
4. 记录空闲/峰值显存、模型加载时间、首 Token、总耗时和 OCR 每页耗时。
5. 使用合成票据验证低置信度、缺失字段、损坏 PDF 和人工纠错路径。
6. 使用脱敏真实样本建立字段真值，计算字段准确率和低置信度召回率。
7. 使用 50 至 100 个老板问题和标准答案验收结构化回答，不用主观体验替代基准集。

没有真实样本和标准答案集时，不微调权重，也不声明模型达到生产准确率。优先调整规则、字段别名、Prompt、Schema 和检索上下文，再根据错误分类决定是否需要微调。

## 8. 安全与 Git

- `model/`、`*.safetensors`、`.incomplete`、真实 `.env`、上传文件和企业样本均在 Git 忽略范围。
- 服务端口只绑定 `127.0.0.1`，不得直接暴露公网。
- Compose 只读挂载权重目录，应用密钥只从环境变量读取。
- 不把 API Key 写入数据库；`model_deployments.secret_ref` 只保存变量名。
- 生产环境需进一步使用密钥托管、对象存储、病毒扫描、监控告警和备份。

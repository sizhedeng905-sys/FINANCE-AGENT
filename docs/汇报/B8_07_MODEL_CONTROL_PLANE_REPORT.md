# B8-07 模型控制面、GPU 与反向代理验收报告

更新日期：2026-07-17

## 阶段结果：B8-07

- 状态：passed（工程门禁）
- 基线提交：`08ab38e`
- 新提交：本报告所在 B8-07 提交
- 修改范围：不可变模型部署解析与哈希、AI/OCR 身份探针、liveness/readiness、GPU 跨进程互斥与状态机、模型密钥轮换、容器加固、SBOM/CVE 扫描及 Nginx 上传边界
- 数据库迁移：有，`20260716150000_b8_model_control_plane`
- 新增测试：模型部署解析/快照、错误密钥和身份拒绝、OCR 快照脱敏、健康检查、跨进程锁、真实 VL/Embedding 切换、真实 PaddleOCR、镜像配置和代理上传边界
- 实际执行测试及结果：23/23 Jest suites、235/235 tests；58/58 PostgreSQL integration；14/14 Playwright；前后端 build、Prisma、生产依赖审计、真实 GPU 切换、真实 OCR、SBOM/CVE 和 Nginx 边界全部通过
- 未执行测试及原因：Docker Scout 在线 CVE 查询需要 Docker ID 登录；已使用固定镜像和固定校验和的 Grype 离线数据库完成等价门禁。真实域名/TLS、集中监控和生产反向代理属于 B8-09 目标环境验收
- 新发现风险：镜像剩余 11 个 Medium、5 个 Low 可修复基线项；当前无 Critical/High。Medium/Low 多来自 Paddle/vLLM 基础镜像的传递依赖，升级需结合模型兼容回归，不在本阶段盲目替换
- 真实数据源文件哈希：未接触
- 需要人工决定：无；H-13/H-14 在 B8-09 选择目标基础设施和备份政策
- 下一阶段：B8-08（按用户持续推进授权开始）

## 路由与快照

- 数据库解析后的 `endpoint`、`secretRef`、`modelName`、`modelVersion`、`timeoutMs`、`maxConcurrency` 和能力完整传入 Provider。
- AI 调用与 OCR attempt 保存同一份不可变部署快照、规范化配置摘要和 SHA-256 配置哈希；Bearer、凭据字段及嵌套敏感值拒绝进入快照。
- 健康检查与业务调用复用相同 resolved deployment；探针校验返回的模型名、版本和能力，不接受只有 HTTP 200 的错误服务。
- 路由启用前执行认证探针；缺失/错误 Key、模型身份或能力不一致时拒绝启用并写审计。

## 健康与鉴权

- Paddle `/live` 只报告进程存活且不返回敏感信息；`/ready` 强制 Bearer，并返回受约束的模型、版本和能力身份。
- `/api/health/live` 不依赖数据库、存储或模型；`/api/health/ready` 同时检查 PostgreSQL、文件存储、ClamAV、Excel/OCR 队列以及所有已启用模型。
- PostgreSQL 集成测试验证完整 readiness；浏览器 E2E 继续验证兼容字段、安全头和真实数据库状态。
- 当前文本与 OCR 容器日志中本地模型密钥匹配数为 0；模型密钥轮换脚本只更新被忽略的本地环境文件，不输出密钥。

## GPU 状态机

- 文本、VL 和 Embedding 由文件锁与显式状态文件跨进程互斥；过期 owner 可恢复，活动 owner 不可抢占。
- 启动按需模型前先停止并确认其他按需模型退出；失败路径恢复文本并等待真实模型身份 ready 后才返回。
- 真实 VL 切换用时 339.4 秒：两个并发请求只有一个赢家，图文能力请求通过，无 OOM，最终恢复 `resident_ready`。
- 真实 Embedding 切换用时 278.3 秒：vLLM pooling runner 返回向量能力，两个并发请求只有一个赢家，无 OOM，最终恢复 `resident_ready`。
- 最终运行状态：Qwen 文本和 PaddleOCR 为 healthy；VL 与 Embedding 离线；状态文件为 `resident_ready`。

## 容器、SBOM 与代理

- vLLM 基础镜像固定为 `sha256:6d8429e38e3747723ca07ee1b17972e09bb9c51c4032b266f24fb1cc3b22ed8f`。
- Paddle 基础镜像固定为 `sha256:659eb236d509966380c0ac938049cbb3494f1e84c5d5c53fcac3572c05463487`。
- 两个运行容器均使用 UID/GID `10001`、只读根文件系统、private IPC、`cap_drop: ALL`、`no-new-privileges`、PID/CPU/内存限制和独立 tmpfs。
- Paddle 适配器固定 FastAPI、Starlette、multipart、Pillow、protobuf、setuptools 和 wheel 版本；修复后真实 PDF OCR 返回 `pages=1`、`candidates=1`、`textChars=40`。
- Docker Scout 生成 SPDX：Paddle 762 个包，vLLM 1492 个包。固定 Grype `0.115.0` 镜像和 SHA-256 校验的 2026-07-15 离线数据库复扫结果为：Paddle 0 Critical / 0 High / 9 Medium / 5 Low；vLLM 0 Critical / 0 High / 2 Medium / 0 Low。
- Nginx 配置和动态容器测试验证 19 MiB、50 MiB 请求可到达应用；超过含 multipart 边界上限的请求稳定拒绝，无临时残留；413、超时和网关 5xx 使用统一 JSON envelope。

## 自动化证据

| 门禁 | 结果 |
| --- | --- |
| 后端 build / Prisma | build 通过；schema valid/formatted；24 migrations，无 pending migration |
| 后端单元测试 | 23/23 suites，235/235 tests |
| PostgreSQL 集成 | 58/58 tests；全部 Prisma 模型表、部署身份、readiness 和状态机通过 |
| 大表回归 | 30,196 行 18.578 s、API 24 ms；49,999 行 32.162 s、API 40 ms |
| 资源峰值 | 30,196 行 RSS 增量 169.01 MiB；49,999 行 239.70 MiB；连接峰值 10 |
| 浏览器 E2E | 14/14 tests；teardown 文件残留 0 |
| 真实模型 | VL、Embedding 并发切换与文本恢复通过；PaddleOCR 合成 PDF 通过 |
| 模型安全 | 固定 digest、配置门禁、SBOM、离线 CVE 通过；Critical/High 均为 0 |
| 代理边界 | 19/50 MiB 成功、超限失败、无残留、网关错误统一 |
| 依赖与构建 | 根目录/后端生产依赖均 0 vulnerabilities；前后端 production build 通过 |

## 后续边界

- 本报告证明本地工程门禁与 RTX 5090 实机切换通过，不代表真实 Staging/生产环境已经部署。
- 剩余 Medium/Low 镜像项进入 B8-09 镜像更新台账；升级基础镜像或传递依赖时必须重跑文本、VL、Embedding 和 OCR 全部能力测试。
- 财务 UAT、真实 OCR 标签、业务重复/冲销政策、真实 TLS、对象存储、ClamAV 网络策略、监控、备份恢复和独立 Review 尚未完成，因此项目仍不得描述为 production-ready。

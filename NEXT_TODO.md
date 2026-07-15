# FINANCE-AGENT 下一步执行清单

更新日期：2026-07-15

项目已不是纯前端原型。阶段 0-10 的真实 PostgreSQL/API 主链路已完成，当前按 `docs/REAL_BUSINESS_DATA_TEST_PLAN.md` 推进真实业务数据门禁。详细证据见 `docs/IMPLEMENTATION_PROGRESS.md` 和 `docs/REAL_BUSINESS_DATA_TEST_REPORT.md`。

## 当前门禁：B7 工程交付完成，等待财务签字

已完成：

- XLSX 多 Sheet、隐藏 Sheet、1-3 行合并表头和人工选择。
- 公式默认拒绝、缓存结果显式授权、共享公式来源还原和 audit/ledger。
- 稀疏行列边界、样式尾部排除、数据区合并单元格人工复核。
- 大于 10 MiB 或含媒体 XLSX 的流式行读取；19.67 MiB 与 46.35 MiB 真实匿名样本在 512 MiB 堆限制下通过。
- 单元、真实 PostgreSQL、Playwright 和前后端构建回归。
- 15 份旧 `.xls` 已通过受限子进程隔离转换与解析；原件不变，45 个 Sheet、2351 个公式和 224 个合并区域往返一致。
- B2 已收口：50 MiB 是含边界硬上限，超过 1 字节即统一返回 `41301`；第一版不开放独立大文件通道。

已完成的 B2 收口项：

1. 已完成：为 4999/5000/5001/30196 行建立不含业务数据的确定性生成器、500 行批次消费和资源基线；同步接口继续保持 5000 行上限。
2. 已完成：超过 5000 行自动进入可观察的后台分块任务，具备 500 行批次、heartbeat、取消、lease 过期接管和最多三次恢复。
3. 已完成：5001/30196 行真实 PostgreSQL 持久化无重复、无漏行；旧 worker 与新租约并存时令牌隔离生效，确认前不生成 `BusinessRecord`。
4. 已完成：旧 `.xls` 不依赖桌面 Excel/COM；只在 256 MiB、30 秒、无网络/写权限的子进程中重建内存 `.xlsx`，转换结果不落盘。
5. 已完成：上传限制由 Nest 配置动态注入，避免 `.env` 与 Multer 漂移；上限下、恰好上限和上限加 1 字节均通过真实 multipart/PostgreSQL 门禁，失败无数据库或隔离目录残留。

## 后续门禁

### B3 OCR 与视觉样本（自动化完成，等待人工标签）

- 文本模型和 OCR 常驻，VL/Embedding 按需；真实 Provider 不可用时核心财务链路继续可用。
- 35 页 PDF 页范围、Provider 校准/验证和 30 分钟常驻已通过；文本与 OCR 常驻，VL/Embedding 保持按需。
- 17 份匿名评估样本已准备，因字段标签尚未人工复核，准确率保持 `awaiting_labels`，发布为人工辅助模式。

### B4-B5 统一经营记录、报表与老板 AI（完成）

- 四类来源统一模板、来源与确认快照；`actual/reconciliation/budget` 由后端模板推导，报表仅统计 confirmed actual。
- 72 条 Qwen 基准的有效数字、空数据、注入和 Schema 均 100%；原始模型 fallback 较高，必须保留 grounding 和结构化降级。
- 跨来源业务去重继续保留人工复核；L3 抽样会计真值等待财务签字。

### B6 性能与故障恢复（完成）

- 后端重启与本地 PostgreSQL TCP 代理短断通过；readiness 失败关闭、liveness 保持在线，恢复后自动重连。
- ClamAV 离线返回 503，磁盘低水位在落盘前返回 507；lease 接管、1/3/5 并发上传/导入和模型队列全部通过。
- Qwen 文本重启、按需 VL、文本恢复及 Qwen/OCR 同时推理通过；272 次切换期 OCR 健康采样 0 失败，Embedding 未启动。
- 修复 E2E teardown 目录漂移，清理 50 个历史孤儿测试文件；隔离目录和 E2E 运行目录收口后均为 0 残留。

### B7 财务 UAT 与最终交付（工程完成）

- 已生成 `docs/B7_FINANCE_UAT_ACCEPTANCE.md`；入账粒度、L3 金额、OCR 标签和重复政策明确保留为外部签字项。
- 已通过前后端 build、183 单测、30 PostgreSQL、14 Playwright、Prisma、hygiene、依赖审计、模型资产和 112 份原件哈希复核。
- GitHub 提交、CI 与审查状态统一以 Draft PR #3 为准；财务/OCR 外部门禁关闭前不 merge、不标记生产就绪。

### 财务下一步

- 按 UAT-01 至 UAT-07 执行真实业务抽样，不把逐字段真值或敏感值提交 Git。
- 签署入账粒度、负数/冲销、主表/凭证、35 页拆分和重复处置政策。
- 完成 17 份 OCR 标签与 L3 逐分对账后，再决定是否从人工辅助模式升级。

## 每批提交条件

- 先有失败复现或明确基线，再修改通用能力。
- 所有接口继续使用后端身份、统一响应、DTO 校验、分页、权限、audit 和必要 ledger。
- 原始样本扫描前后 SHA-256 一致，公开输出仅含匿名 ID 和聚合指标。
- 相关单元、PostgreSQL 集成、Playwright、前后端 build 与仓库卫生全部通过。
- README、进度报告、未完成限制和复现命令同步更新。
